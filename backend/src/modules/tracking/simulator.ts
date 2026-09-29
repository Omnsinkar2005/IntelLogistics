import cron from "node-cron";
import { prisma } from "../../db/client";
import { ShipmentStatus, LocationSource } from "../../../generated/prisma/client";
import { interpolatePolyline, resolvePlannedRouteDistanceKm } from "../../shared/utils";
import { evaluateSLARisk, resolveActiveSLARisk } from "../sla/service";
import { recalculateETA } from "./service";

export type SimulationStatus = "RUNNING" | "PAUSED";
export type SimulationMode = "NORMAL" | "REDUCED" | "STOPPED" | "TRAFFIC";

export interface SimState {
  shipmentId: string;
  vehicleId: string;
  routePoints: [number, number][]; // [lng, lat] GeoJSON order
  totalDistanceKm: number;
  progressFraction: number;       // 0 → 1
  speedKmh: number;
  status: SimulationStatus;
  mode: SimulationMode;
}

const activeSimulations = new Map<string, SimState>();

// Tick every 10 seconds
const TICK_INTERVAL_SECONDS = 10;
// Base speeds for modes
const BASE_SPEED_KMH = 55;
const REDUCED_SPEED_KMH = 20;
const TRAFFIC_SPEED_KMH = 5;

export function startSimulation(shipmentId: string) {
  const existing = activeSimulations.get(shipmentId);
  if (existing) {
    existing.status = "RUNNING";
    return;
  }
  
  // State will be lazily loaded on first tick
  activeSimulations.set(shipmentId, {
    shipmentId,
    vehicleId: "",
    routePoints: [],
    totalDistanceKm: 0,
    progressFraction: 0,
    speedKmh: BASE_SPEED_KMH,
    status: "RUNNING",
    mode: "NORMAL",
  });
}

export function pauseSimulation(shipmentId: string) {
  const existing = activeSimulations.get(shipmentId);
  if (existing) {
    existing.status = "PAUSED";
  }
}

export function setSimulationMode(shipmentId: string, mode: SimulationMode) {
  const existing = activeSimulations.get(shipmentId);
  if (existing) {
    existing.mode = mode;
  }
}

export function getSimulationState(shipmentId: string): SimState | null {
  return activeSimulations.get(shipmentId) || null;
}

export function stopSimulation(shipmentId: string) {
  activeSimulations.delete(shipmentId);
}

export function getActiveSimulations(): string[] {
  return Array.from(activeSimulations.keys());
}

async function loadSimState(state: SimState): Promise<SimState | null> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: state.shipmentId },
    select: {
      vehicleId: true,
      routePolyline: true,
      distanceKm: true,
      originLat: true,
      originLng: true,
      destinationLat: true,
      destinationLng: true,
    },
  });
  if (!shipment) return null;

  let points: [number, number][] = [];
  if (shipment.routePolyline) {
    points = shipment.routePolyline as [number, number][];
  } else {
    // Fallback: straight line with 10 intermediate points
    const oLat = Number(shipment.originLat);
    const oLng = Number(shipment.originLng);
    const dLat = Number(shipment.destinationLat);
    const dLng = Number(shipment.destinationLng);
    for (let i = 0; i <= 10; i++) {
      const f = i / 10;
      points.push([oLng + f * (dLng - oLng), oLat + f * (dLat - oLat)]);
    }
  }

  const totalKm = resolvePlannedRouteDistanceKm({
    distanceKm: shipment.distanceKm ? Number(shipment.distanceKm) : null,
    originLat: Number(shipment.originLat),
    originLng: Number(shipment.originLng),
    destinationLat: Number(shipment.destinationLat),
    destinationLng: Number(shipment.destinationLng),
  });

  return {
    ...state,
    vehicleId: shipment.vehicleId,
    routePoints: points,
    totalDistanceKm: totalKm,
  };
}

async function tick() {
  for (const [shipmentId, state] of activeSimulations.entries()) {
    try {
      if (state.status === "PAUSED") continue;

      // Lazy-load route on first tick
      let s = state;
      if (s.routePoints.length === 0) {
        const loaded = await loadSimState(s);
        if (!loaded) { activeSimulations.delete(shipmentId); continue; }
        s = loaded;
        activeSimulations.set(shipmentId, s);
      }

      // Determine speed based on mode
      let targetSpeed = 0;
      if (s.mode === "NORMAL") {
        const speedVariation = (Math.random() - 0.5) * 10;
        targetSpeed = Math.max(20, Math.min(80, BASE_SPEED_KMH + speedVariation));
      } else if (s.mode === "REDUCED") {
        const speedVariation = (Math.random() - 0.5) * 5;
        targetSpeed = Math.max(10, Math.min(30, REDUCED_SPEED_KMH + speedVariation));
      } else if (s.mode === "TRAFFIC") {
        const speedVariation = (Math.random() - 0.5) * 2;
        targetSpeed = Math.max(1, Math.min(10, TRAFFIC_SPEED_KMH + speedVariation));
      } else if (s.mode === "STOPPED") {
        targetSpeed = 0;
      }

      s.speedKmh = targetSpeed;

      // Advance progress if moving
      if (s.speedKmh > 0) {
        const distancePerTick = (s.speedKmh * TICK_INTERVAL_SECONDS) / 3600;
        const fractionPerTick = distancePerTick / s.totalDistanceKm;
        s.progressFraction = Math.min(1, s.progressFraction + fractionPerTick);
      }
      activeSimulations.set(shipmentId, s);

      const { lat, lng, heading } = interpolatePolyline(s.routePoints, s.progressFraction);

      // Small GPS jitter only if moving
      const jitter = () => (s.speedKmh > 0 ? (Math.random() - 0.5) * 0.001 : 0);

      await prisma.shipmentLocation.create({
        data: {
          shipmentId,
          vehicleId: s.vehicleId,
          latitude: lat + jitter(),
          longitude: lng + jitter(),
          speedKmh: s.speedKmh,
          heading: s.speedKmh > 0 ? Math.round(heading) : 0,
          source: LocationSource.SIMULATED,
          recordedAt: new Date(),
        },
      });

      // Update shipment status to IN_TRANSIT after first location
      await prisma.shipment.updateMany({
        where: { id: shipmentId, status: ShipmentStatus.DISPATCHED },
        data: { status: ShipmentStatus.IN_TRANSIT },
      });

      // Recalculate ETA and evaluate SLA risk
      await recalculateETA(shipmentId, lat, lng, s.speedKmh, s.totalDistanceKm);
      await evaluateSLARisk(shipmentId);

      // Stop simulation when arrived
      if (s.progressFraction >= 1) {
        await prisma.shipment.updateMany({
          where: {
            id: shipmentId,
            status: { in: [ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELAYED, ShipmentStatus.AT_RISK] },
          },
          data: { status: ShipmentStatus.DELIVERED, deliveredAt: new Date() },
        });
        await resolveActiveSLARisk(shipmentId);
        activeSimulations.delete(shipmentId);
      }
    } catch (err) {
      console.error(`[Simulator] Error for shipment ${shipmentId}:`, err);
    }
  }
}

export function startSimulatorCron() {
  cron.schedule(`*/${TICK_INTERVAL_SECONDS} * * * * *`, tick);
  console.log(`[Simulator] GPS simulation cron started (every ${TICK_INTERVAL_SECONDS}s)`);
}
