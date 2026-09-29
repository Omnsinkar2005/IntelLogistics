import { prisma } from "../../db/client";
import { NotFoundError } from "../../shared/errors";
import { ShipmentStatus, SLARiskLevel } from "../../../generated/prisma/client";
import { computeKPIs } from "./engine";
import { HistoricalShipmentRecord, KPIComputationResult } from "./types";

function currentPeriod(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}

/** [start, end) date range covered by a "YYYY-Qn" period string. */
export function getPeriodBounds(period: string): { start: Date; end: Date } {
  const [year, q] = period.split("-Q");
  const quarter = parseInt(q, 10);
  const startMonth = (quarter - 1) * 3;
  const start = new Date(parseInt(year, 10), startMonth, 1);
  const end = new Date(parseInt(year, 10), startMonth + 3, 1);
  return { start, end };
}

async function getHistoricalShipments(transporterId: string, start: Date, end: Date) {
  return prisma.shipment.findMany({
    where: {
      transporterId,
      status: { in: [ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED] },
      deliveredAt: { gte: start, lt: end },
    },
    include: {
      sla: { select: { isBreached: true } },
      pod: { select: { status: true, condition: true } },
      locations: { select: { recordedAt: true } },
      // Any HIGH/CRITICAL risk event ever raised for the shipment counts as an exception,
      // regardless of whether it was later resolved.
      slaEvents: { where: { riskLevel: { in: [SLARiskLevel.HIGH, SLARiskLevel.CRITICAL] } }, select: { id: true }, take: 1 },
    },
  });
}

type HistoricalShipmentRow = Awaited<ReturnType<typeof getHistoricalShipments>>[number];

function toHistoricalRecord(s: HistoricalShipmentRow): HistoricalShipmentRecord {
  return {
    id: s.id,
    status: s.status as "DELIVERED" | "COMPLETED",
    dispatchedAt: s.dispatchedAt,
    deliveredAt: s.deliveredAt,
    slaDeadline: s.slaDeadline,
    slaIsBreached: s.status === ShipmentStatus.COMPLETED ? (s.sla?.isBreached ?? null) : null,
    podStatus: s.pod?.status ?? null,
    podCondition: s.pod?.condition ?? null,
    locationTimestamps: s.locations.map((l) => l.recordedAt),
    hadHighSeverityException: s.slaEvents.length > 0,
  };
}

/** Pure-ish read: computes KPIs for a transporter/period without persisting anything. */
export async function computeKPIsForTransporter(
  transporterId: string,
  period?: string
): Promise<{ period: string; result: KPIComputationResult }> {
  const resolvedPeriod = period ?? currentPeriod();
  const { start, end } = getPeriodBounds(resolvedPeriod);
  const shipments = await getHistoricalShipments(transporterId, start, end);
  const result = computeKPIs(shipments.map(toHistoricalRecord));
  return { period: resolvedPeriod, result };
}

/**
 * Computes and persists a transporter's KPI snapshot for a period, derived
 * entirely from its historical shipments — see `kpi/engine.ts` for the
 * per-KPI eligibility rules. Returns null if there were no settled
 * (DELIVERED/COMPLETED) shipments in the period at all.
 */
export async function recalculateKPI(transporterId: string, period?: string) {
  const transporter = await prisma.transporter.findUnique({ where: { id: transporterId } });
  if (!transporter) throw new NotFoundError("Transporter", transporterId);

  const { period: resolvedPeriod, result } = await computeKPIsForTransporter(transporterId, period);
  if (result.totalShipments === 0) return null;

  const data = {
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
    where: { transporterId_period: { transporterId, period: resolvedPeriod } },
    update: data,
    create: { transporterId, period: resolvedPeriod, ...data },
  });

  return { ...row, components: result.components };
}

export async function getKPISummary() {
  const transporters = await prisma.transporter.findMany({
    where: { isActive: true },
    include: {
      kpis: { orderBy: { computedAt: "desc" }, take: 1 },
      _count: { select: { shipments: true } },
    },
  });

  return transporters.map((t) => ({
    transporter: { id: t.id, name: t.name, city: t.city },
    latestKPI: t.kpis[0] ?? null,
    totalShipments: t._count.shipments,
  }));
}
