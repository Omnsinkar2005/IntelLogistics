import "dotenv/config";
import dns from "node:dns";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  VehicleType, RequirementStatus, ShipmentStatus, PODStatus, PODCondition,
  PODVerificationMethod, SLARiskLevel, SLAStatus, RiskConfidence, LocationSource, OfferStatus,
} from "../generated/prisma/client";
import crypto from "crypto";
import { recalculateKPI, getPeriodBounds } from "../src/modules/kpi/service";
import { computeKPIs } from "../src/modules/kpi/engine";
import type { HistoricalShipmentRecord } from "../src/modules/kpi/types";
import { haversineKm } from "../src/shared/utils";

let prisma: PrismaClient;

/**
 * Resolves the Neon hostname to its IPv4 address before connecting — this
 * network can't route to the IPv6 address Node otherwise selects for it,
 * which caused persistent ETIMEDOUTs even with
 * dns.setDefaultResultOrder("ipv4first") set: pg's own connection code
 * (lib/connection.js) calls net.Socket.connect(port, host) with the plain
 * hostname, a path that doesn't honor that ordering hint. The address is
 * looked up fresh each run (never hardcoded); the original hostname is kept
 * for TLS SNI/cert validation via `servername`. A single, kept-alive
 * connection is used instead of pg.Pool's defaults (max 10, no keepAlive,
 * 10s idle timeout) — this script is a long-running sequential batch job,
 * not a request-scoped workload, and Neon silently drops idle connections
 * that go unprobed, surfacing as "Connection terminated unexpectedly" the
 * next time the pool tries to reuse one.
 */
async function initPrisma() {
  const parsedUrl = new URL(process.env.DATABASE_URL!);
  const neonHostname = parsedUrl.hostname;
  const { address: ipv4Address } = await dns.promises.lookup(neonHostname, { family: 4 });

  const adapter = new PrismaPg({
    host: ipv4Address,
    port: parsedUrl.port ? Number(parsedUrl.port) : 5432,
    database: parsedUrl.pathname.replace(/^\//, ""),
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    max: 1,
    keepAlive: true,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: false, servername: neonHostname },
  });
  prisma = new PrismaClient({ adapter });
}

/**
 * Reconstructs HistoricalShipmentRecord[] for an already-seeded (transporter,
 * period) using several flat, single-table queries instead of kpi/service.ts's
 * getHistoricalShipments() one deep multi-relation `include` — the large join
 * (especially the 1:many locations join) is what timed out against Neon.
 * Mapping logic mirrors kpi/service.ts's toHistoricalRecord() exactly.
 */
async function getHistoricalRecordsForSeed(transporterId: string, period: string): Promise<HistoricalShipmentRecord[]> {
  const { start, end } = getPeriodBounds(period);
  const shipments = await prisma.shipment.findMany({
    where: {
      transporterId,
      status: { in: [ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED] },
      deliveredAt: { gte: start, lt: end },
    },
    select: { id: true, status: true, dispatchedAt: true, deliveredAt: true, slaDeadline: true },
  });
  const shipmentIds = shipments.map((s) => s.id);
  if (shipmentIds.length === 0) return [];

  // Awaited one at a time rather than via Promise.all — each is individually
  // tiny (at most one row per shipment), but firing them concurrently competes
  // for connections against Neon's pooled tier, which is what caused the
  // ETIMEDOUT to land on whichever of the three lost that race on a given run.
  const slas = await prisma.sLA.findMany({ where: { shipmentId: { in: shipmentIds } }, select: { shipmentId: true, isBreached: true } });
  const pods = await prisma.pOD.findMany({ where: { shipmentId: { in: shipmentIds } }, select: { shipmentId: true, status: true, condition: true } });
  const riskEvents = await prisma.sLARiskEvent.findMany({
    where: { shipmentId: { in: shipmentIds }, riskLevel: { in: [SLARiskLevel.HIGH, SLARiskLevel.CRITICAL] } },
    select: { shipmentId: true },
  });

  // Fetched sequentially in small shipment-ID batches, not via Promise.all with the
  // queries above — this is the query that timed out against Neon (each tracked
  // shipment can generate 60+ pings), so it's kept to small, low-risk round trips.
  const LOCATION_BATCH_SIZE = 2;
  const locations: { shipmentId: string; recordedAt: Date }[] = [];
  for (let i = 0; i < shipmentIds.length; i += LOCATION_BATCH_SIZE) {
    const batchIds = shipmentIds.slice(i, i + LOCATION_BATCH_SIZE);
    const batch = await prisma.shipmentLocation.findMany({
      where: { shipmentId: { in: batchIds } },
      select: { shipmentId: true, recordedAt: true },
    });
    locations.push(...batch);
  }

  const slaByShipment = new Map(slas.map((s) => [s.shipmentId, s]));
  const podByShipment = new Map(pods.map((p) => [p.shipmentId, p]));
  const locationsByShipment = new Map<string, Date[]>();
  for (const loc of locations) {
    const arr = locationsByShipment.get(loc.shipmentId) ?? [];
    arr.push(loc.recordedAt);
    locationsByShipment.set(loc.shipmentId, arr);
  }
  const exceptionShipmentIds = new Set(riskEvents.map((e) => e.shipmentId));

  return shipments.map((s) => ({
    id: s.id,
    status: s.status as "DELIVERED" | "COMPLETED",
    dispatchedAt: s.dispatchedAt,
    deliveredAt: s.deliveredAt,
    slaDeadline: s.slaDeadline,
    slaIsBreached: s.status === ShipmentStatus.COMPLETED ? (slaByShipment.get(s.id)?.isBreached ?? null) : null,
    podStatus: podByShipment.get(s.id)?.status ?? null,
    podCondition: podByShipment.get(s.id)?.condition ?? null,
    locationTimestamps: locationsByShipment.get(s.id) ?? [],
    hadHighSeverityException: exceptionShipmentIds.has(s.id),
  }));
}

/** Shared by both the in-memory (new-quarter) and DB-reconstructed (already-seeded) KPI paths. */
async function upsertKpiFromResult(transporterId: string, period: string, result: ReturnType<typeof computeKPIs>) {
  if (result.totalShipments === 0) return null;
  const kpiData = {
    totalShipments: result.totalShipments,
    onTimeDeliveries: result.onTimeDeliveries,
    otifPercent: result.otifPercent,
    avgTatHours: result.avgTatHours,
    slaBreachRatePercent: result.slaBreachRatePercent,
    damageShortageRatePercent: result.damageShortageRatePercent,
    trackingCompliancePercent: result.trackingCompliancePercent,
    podCompliancePercent: result.podCompliancePercent,
    exceptionRatePercent: result.exceptionRatePercent,
    compositeScore: result.compositeScore,
    computedAt: result.calculatedAt,
  };
  const row = await prisma.transporterKPI.upsert({
    where: { transporterId_period: { transporterId, period } },
    update: kpiData,
    create: { transporterId, period, ...kpiData },
  });
  return { ...row, components: result.components };
}

async function main() {
  console.log("🌱 Seeding database...");

  // ─── Company ───────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { gstin: "27AABCU9603R1ZX" },
    update: {},
    create: {
      name: "Cipla Limited",
      gstin: "27AABCU9603R1ZX",
      address: "Cipla House, Peninsula Business Park, Ganpatrao Kadam Marg",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400013",
      contactName: "Rajesh Mehta",
      contactPhone: "+91-22-2482-6000",
      contactEmail: "logistics@cipla.com",
    },
  });
  console.log("✓ Company:", company.name);

  // ─── Users ─────────────────────────────────────────────────
  const manager = await prisma.user.upsert({
    where: { email: "arjun.sharma@cipla.com" },
    update: {},
    create: {
      companyId: company.id,
      name: "Arjun Sharma",
      email: "arjun.sharma@cipla.com",
      phone: "+91-98201-45678",
      role: "MANAGER",
    },
  });

  const viewer = await prisma.user.upsert({
    where: { email: "priya.nair@cipla.com" },
    update: {},
    create: {
      companyId: company.id,
      name: "Priya Nair",
      email: "priya.nair@cipla.com",
      phone: "+91-98201-56789",
      role: "VIEWER",
    },
  });
  console.log("✓ Users:", manager.name, ",", viewer.name);

  // ─── Transporters ──────────────────────────────────────────
  const t1 = await prisma.transporter.upsert({
    where: { gstin: "27AADCB2230M1ZP" },
    update: {
      supportedRoutes: [
        { origin: "Pune", destination: "Hyderabad" },
        { origin: "Pune", destination: "Bangalore" },
        { origin: "Mumbai", destination: "Hyderabad" },
        { origin: "Mumbai", destination: "Delhi" },
        { origin: "Pune", destination: "Chennai" },
        { origin: "Ambala", destination: "Hyderabad" },
        { origin: "Hyderabad", destination: "Bangalore" },
      ],
    },
    create: {
      name: "BlueDart Logistics Pvt. Ltd.",
      gstin: "27AADCB2230M1ZP",
      contactName: "Suresh Pillai",
      contactPhone: "+91-98765-11001",
      contactEmail: "ops@bluedart-logistics.in",
      address: "Plot 14, MIDC Industrial Area",
      city: "Pune",
      state: "Maharashtra",
      coldChainCapable: true,
      supportedRoutes: [
        { origin: "Pune", destination: "Hyderabad" },
        { origin: "Pune", destination: "Bangalore" },
        { origin: "Mumbai", destination: "Hyderabad" },
        { origin: "Mumbai", destination: "Delhi" },
        { origin: "Pune", destination: "Chennai" },
        { origin: "Ambala", destination: "Hyderabad" },
        { origin: "Hyderabad", destination: "Bangalore" },
      ],
      vehicleTypes: [VehicleType.REEFER_SMALL, VehicleType.REEFER_LARGE, VehicleType.TRUCK_LARGE],
      baseCostPerKmInr: 95,
      isActive: true,
    },
  });

  const t2 = await prisma.transporter.upsert({
    where: { gstin: "36AABCT1332L1ZU" },
    update: {},
    create: {
      name: "Gati Pharma Express",
      gstin: "36AABCT1332L1ZU",
      contactName: "Venkat Rao",
      contactPhone: "+91-98765-22002",
      contactEmail: "pharma@gati-express.in",
      address: "Survey No. 45, Kondapur",
      city: "Hyderabad",
      state: "Telangana",
      coldChainCapable: true,
      supportedRoutes: [
        { origin: "Pune", destination: "Hyderabad" },
        { origin: "Hyderabad", destination: "Bangalore" },
        { origin: "Hyderabad", destination: "Chennai" },
        { origin: "Mumbai", destination: "Hyderabad" },
        { origin: "Pune", destination: "Nagpur" },
      ],
      vehicleTypes: [VehicleType.REEFER_SMALL, VehicleType.REEFER_LARGE, VehicleType.TRUCK_MEDIUM],
      baseCostPerKmInr: 88,
      isActive: true,
    },
  });

  const t3 = await prisma.transporter.upsert({
    where: { gstin: "29AABCM4015R1ZA" },
    update: {
      supportedRoutes: [
        { origin: "Pune", destination: "Hyderabad" },
        { origin: "Pune", destination: "Bangalore" },
        { origin: "Bangalore", destination: "Chennai" },
        { origin: "Mumbai", destination: "Bangalore" },
        { origin: "Hyderabad", destination: "Pune" },
        { origin: "Ambala", destination: "Hyderabad" },
        { origin: "Hyderabad", destination: "Bangalore" },
      ],
    },
    create: {
      name: "Mahindra Logistics Ltd.",
      gstin: "29AABCM4015R1ZA",
      contactName: "Kiran Desai",
      contactPhone: "+91-98765-33003",
      contactEmail: "kiran.desai@mahindralogistics.com",
      address: "Whitefield Industrial Area",
      city: "Bangalore",
      state: "Karnataka",
      coldChainCapable: true,
      supportedRoutes: [
        { origin: "Pune", destination: "Hyderabad" },
        { origin: "Pune", destination: "Bangalore" },
        { origin: "Bangalore", destination: "Chennai" },
        { origin: "Mumbai", destination: "Bangalore" },
        { origin: "Hyderabad", destination: "Pune" },
        { origin: "Ambala", destination: "Hyderabad" },
        { origin: "Hyderabad", destination: "Bangalore" },
      ],
      vehicleTypes: [VehicleType.REEFER_LARGE, VehicleType.TRUCK_LARGE, VehicleType.CONTAINER_20FT],
      baseCostPerKmInr: 105,
      isActive: true,
    },
  });

  const t4 = await prisma.transporter.upsert({
    where: { gstin: "27AABCV3456K1ZB" },
    update: {},
    create: {
      name: "VRL Logistics Limited",
      gstin: "27AABCV3456K1ZB",
      contactName: "Ramesh Kulkarni",
      contactPhone: "+91-98765-44004",
      contactEmail: "ramesh.k@vrl-logistics.in",
      address: "Hubli Transport Nagar",
      city: "Hubli",
      state: "Karnataka",
      coldChainCapable: false,
      supportedRoutes: [
        { origin: "Pune", destination: "Hyderabad" },
        { origin: "Pune", destination: "Bangalore" },
        { origin: "Mumbai", destination: "Hyderabad" },
        { origin: "Hubli", destination: "Pune" },
      ],
      vehicleTypes: [VehicleType.TRUCK_MEDIUM, VehicleType.TRUCK_LARGE],
      baseCostPerKmInr: 72,
      isActive: true,
    },
  });
  console.log("✓ Transporters:", t1.name, ",", t2.name, ",", t3.name, ",", t4.name);

  // ─── Vehicles ──────────────────────────────────────────────
  const v1 = await prisma.vehicle.upsert({
    where: { vehicleNumber: "MH12CD5678" },
    update: {},
    create: {
      transporterId: t1.id,
      vehicleNumber: "MH12CD5678",
      vehicleType: VehicleType.REEFER_LARGE,
      capacityKg: 5000,
      coldChain: true,
      tempMinCelsius: 2,
      tempMaxCelsius: 8,
      driverName: "Santosh Jadhav",
      driverPhone: "+91-94201-11111",
      isActive: true,
    },
  });

  const v2 = await prisma.vehicle.upsert({
    where: { vehicleNumber: "MH14EF9012" },
    update: {},
    create: {
      transporterId: t1.id,
      vehicleNumber: "MH14EF9012",
      vehicleType: VehicleType.REEFER_SMALL,
      capacityKg: 2000,
      coldChain: true,
      tempMinCelsius: 2,
      tempMaxCelsius: 8,
      driverName: "Prakash Shinde",
      driverPhone: "+91-94201-22222",
      isActive: true,
    },
  });

  const v3 = await prisma.vehicle.upsert({
    where: { vehicleNumber: "TS09GH3456" },
    update: {},
    create: {
      transporterId: t2.id,
      vehicleNumber: "TS09GH3456",
      vehicleType: VehicleType.REEFER_LARGE,
      capacityKg: 4000,
      coldChain: true,
      tempMinCelsius: 2,
      tempMaxCelsius: 8,
      driverName: "Mohammed Saleem",
      driverPhone: "+91-94201-33333",
      isActive: true,
    },
  });

  const v4 = await prisma.vehicle.upsert({
    where: { vehicleNumber: "KA05IJ7890" },
    update: {},
    create: {
      transporterId: t3.id,
      vehicleNumber: "KA05IJ7890",
      vehicleType: VehicleType.REEFER_LARGE,
      capacityKg: 6000,
      coldChain: true,
      tempMinCelsius: 2,
      tempMaxCelsius: 8,
      driverName: "Ravi Kumar",
      driverPhone: "+91-94201-44444",
      isActive: true,
    },
  });

  const v5 = await prisma.vehicle.upsert({
    where: { vehicleNumber: "MH04KL2345" },
    update: {},
    create: {
      transporterId: t4.id,
      vehicleNumber: "MH04KL2345",
      vehicleType: VehicleType.TRUCK_LARGE,
      capacityKg: 8000,
      coldChain: false,
      driverName: "Dilip Patil",
      driverPhone: "+91-94201-55555",
      isActive: true,
    },
  });
  console.log("✓ Vehicles seeded");

  // ─── Facilities (CWH sources + exact destination facilities) ─
  // Exactly two CWH sources for this POC, plus a handful of exact
  // receiving facilities with the receiver organisation and address
  // already on file — this is what lets the POD workflow auto-fill
  // receiver/destination information once a shipment's destination is
  // selected at requirement-creation time.
  const facilitiesData: {
    type: "CWH" | "DESTINATION";
    name: string;
    organizationName?: string;
    address: string;
    city: string;
    state: string;
    lat: number;
    lng: number;
  }[] = [
    {
      type: "CWH",
      name: "CWH Azamabad",
      address: "Central Warehouse, Azamabad, Hyderabad",
      city: "Hyderabad",
      state: "Telangana",
      lat: 17.385,
      lng: 78.4867,
    },
    {
      type: "CWH",
      name: "CWH Ambala",
      address: "Central Warehouse, Ambala Cantt",
      city: "Ambala",
      state: "Haryana",
      lat: 30.3752,
      lng: 76.7821,
    },
    {
      type: "DESTINATION",
      name: "Apollo Pharmacy Distribution Hub",
      organizationName: "Apollo Pharmacy",
      address: "Apollo Pharmacy Distribution Hub, Banjara Hills, Hyderabad",
      city: "Hyderabad",
      state: "Telangana",
      lat: 17.4239,
      lng: 78.4738,
    },
    {
      type: "DESTINATION",
      name: "MedPlus Central Warehouse",
      organizationName: "MedPlus",
      address: "MedPlus Central Warehouse, Whitefield, Bangalore",
      city: "Bangalore",
      state: "Karnataka",
      lat: 12.9716,
      lng: 77.5946,
    },
    {
      type: "DESTINATION",
      name: "City Hospital Pharmacy Store",
      organizationName: "City Hospital",
      address: "City Hospital Pharmacy Store, Anna Salai, Chennai",
      city: "Chennai",
      state: "Tamil Nadu",
      lat: 13.0827,
      lng: 80.2707,
    },
    // Dummy CFA (Carrying & Forwarding Agent) locations — POC testing only,
    // added to give the destination dropdown coverage across North, East,
    // West and Central India (South was already covered by the three
    // pharmacy-branded facilities above).
    {
      type: "DESTINATION",
      name: "CFA North Delhi",
      organizationName: "North Delhi CFA",
      address: "CFA North Delhi, Okhla Industrial Area, Delhi",
      city: "Delhi",
      state: "Delhi",
      lat: 28.6139,
      lng: 77.209,
    },
    {
      type: "DESTINATION",
      name: "CFA East Kolkata",
      organizationName: "East Kolkata CFA",
      address: "CFA East Kolkata, Taratala, Kolkata",
      city: "Kolkata",
      state: "West Bengal",
      lat: 22.5726,
      lng: 88.3639,
    },
    {
      type: "DESTINATION",
      name: "CFA West Ahmedabad",
      organizationName: "West Ahmedabad CFA",
      address: "CFA West Ahmedabad, Vatva Industrial Estate, Ahmedabad",
      city: "Ahmedabad",
      state: "Gujarat",
      lat: 23.0225,
      lng: 72.5714,
    },
    {
      type: "DESTINATION",
      name: "CFA Central Bhopal",
      organizationName: "Central Bhopal CFA",
      address: "CFA Central Bhopal, Mandideep Industrial Area, Bhopal",
      city: "Bhopal",
      state: "Madhya Pradesh",
      lat: 23.2599,
      lng: 77.4126,
    },
  ];

  const facilitiesByName: Record<string, Awaited<ReturnType<typeof prisma.facility.create>>> = {};
  for (const f of facilitiesData) {
    let facility = await prisma.facility.findFirst({ where: { name: f.name } });
    if (!facility) facility = await prisma.facility.create({ data: f });
    facilitiesByName[f.name] = facility;
  }
  console.log("✓ Facilities seeded:", Object.keys(facilitiesByName).join(", "));

  // ─── Historical Shipments & KPIs ────────────────────────────
  // KPI snapshots are never hand-entered. Each transporter gets a
  // realistic set of historical (already-settled) shipments per quarter,
  // generated from a per-transporter "quality profile"; the real KPI
  // engine (src/modules/kpi) is then run over that shipment history to
  // derive each quarter's KPIs — the same code path used at runtime.

  function hashCode(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return h;
  }

  // Deterministic PRNG (mulberry32) so repeated seed runs are reproducible.
  function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const randRange = (rng: () => number, min: number, max: number) => min + rng() * (max - min);
  function pick<T>(rng: () => number, arr: T[]): T {
    return arr[Math.floor(rng() * arr.length)];
  }

  const CITY_COORDS: Record<string, { lat: number; lng: number; state: string }> = {
    Pune: { lat: 18.5204, lng: 73.8567, state: "Maharashtra" },
    Hyderabad: { lat: 17.385, lng: 78.4867, state: "Telangana" },
    Bangalore: { lat: 12.9716, lng: 77.5946, state: "Karnataka" },
    Mumbai: { lat: 19.076, lng: 72.8777, state: "Maharashtra" },
    Chennai: { lat: 13.0827, lng: 80.2707, state: "Tamil Nadu" },
    Nagpur: { lat: 21.1458, lng: 79.0882, state: "Maharashtra" },
    Hubli: { lat: 15.3647, lng: 75.124, state: "Karnataka" },
    Delhi: { lat: 28.6139, lng: 77.209, state: "Delhi" },
  };

  const RECEIVER_NAMES = ["Anil Kumar", "Sunita Reddy", "Manoj Iyer", "Deepa Nair", "Ravi Shankar", "Pooja Menon", "Ajay Verma", "Lakshmi Rao"];
  const RECEIVER_ORGS = ["Apollo Pharmacy Distribution Hub", "MedPlus Central Warehouse", "Cipla C&F Agent", "Regional Pharma Depot", "City Hospital Pharmacy Store"];
  const PRODUCT_TYPES = ["Pharmaceutical Products", "Vaccines", "Insulin & Biologics", "Injectable Formulations"];

  interface QualityProfile {
    onTimeProb: number;
    tatHoursRange: [number, number];
    damageProb: number;
    trackingGoodProb: number;
    podApprovedProb: number;
    exceptionProb: number;
    shipmentsPerQuarter: number;
  }

  interface TransporterProfile {
    transporter: typeof t1;
    vehicleId: string;
    code: string;
    base: QualityProfile;
    // Applied × quarter-index, so later quarters trend toward better/worse performance.
    trendPerQuarter: Partial<QualityProfile>;
  }

  const TRANSPORTER_PROFILES: TransporterProfile[] = [
    {
      transporter: t1, vehicleId: v1.id, code: "BLD",
      base: { onTimeProb: 0.86, tatHoursRange: [20, 24], damageProb: 0.045, trackingGoodProb: 0.90, podApprovedProb: 0.90, exceptionProb: 0.16, shipmentsPerQuarter: 9 },
      trendPerQuarter: { onTimeProb: 0.02, damageProb: -0.006, exceptionProb: -0.015 }, // steadily improving
    },
    {
      transporter: t2, vehicleId: v3.id, code: "GTI",
      base: { onTimeProb: 0.78, tatHoursRange: [22, 27], damageProb: 0.06, trackingGoodProb: 0.80, podApprovedProb: 0.83, exceptionProb: 0.24, shipmentsPerQuarter: 8 },
      trendPerQuarter: { onTimeProb: 0.035, trackingGoodProb: 0.035, exceptionProb: -0.025 }, // recovering from a weak start
    },
    {
      transporter: t3, vehicleId: v4.id, code: "MHL",
      base: { onTimeProb: 0.91, tatHoursRange: [18, 22], damageProb: 0.02, trackingGoodProb: 0.95, podApprovedProb: 0.95, exceptionProb: 0.08, shipmentsPerQuarter: 8 },
      trendPerQuarter: { onTimeProb: 0.006, damageProb: -0.002 }, // consistently strong, best in class
    },
    {
      transporter: t4, vehicleId: v5.id, code: "VRL",
      base: { onTimeProb: 0.76, tatHoursRange: [24, 30], damageProb: 0.075, trackingGoodProb: 0.60, podApprovedProb: 0.80, exceptionProb: 0.26, shipmentsPerQuarter: 10 },
      trendPerQuarter: { onTimeProb: -0.012, damageProb: 0.006, trackingGoodProb: -0.01 }, // budget carrier, slowly declining
    },
  ];

  const HISTORICAL_PERIODS = ["2025-Q4", "2026-Q1", "2026-Q2"];
  const latestKpiByTransporter: Record<string, Awaited<ReturnType<typeof recalculateKPI>>> = {};

  for (const profile of TRANSPORTER_PROFILES) {
    for (let qIndex = 0; qIndex < HISTORICAL_PERIODS.length; qIndex++) {
      const period = HISTORICAL_PERIODS[qIndex];
      const trackingPrefix = `HIST-${profile.code}-${period}`;

      const alreadySeeded = await prisma.shipment.findFirst({ where: { trackingNumber: { startsWith: trackingPrefix } } });
      if (!alreadySeeded) {
        const rng = makeRng(hashCode(trackingPrefix));
        const { start, end } = getPeriodBounds(period);
        const q: QualityProfile = {
          onTimeProb: clamp01(profile.base.onTimeProb + (profile.trendPerQuarter.onTimeProb ?? 0) * qIndex),
          tatHoursRange: profile.base.tatHoursRange,
          damageProb: clamp01(profile.base.damageProb + (profile.trendPerQuarter.damageProb ?? 0) * qIndex),
          trackingGoodProb: clamp01(profile.base.trackingGoodProb + (profile.trendPerQuarter.trackingGoodProb ?? 0) * qIndex),
          podApprovedProb: clamp01(profile.base.podApprovedProb + (profile.trendPerQuarter.podApprovedProb ?? 0) * qIndex),
          exceptionProb: clamp01(profile.base.exceptionProb + (profile.trendPerQuarter.exceptionProb ?? 0) * qIndex),
          shipmentsPerQuarter: profile.base.shipmentsPerQuarter,
        };

        const routes = (profile.transporter.supportedRoutes as unknown as { origin: string; destination: string }[]);
        const routePairs = routes.length > 0 ? routes : [{ origin: "Pune", destination: "Hyderabad" }];

        const records: HistoricalShipmentRecord[] = [];

        for (let i = 0; i < q.shipmentsPerQuarter; i++) {
          const routePair = pick(rng, routePairs);
          const origin = CITY_COORDS[routePair.origin] ?? CITY_COORDS.Pune;
          const destination = CITY_COORDS[routePair.destination] ?? CITY_COORDS.Hyderabad;

          const tatHours = randRange(rng, q.tatHoursRange[0], q.tatHoursRange[1]);
          const transitMs = tatHours * 3_600_000;
          const edgeBufferMs = 2 * 24 * 3_600_000; // keep dispatch/delivery clear of period boundaries
          const periodSpanMs = end.getTime() - start.getTime();
          const maxOffsetMs = Math.max(periodSpanMs - transitMs - edgeBufferMs, 0);
          const dispatchedAt = new Date(start.getTime() + edgeBufferMs / 2 + rng() * maxOffsetMs);
          const deliveredAt = new Date(dispatchedAt.getTime() + transitMs);

          const isOnTime = rng() < q.onTimeProb;
          const slaDeadline = isOnTime
            ? new Date(deliveredAt.getTime() + randRange(rng, 15, 180) * 60_000)
            : new Date(deliveredAt.getTime() - randRange(rng, 10, 120) * 60_000);
          const agreedTatHours = Math.round((slaDeadline.getTime() - dispatchedAt.getTime()) / 3_600_000);

          const podApproved = rng() < q.podApprovedProb;
          const podStatus = podApproved ? PODStatus.APPROVED : PODStatus.REJECTED;
          const isDamaged = rng() < q.damageProb;
          const podCondition = isDamaged ? pick(rng, [PODCondition.DAMAGED, PODCondition.PARTIAL]) : PODCondition.GOOD;
          const shipmentStatus = podApproved ? ShipmentStatus.COMPLETED : ShipmentStatus.DELIVERED;

          const distanceKm = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng) * 1.2;
          const weightKg = Math.round(randRange(rng, 800, 3000));
          const agreedCostInr = Math.round(distanceKm * Number(profile.transporter.baseCostPerKmInr));
          const refNumber = `${trackingPrefix}-${String(i + 1).padStart(3, "0")}`;

          const req = await prisma.transportRequirement.create({
            data: {
              companyId: company.id,
              createdById: manager.id,
              referenceNumber: refNumber,
              originCity: routePair.origin, originState: origin.state, originLat: origin.lat, originLng: origin.lng,
              destinationCity: routePair.destination, destinationState: destination.state, destinationLat: destination.lat, destinationLng: destination.lng,
              productType: pick(rng, PRODUCT_TYPES),
              weightKg,
              coldChainRequired: profile.transporter.coldChainCapable,
              tempMinCelsius: profile.transporter.coldChainCapable ? 2 : null,
              tempMaxCelsius: profile.transporter.coldChainCapable ? 8 : null,
              maxCostInr: Math.round(agreedCostInr * 1.15),
              slaDeadline,
              status: RequirementStatus.ASSIGNED,
              createdAt: dispatchedAt,
            },
          });

          const shipment = await prisma.shipment.create({
            data: {
              requirementId: req.id,
              transporterId: profile.transporter.id,
              vehicleId: profile.vehicleId,
              trackingNumber: refNumber,
              originCity: routePair.origin, originState: origin.state, originLat: origin.lat, originLng: origin.lng,
              destinationCity: routePair.destination, destinationState: destination.state, destinationLat: destination.lat, destinationLng: destination.lng,
              distanceKm,
              agreedCostInr,
              slaDeadline,
              status: shipmentStatus,
              dispatchedAt,
              deliveredAt,
              completedAt: shipmentStatus === ShipmentStatus.COMPLETED ? new Date(deliveredAt.getTime() + randRange(rng, 30, 240) * 60_000) : null,
              createdAt: dispatchedAt,
            },
          });

          await prisma.sLA.create({
            data: {
              shipmentId: shipment.id,
              deadline: slaDeadline,
              agreedTatHours,
              isBreached: !isOnTime,
              breachedAt: !isOnTime ? deliveredAt : null,
              deliveryVarianceMinutes: Math.round((slaDeadline.getTime() - deliveredAt.getTime()) / 60_000),
            },
          });

          await prisma.pOD.create({
            data: {
              shipmentId: shipment.id,
              receiverName: pick(rng, RECEIVER_NAMES),
              receiverOrganization: pick(rng, RECEIVER_ORGS),
              receiverPhone: `+91-${Math.floor(randRange(rng, 70000, 99999))}-${Math.floor(randRange(rng, 10000, 99999))}`,
              deliveredQuantityKg: podCondition === PODCondition.PARTIAL ? Math.round(weightKg * randRange(rng, 0.6, 0.9)) : weightKg,
              condition: podCondition,
              deliveryLat: destination.lat,
              deliveryLng: destination.lng,
              verificationMethod: PODVerificationMethod.OTP_AND_SIGNATURE,
              otpVerifiedAt: new Date(deliveredAt.getTime() + 5 * 60_000),
              signatureData: "data:image/png;base64,SEEDED_HISTORICAL_SIGNATURE",
              status: podStatus,
              submittedAt: new Date(deliveredAt.getTime() + 10 * 60_000),
              reviewedById: manager.id,
              reviewedAt: new Date(deliveredAt.getTime() + 30 * 60_000),
              rejectionReason: podStatus === PODStatus.REJECTED ? "Receiver signature illegible / quantity mismatch on inspection" : null,
            },
          });

          // GPS trail: dense and regular when tracking-compliant, sparse/gappy otherwise.
          const isTracked = rng() < q.trackingGoodProb;
          const pingCount = isTracked ? Math.max(8, Math.round(tatHours * 3)) : Math.floor(randRange(rng, 0, 3));
          const pingTimestamps: Date[] = [];
          for (let p = 1; p <= pingCount; p++) {
            const fraction = isTracked ? p / (pingCount + 1) : rng();
            const at = new Date(dispatchedAt.getTime() + fraction * transitMs);
            pingTimestamps.push(at);
            await prisma.shipmentLocation.create({
              data: {
                shipmentId: shipment.id,
                vehicleId: profile.vehicleId,
                latitude: origin.lat + (destination.lat - origin.lat) * fraction,
                longitude: origin.lng + (destination.lng - origin.lng) * fraction,
                speedKmh: randRange(rng, 30, 70),
                source: LocationSource.SIMULATED,
                recordedAt: at,
              },
            });
          }

          const hasException = rng() < q.exceptionProb;
          if (hasException) {
            const triggeredAt = new Date(dispatchedAt.getTime() + randRange(rng, 0.2, 0.8) * transitMs);
            await prisma.sLARiskEvent.create({
              data: {
                shipmentId: shipment.id,
                status: SLAStatus.HIGH_RISK,
                riskLevel: SLARiskLevel.HIGH,
                predictedDelayMinutes: Math.round(randRange(rng, 20, 90)),
                bufferMinutes: Math.round(randRange(rng, -30, 60)),
                confidence: RiskConfidence.MEDIUM,
                confidenceReason: "Synthetic historical exception for KPI seeding",
                reasons: [{ code: "HISTORICAL_SEED", description: "Synthetic historical SLA risk exception for KPI seeding", impactMinutes: 30, severity: "HIGH" }],
                isActive: false,
                triggeredAt,
                resolvedAt: new Date(triggeredAt.getTime() + 45 * 60_000),
              },
            });
          }

          records.push({
            id: shipment.id,
            status: shipmentStatus,
            dispatchedAt,
            deliveredAt,
            slaDeadline,
            slaIsBreached: shipmentStatus === ShipmentStatus.COMPLETED ? !isOnTime : null,
            podStatus,
            podCondition,
            locationTimestamps: pingTimestamps,
            hadHighSeverityException: hasException,
          });
        }

        const result = computeKPIs(records);
        const kpiRow = await upsertKpiFromResult(profile.transporter.id, period, result);
        if (kpiRow) latestKpiByTransporter[profile.transporter.id] = kpiRow;
      } else {
        const existingKpi = await prisma.transporterKPI.findFirst({
          where: { transporterId: profile.transporter.id, period },
        });
        if (!existingKpi) {
          const records = await getHistoricalRecordsForSeed(profile.transporter.id, period);
          const result = computeKPIs(records);
          const kpiRow = await upsertKpiFromResult(profile.transporter.id, period, result);
          if (kpiRow) latestKpiByTransporter[profile.transporter.id] = kpiRow;
        }
      }
    }
    console.log(`✓ Historical shipments + KPIs computed for ${profile.transporter.name}`);
  }
  console.log("✓ Historical shipments & KPIs seeded (KPIs derived from shipment history, not hand-entered)");

  function toPlainKpiSnapshot(row: Awaited<ReturnType<typeof recalculateKPI>>) {
    if (!row) return undefined;
    return {
      period: row.period,
      totalShipments: row.totalShipments,
      otifPercent: row.otifPercent !== null ? Number(row.otifPercent) : null,
      avgTatHours: row.avgTatHours !== null ? Number(row.avgTatHours) : null,
      slaBreachRatePercent: row.slaBreachRatePercent !== null ? Number(row.slaBreachRatePercent) : null,
      damageShortageRatePercent: row.damageShortageRatePercent !== null ? Number(row.damageShortageRatePercent) : null,
      trackingCompliancePercent: row.trackingCompliancePercent !== null ? Number(row.trackingCompliancePercent) : null,
      podCompliancePercent: row.podCompliancePercent !== null ? Number(row.podCompliancePercent) : null,
      exceptionRatePercent: row.exceptionRatePercent !== null ? Number(row.exceptionRatePercent) : null,
      compositeScore: row.compositeScore !== null ? Number(row.compositeScore) : null,
    };
  }

  // ─── Route Events ──────────────────────────────────────────
  // Local mock dataset only — simulated for demo purposes, not live
  // traffic/event intelligence. See src/modules/route-events/providers/mockRouteEventProvider.ts.
  const routeEvents = [
    {
      eventType: "FESTIVAL" as const,
      title: "Ganesh Visarjan Procession",
      description:
        "City-wide Ganpati immersion procession through central Pune. Heavy vehicle movement restricted along the procession route 10:00–23:00.",
      affectedHighway: null,
      affectedCity: "Pune",
      affectedRegion: { latMin: 18.4, latMax: 18.65, lngMin: 73.75, lngMax: 73.95 },
      severity: "HIGH" as const,
      estimatedDelayMinutes: 35,
      source: "MOCK" as const,
      validFrom: new Date("2026-09-08T08:00:00+05:30"),
      validUntil: new Date("2026-09-10T23:00:00+05:30"),
    },
    {
      eventType: "FESTIVAL" as const,
      title: "Ganesh Chaturthi Procession — Solapur",
      description:
        "Annual Ganesh Chaturthi procession passing through NH-65 near Solapur city centre. Heavy vehicle movement restricted 08:00–22:00.",
      affectedHighway: "NH-65",
      affectedCity: "Solapur",
      affectedRegion: { latMin: 17.55, latMax: 17.75, lngMin: 75.85, lngMax: 76.05 },
      severity: "HIGH" as const,
      estimatedDelayMinutes: 90,
      source: "MOCK" as const,
      validFrom: new Date("2026-09-08T06:00:00+05:30"),
      validUntil: new Date("2026-09-09T23:00:00+05:30"),
    },
    {
      eventType: "ROAD_CLOSURE" as const,
      title: "Road Repair — Pune-Solapur Highway (NH-65)",
      description:
        "NHAI road resurfacing work between Pune and Solapur. Single-lane traffic near Daund. Expect significant delays.",
      affectedHighway: "NH-65",
      affectedCity: "Daund",
      affectedRegion: { latMin: 18.35, latMax: 18.55, lngMin: 74.45, lngMax: 74.65 },
      severity: "MEDIUM" as const,
      estimatedDelayMinutes: 45,
      source: "MOCK" as const,
      validFrom: new Date("2026-09-07T00:00:00+05:30"),
      validUntil: new Date("2026-09-12T23:59:00+05:30"),
    },
    {
      eventType: "ACCIDENT" as const,
      title: "Multi-Vehicle Accident — NH-65 near Humnabad",
      description:
        "Truck collision blocking two lanes on NH-65 near Humnabad. Traffic police on site; single-lane movement only until cleared.",
      affectedHighway: "NH-65",
      affectedCity: "Humnabad",
      affectedRegion: { latMin: 17.75, latMax: 17.95, lngMin: 77.1, lngMax: 77.35 },
      severity: "HIGH" as const,
      estimatedDelayMinutes: 40,
      source: "MOCK" as const,
      validFrom: new Date("2026-09-08T05:00:00+05:30"),
      validUntil: new Date("2026-09-09T18:00:00+05:30"),
    },
    {
      eventType: "TRAFFIC" as const,
      title: "Heavy Traffic — Hyderabad Outer Ring Road",
      description:
        "Peak hour congestion on ORR near Shamshabad due to IT corridor traffic. Affects vehicles entering Hyderabad from Pune direction.",
      affectedHighway: "ORR Hyderabad",
      affectedCity: "Hyderabad",
      affectedRegion: { latMin: 17.25, latMax: 17.45, lngMin: 78.35, lngMax: 78.55 },
      severity: "MEDIUM" as const,
      estimatedDelayMinutes: 60,
      source: "MOCK" as const,
      validFrom: new Date("2026-09-10T07:00:00+05:30"),
      validUntil: new Date("2026-09-10T20:00:00+05:30"),
    },
    {
      eventType: "PUBLIC_EVENT" as const,
      title: "IPL Match — Rajiv Gandhi International Stadium",
      description:
        "Evening IPL match causing road closures around Uppal. Vehicles on NH-65 approaching Hyderabad will face diversions.",
      affectedHighway: "NH-65",
      affectedCity: "Hyderabad",
      affectedRegion: { latMin: 17.38, latMax: 17.48, lngMin: 78.52, lngMax: 78.62 },
      severity: "HIGH" as const,
      estimatedDelayMinutes: 75,
      source: "MOCK" as const,
      validFrom: new Date("2026-09-10T16:00:00+05:30"),
      validUntil: new Date("2026-09-10T23:00:00+05:30"),
    },
    {
      eventType: "LOCAL_FUNCTION" as const,
      title: "Wedding Procession Road Blockage — Tuljapur",
      description:
        "Local wedding procession (baraat) temporarily blocking the main road through Tuljapur town centre.",
      affectedHighway: null,
      affectedCity: "Tuljapur",
      affectedRegion: { latMin: 18.0, latMax: 18.2, lngMin: 76.05, lngMax: 76.25 },
      severity: "LOW" as const,
      estimatedDelayMinutes: 20,
      source: "MOCK" as const,
      validFrom: new Date("2026-09-08T17:00:00+05:30"),
      validUntil: new Date("2026-09-08T21:00:00+05:30"),
    },
    {
      eventType: "CONSTRUCTION" as const,
      title: "Highway Widening Work — NH-65 near Zaheerabad",
      description:
        "NHAI highway-widening project narrowing NH-65 to one lane each way near Zaheerabad, approaching Hyderabad.",
      affectedHighway: "NH-65",
      affectedCity: "Zaheerabad",
      affectedRegion: { latMin: 17.55, latMax: 17.75, lngMin: 77.55, lngMax: 77.75 },
      severity: "MEDIUM" as const,
      estimatedDelayMinutes: 30,
      source: "MOCK" as const,
      validFrom: new Date("2026-09-01T00:00:00+05:30"),
      validUntil: new Date("2026-09-20T23:59:00+05:30"),
    },
    {
      eventType: "WEATHER" as const,
      title: "Heavy Rainfall Warning — Gulbarga District",
      description:
        "IMD orange alert for heavy rainfall in Gulbarga district. NH-218 may have waterlogging near Shahabad.",
      affectedHighway: "NH-218",
      affectedCity: "Gulbarga",
      affectedRegion: { latMin: 17.15, latMax: 17.45, lngMin: 76.65, lngMax: 76.95 },
      severity: "MEDIUM" as const,
      estimatedDelayMinutes: 50,
      source: "MOCK" as const,
      validFrom: new Date("2026-09-09T00:00:00+05:30"),
      validUntil: new Date("2026-09-11T12:00:00+05:30"),
    },
  ];

  for (const event of routeEvents) {
    const existing = await prisma.routeEvent.findFirst({
      where: { title: event.title },
    });
    if (!existing) {
      await prisma.routeEvent.create({ data: event });
    }
  }
  console.log("✓ Route events seeded");

  // ─── Demo Transport Requirement ────────────────────────────
  const existingReq = await prisma.transportRequirement.findFirst({
    where: { referenceNumber: "REQ-2026-0001" },
  });

  let requirement = existingReq;
  if (!existingReq) {
    const reqOrigin = facilitiesByName["CWH Ambala"];
    const reqDestination = facilitiesByName["Apollo Pharmacy Distribution Hub"];
    requirement = await prisma.transportRequirement.create({
      data: {
        companyId: company.id,
        createdById: manager.id,
        referenceNumber: "REQ-2026-0001",
        originFacilityId: reqOrigin.id,
        originCity: reqOrigin.city,
        originState: reqOrigin.state,
        originLat: reqOrigin.lat,
        originLng: reqOrigin.lng,
        destinationFacilityId: reqDestination.id,
        destinationCity: reqDestination.city,
        destinationState: reqDestination.state,
        destinationLat: reqDestination.lat,
        destinationLng: reqDestination.lng,
        productType: "Pharmaceutical Products",
        productDescription: "Temperature-sensitive injectable formulations — Insulin and Biologics",
        weightKg: 2500,
        volumeCbm: 8.5,
        coldChainRequired: true,
        tempMinCelsius: 2,
        tempMaxCelsius: 8,
        // CWH Ambala → Hyderabad is a long-haul corridor (~1,800 road km) —
        // sized to comfortably cover both eligible transporters' estimated cost.
        maxCostInr: 220000,
        slaDeadline: new Date("2026-09-10T17:00:00+05:30"),
        specialInstructions:
          "Handle with care. Do not stack more than 3 boxes high. Temperature log required every 2 hours.",
        status: RequirementStatus.OPEN,
        // 5 transporters were eligible/sent to when this was sent for
        // quotation — paired with the 3 offers seeded below to show
        // "Responses: 3/5" on the Requirements page out of the box.
        matchedTransporterCount: 5,
      },
    });
    console.log("✓ Demo requirement created:", requirement!.referenceNumber);
  } else {
    // Backfill for a DB seeded before matchedTransporterCount existed.
    requirement = await prisma.transportRequirement.update({
      where: { id: existingReq.id },
      data: { matchedTransporterCount: existingReq.matchedTransporterCount ?? 5 },
    });
    console.log("✓ Demo requirement already exists:", existingReq.referenceNumber);
  }

  // ─── One requirement at each new/renamed status, for the Requirements
  // page's status filter to have something in every tab out of the box ───
  const altOrigin = facilitiesByName["CWH Azamabad"];
  const altDestination = facilitiesByName["City Hospital Pharmacy Store"];

  const lifecycleRequirements: Array<{
    referenceNumber: string;
    status: RequirementStatus;
    complete: boolean;
    matchedTransporterCount?: number;
  }> = [
    // Draft: intentionally incomplete — only the route is picked so far,
    // demonstrating that an incomplete form can be saved as a Draft.
    { referenceNumber: "REQ-2026-0002", status: RequirementStatus.DRAFT, complete: false },
    // Ready to Send: a fully completed form that has deliberately not been
    // sent for quotation yet.
    { referenceNumber: "REQ-2026-0003", status: RequirementStatus.READY_TO_SEND, complete: true },
    // Quotations Received: sent, and (via the offers seeded below) has
    // quotes back from transporters.
    { referenceNumber: "REQ-2026-0004", status: RequirementStatus.MATCHED, complete: true, matchedTransporterCount: 4 },
  ];

  const seededLifecycleReqs: Record<string, { id: string }> = {};
  for (const spec of lifecycleRequirements) {
    const existing = await prisma.transportRequirement.findFirst({ where: { referenceNumber: spec.referenceNumber } });
    if (existing) {
      seededLifecycleReqs[spec.referenceNumber] = existing;
      continue;
    }
    const created = await prisma.transportRequirement.create({
      data: spec.complete
        ? {
            companyId: company.id,
            createdById: manager.id,
            referenceNumber: spec.referenceNumber,
            originFacilityId: altOrigin.id,
            originCity: altOrigin.city,
            originState: altOrigin.state,
            originLat: altOrigin.lat,
            originLng: altOrigin.lng,
            destinationFacilityId: altDestination.id,
            destinationCity: altDestination.city,
            destinationState: altDestination.state,
            destinationLat: altDestination.lat,
            destinationLng: altDestination.lng,
            productType: "Pharmaceutical Products",
            productDescription: "General ambient-stable pharmaceutical stock",
            weightKg: 1200,
            volumeCbm: 4.2,
            coldChainRequired: false,
            maxCostInr: 95000,
            slaDeadline: new Date("2026-09-20T17:00:00+05:30"),
            status: spec.status,
            matchedTransporterCount: spec.matchedTransporterCount,
          }
        : {
            companyId: company.id,
            createdById: manager.id,
            referenceNumber: spec.referenceNumber,
            originFacilityId: altOrigin.id,
            originCity: altOrigin.city,
            originState: altOrigin.state,
            originLat: altOrigin.lat,
            originLng: altOrigin.lng,
            productType: "Pharmaceutical Products",
            status: spec.status,
          },
    });
    seededLifecycleReqs[spec.referenceNumber] = created;
  }
  console.log("✓ Draft / Ready to Send / Quotations Received demo requirements seeded");

  // A couple of quotes against the "Quotations Received" requirement above,
  // so it also shows a non-zero "Responses: X/Y" on the Requirements page.
  const matchedDemoReq = seededLifecycleReqs["REQ-2026-0004"];
  if (matchedDemoReq) {
    const matchedOffers = [
      {
        requirementId: matchedDemoReq.id,
        transporterId: t1.id,
        vehicleId: v1.id,
        quotedCostInr: 82000,
        estimatedTatHrs: 18,
        notes: "Standard ambient transport.",
        status: OfferStatus.SUBMITTED,
        submittedAt: new Date(),
        kpiSnapshot: toPlainKpiSnapshot(latestKpiByTransporter[t1.id]),
      },
      {
        requirementId: matchedDemoReq.id,
        transporterId: t2.id,
        vehicleId: v3.id,
        quotedCostInr: 79000,
        estimatedTatHrs: 20,
        notes: "Shared-load rate.",
        status: OfferStatus.SUBMITTED,
        submittedAt: new Date(),
        kpiSnapshot: toPlainKpiSnapshot(latestKpiByTransporter[t2.id]),
      },
    ];
    for (const offer of matchedOffers) {
      await prisma.transporterOffer.upsert({
        where: {
          requirementId_transporterId: {
            requirementId: offer.requirementId,
            transporterId: offer.transporterId,
          },
        },
        // Repairs rows seeded before SUBMITTED existed (they'd otherwise
        // sit at the PENDING default despite already having a quoted cost).
        update: { status: offer.status, submittedAt: offer.submittedAt },
        create: offer,
      });
    }
    console.log("✓ Transporter offers seeded for the Quotations Received demo requirement");
  }

  // ─── Transporter Offers for demo requirement ───────────────
  if (requirement) {
    const offers = [
      {
        requirementId: requirement.id,
        transporterId: t1.id,
        vehicleId: v1.id,
        quotedCostInr: 165000,
        estimatedTatHrs: 34,
        notes: "Dedicated reefer vehicle. GPS tracking enabled. Temperature log provided every 2 hours.",
        status: OfferStatus.SUBMITTED,
        submittedAt: new Date(),
        kpiSnapshot: toPlainKpiSnapshot(latestKpiByTransporter[t1.id]),
      },
      {
        requirementId: requirement.id,
        transporterId: t2.id,
        vehicleId: v3.id,
        quotedCostInr: 155000,
        estimatedTatHrs: 36,
        notes: "Cold chain certified vehicle.",
        status: OfferStatus.SUBMITTED,
        submittedAt: new Date(),
        kpiSnapshot: toPlainKpiSnapshot(latestKpiByTransporter[t2.id]),
      },
      {
        requirementId: requirement.id,
        transporterId: t3.id,
        vehicleId: v4.id,
        quotedCostInr: 182000,
        estimatedTatHrs: 32,
        notes: "Premium pharma-grade reefer. Real-time temperature monitoring. Fastest TAT on this route.",
        status: OfferStatus.SUBMITTED,
        submittedAt: new Date(),
        kpiSnapshot: toPlainKpiSnapshot(latestKpiByTransporter[t3.id]),
      },
    ];

    for (const offer of offers) {
      await prisma.transporterOffer.upsert({
        where: {
          requirementId_transporterId: {
            requirementId: offer.requirementId,
            transporterId: offer.transporterId,
          },
        },
        // Repairs rows seeded before SUBMITTED existed (they'd otherwise
        // sit at the PENDING default despite already having a quoted cost).
        update: { status: offer.status, submittedAt: offer.submittedAt },
        create: offer,
      });
    }
    console.log("✓ Transporter offers seeded");
  }

  console.log("\n✅ Seed complete.");
  console.log("   Company:      Cipla Limited");
  console.log("   Manager:      Arjun Sharma (arjun.sharma@cipla.com)");
  console.log("   Transporters: BlueDart, Gati Pharma, Mahindra, VRL");
  console.log("   Requirement:  REQ-2026-0001 — CWH Ambala → Apollo Pharmacy Distribution Hub (Hyderabad), 2500kg cold chain");
}

initPrisma()
  .then(main)
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Seed failed:", e);
    await prisma?.$disconnect();
    process.exit(1);
  });
