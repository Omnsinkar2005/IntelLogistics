import { Prisma, ShipmentStatus } from "../../../generated/prisma/client";
import { prisma } from "../../db/client";
import { NotFoundError } from "../../shared/errors";
import { resolvePlannedRouteDistanceKm } from "../../shared/utils";
import { getHistoricalAvgSpeedKmh } from "../eta/service";
import { getActiveEventsForShipment } from "../route-events/service";
import { SLA_RISK_THRESHOLDS } from "./config";
import { getSLARiskEngine, riskLevelToStatus } from "./engine";
import { RiskReason, SLARiskEngineResult, SLAStatus } from "./types";

const TERMINAL_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.DELIVERED,
  ShipmentStatus.COMPLETED,
  ShipmentStatus.CANCELLED,
];

/**
 * Continuous stop duration (minutes), derived from recent GPS history
 * rather than "time since last update" (which measures feed staleness,
 * not how long the vehicle has actually been stationary). Looks back far
 * enough to comfortably exceed `vehicleStoppedMinutes`.
 */
async function computeStoppedDurationMinutes(shipmentId: string, now: Date): Promise<number> {
  const recent = await prisma.shipmentLocation.findMany({
    where: { shipmentId },
    orderBy: { recordedAt: "desc" },
    take: 200, // ~33 minutes of history at the simulator's 10s tick rate
    select: { speedKmh: true, recordedAt: true },
  });
  if (recent.length === 0) return 0;

  let stoppedSinceIndex = -1;
  for (let i = 0; i < recent.length; i++) {
    if (Number(recent[i].speedKmh ?? 0) < SLA_RISK_THRESHOLDS.stoppedSpeedKmh) {
      stoppedSinceIndex = i;
    } else {
      break;
    }
  }
  if (stoppedSinceIndex === -1) return 0;

  const oldestStoppedReading = recent[stoppedSinceIndex];
  return Math.max(0, (now.getTime() - oldestStoppedReading.recordedAt.getTime()) / 60_000);
}

/**
 * Schedule variance so far: how many minutes behind the historical pace
 * the shipment already is, based on distance covered since dispatch vs.
 * the time that should have taken at the expected average speed.
 */
function computeAccumulatedDelayMinutes(params: {
  dispatchedAt: Date | null;
  totalDistanceKm: number;
  remainingDistanceKm: number | null;
  historicalAvgSpeedKmh: number;
  now: Date;
}): number {
  const { dispatchedAt, totalDistanceKm, remainingDistanceKm, historicalAvgSpeedKmh, now } = params;
  if (!dispatchedAt || remainingDistanceKm == null || totalDistanceKm <= 0 || historicalAvgSpeedKmh <= 0) {
    return 0;
  }
  const distanceCoveredKm = Math.max(0, totalDistanceKm - remainingDistanceKm);
  const actualElapsedMinutes = (now.getTime() - dispatchedAt.getTime()) / 60_000;
  const expectedElapsedMinutes = (distanceCoveredKm / historicalAvgSpeedKmh) * 60;
  return Math.max(0, actualElapsedMinutes - expectedElapsedMinutes);
}

async function closeActiveRisk(shipmentId: string, resolvedAt: Date) {
  await prisma.sLARiskEvent.updateMany({
    where: { shipmentId, isActive: true },
    data: { isActive: false, resolvedAt },
  });
}

/**
 * Closes out any active SLA risk event for a shipment. Delivery is a
 * significant state change in its own right — call this at the point a
 * shipment is marked DELIVERED so risk history doesn't stay "active"
 * indefinitely for a shipment that has already arrived.
 */
export async function resolveActiveSLARisk(shipmentId: string) {
  await closeActiveRisk(shipmentId, new Date());
}

/**
 * Persists the risk state, creating a new SLARiskEvent history row only on
 * a genuine status transition (ON_TRACK ↔ AT_RISK ↔ HIGH_RISK ↔ BREACH).
 * Between transitions, the active row's explanation is refreshed in place
 * so "why is this at risk" stays current without flooding the history.
 */
async function persistRiskState(shipmentId: string, result: SLARiskEngineResult) {
  if (result.status === "ON_TRACK" || result.status === "DELIVERED") {
    await closeActiveRisk(shipmentId, result.calculatedAt);
    return;
  }

  const active = await prisma.sLARiskEvent.findFirst({ where: { shipmentId, isActive: true } });
  const previousStatus: SLAStatus = active ? riskLevelToStatus(active.riskLevel) : "ON_TRACK";

  const reasonsJson = result.reasons as unknown as Prisma.InputJsonValue;

  if (!active || previousStatus !== result.status) {
    if (active) {
      await prisma.sLARiskEvent.update({
        where: { id: active.id },
        data: { isActive: false, resolvedAt: result.calculatedAt },
      });
    }
    await prisma.sLARiskEvent.create({
      data: {
        shipmentId,
        status: result.status,
        riskLevel: result.riskLevel,
        predictedDelayMinutes: result.predictedDelayMinutes,
        bufferMinutes: result.bufferMinutes,
        confidence: result.confidence,
        confidenceReason: result.confidenceReason,
        reasons: reasonsJson,
        isActive: true,
        triggeredAt: result.calculatedAt,
      },
    });
  } else {
    await prisma.sLARiskEvent.update({
      where: { id: active.id },
      data: {
        predictedDelayMinutes: result.predictedDelayMinutes,
        bufferMinutes: result.bufferMinutes,
        confidence: result.confidence,
        confidenceReason: result.confidenceReason,
        reasons: reasonsJson,
      },
    });
  }
}

async function syncShipmentStatus(shipmentId: string, currentStatus: ShipmentStatus, riskStatus: SLAStatus) {
  let newStatus: ShipmentStatus | null = null;
  if (riskStatus === "ON_TRACK") {
    if (currentStatus === ShipmentStatus.AT_RISK || currentStatus === ShipmentStatus.DELAYED) {
      newStatus = ShipmentStatus.IN_TRANSIT;
    }
  } else if (riskStatus === "AT_RISK") {
    newStatus = ShipmentStatus.DELAYED;
  } else if (riskStatus === "HIGH_RISK" || riskStatus === "BREACH") {
    newStatus = ShipmentStatus.AT_RISK;
  }

  if (newStatus && newStatus !== currentStatus) {
    await prisma.shipment.updateMany({
      where: {
        id: shipmentId,
        status: { in: [ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELAYED, ShipmentStatus.AT_RISK] },
      },
      data: { status: newStatus },
    });
  }
}

/**
 * Runs the predictive SLA risk engine for a shipment and persists the
 * result. Called by the tracking layer whenever a new GPS position is
 * received (currently: every simulator tick).
 */
export async function evaluateSLARisk(shipmentId: string): Promise<SLARiskEngineResult | null> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { sla: true },
  });
  if (!shipment || !shipment.sla) return null;

  const now = new Date();

  if (TERMINAL_STATUSES.includes(shipment.status)) {
    await closeActiveRisk(shipmentId, now);
    return null;
  }

  const [latestLocation, latestEta] = await Promise.all([
    prisma.shipmentLocation.findFirst({ where: { shipmentId }, orderBy: { recordedAt: "desc" } }),
    prisma.eTASnapshot.findFirst({ where: { shipmentId }, orderBy: { calculatedAt: "desc" } }),
  ]);

  const minutesSinceLastUpdate = latestLocation
    ? (now.getTime() - latestLocation.recordedAt.getTime()) / 60_000
    : 9999;

  const stoppedDurationMinutes = await computeStoppedDurationMinutes(shipmentId, now);

  const activeRouteEvents = latestLocation
    ? await getActiveEventsForShipment(
        shipmentId,
        Number(latestLocation.latitude),
        Number(latestLocation.longitude),
        Number(shipment.destinationLat),
        Number(shipment.destinationLng)
      )
    : [];

  const totalDistanceKm = resolvePlannedRouteDistanceKm({
    distanceKm: shipment.distanceKm ? Number(shipment.distanceKm) : null,
    originLat: Number(shipment.originLat),
    originLng: Number(shipment.originLng),
    destinationLat: Number(shipment.destinationLat),
    destinationLng: Number(shipment.destinationLng),
  });

  const historicalAvgSpeedKmh = getHistoricalAvgSpeedKmh(totalDistanceKm, shipment.sla.agreedTatHours);
  const remainingDistanceKm = latestEta ? Number(latestEta.distanceRemainingKm) : totalDistanceKm;

  const accumulatedDelayMinutes = computeAccumulatedDelayMinutes({
    dispatchedAt: shipment.dispatchedAt,
    totalDistanceKm,
    remainingDistanceKm,
    historicalAvgSpeedKmh,
    now,
  });

  const result = getSLARiskEngine().assess({
    slaDeadline: shipment.sla.deadline,
    estimatedArrival: latestEta?.estimatedArrival ?? null,
    isDelivered: false,
    currentSpeedKmh: latestLocation ? Number(latestLocation.speedKmh ?? 0) : 0,
    historicalAvgSpeedKmh,
    minutesSinceLastUpdate,
    stoppedDurationMinutes,
    remainingDistanceKm,
    accumulatedDelayMinutes,
    activeRouteEvents: activeRouteEvents.map((e) => ({
      title: e.title,
      eventType: e.eventType,
      affectedCity: e.affectedCity,
      severity: e.severity,
      estimatedDelayMinutes: e.estimatedDelayMinutes,
    })),
    now,
  });

  await persistRiskState(shipmentId, result);
  await syncShipmentStatus(shipmentId, shipment.status, result.status);

  return result;
}

export async function getShipmentSLA(shipmentId: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new NotFoundError("Shipment", shipmentId);

  const sla = await prisma.sLA.findUnique({ where: { shipmentId } });
  if (!sla) return null;

  const minutesToDeadline = Math.round((sla.deadline.getTime() - Date.now()) / 60_000);
  return { ...sla, minutesToDeadline };
}

export async function getShipmentSLARisk(shipmentId: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new NotFoundError("Shipment", shipmentId);

  const activeRisk = await prisma.sLARiskEvent.findFirst({
    where: { shipmentId, isActive: true },
    orderBy: { triggeredAt: "desc" },
  });

  const history = await prisma.sLARiskEvent.findMany({
    where: { shipmentId },
    orderBy: { triggeredAt: "desc" },
    take: 10,
  });

  return { activeRisk, history };
}

export type { RiskReason };
