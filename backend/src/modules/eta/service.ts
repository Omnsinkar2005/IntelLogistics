import { prisma } from "../../db/client";
import { getActiveEventsForShipment } from "../route-events/service";
import { classifyStatus, determineConfidence, getETAEngine } from "./engine";
import { ETAEngineResult } from "./types";

// Assumed average speed (km/h) for an Indian interstate cargo run, used only
// when a shipment has no SLA-derived speed assumption to fall back on.
const DEFAULT_HISTORICAL_AVG_SPEED_KMH = 45;

/**
 * Derives a "historical/planned" average speed assumption for the route
 * from the shipment's agreed SLA transit time and route distance — i.e.
 * the pace the transporter already committed to. Falls back to a fixed
 * assumption when that isn't available.
 */
export function getHistoricalAvgSpeedKmh(
  totalDistanceKm: number,
  agreedTatHours: number | null | undefined
): number {
  if (agreedTatHours && agreedTatHours > 0 && totalDistanceKm > 0) {
    return totalDistanceKm / agreedTatHours;
  }
  return DEFAULT_HISTORICAL_AVG_SPEED_KMH;
}

/**
 * Recalculates ETA for a shipment from its latest known position and
 * persists a snapshot. Called by the tracking layer whenever a new GPS
 * position is received (currently: every simulator tick).
 */
export async function recalculateETA(
  shipmentId: string,
  currentLat: number,
  currentLng: number,
  currentSpeedKmh: number,
  plannedRouteDistanceKm: number
): Promise<ETAEngineResult | null> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { sla: { select: { agreedTatHours: true } } },
  });
  if (!shipment) return null;

  const activeEvents = await getActiveEventsForShipment(
    shipmentId,
    currentLat,
    currentLng,
    Number(shipment.destinationLat),
    Number(shipment.destinationLng)
  );
  const routeEventDelayMinutes = activeEvents.reduce((sum, e) => sum + e.estimatedDelayMinutes, 0);

  const historicalAvgSpeedKmh = getHistoricalAvgSpeedKmh(
    plannedRouteDistanceKm,
    shipment.sla?.agreedTatHours
  );

  const result = getETAEngine().calculate({
    currentLat,
    currentLng,
    destinationLat: Number(shipment.destinationLat),
    destinationLng: Number(shipment.destinationLng),
    currentSpeedKmh,
    plannedRouteDistanceKm,
    originLat: Number(shipment.originLat),
    originLng: Number(shipment.originLng),
    historicalAvgSpeedKmh,
    routeEventDelayMinutes,
  });

  await prisma.eTASnapshot.create({
    data: {
      shipmentId,
      estimatedArrival: result.estimatedArrival,
      distanceRemainingKm: result.remainingDistanceKm,
      // Store the raw GPS speed reading (not the fallback-substituted
      // "effective" speed) so status can be correctly reclassified on
      // read — see `enrichPersistedSnapshot` below.
      avgSpeedKmh: Math.round(currentSpeedKmh * 100) / 100,
      routeEventDelayMins: result.routeEventDelayMinutes,
      calculatedAt: result.calculatedAt,
    },
  });

  return result;
}

/**
 * Reconstructs the explainable status/confidence/duration/effective-speed
 * for a persisted ETASnapshot, using the same pure classification rules
 * as a fresh calculation. `currentSpeedKmh` must be the raw GPS speed
 * reading captured at calculation time (not a fallback-adjusted speed),
 * otherwise a stopped vehicle whose fallback speed happens to fall in the
 * normal range would be misclassified as moving normally.
 *
 * The speed actually used for the travel-time projection (current speed,
 * or the historical-average fallback when stopped) is reverse-derived
 * from remaining distance ÷ encoded travel time, so no extra column is
 * needed to keep it — this makes the round-trip lossless.
 */
export function enrichPersistedSnapshot(snapshot: {
  estimatedArrival: Date;
  distanceRemainingKm: number;
  currentSpeedKmh: number;
  routeEventDelayMins: number;
  calculatedAt: Date;
}): ETAEngineResult {
  const status = classifyStatus(snapshot.distanceRemainingKm, snapshot.currentSpeedKmh);
  const { confidence, confidenceReason } = determineConfidence(status, snapshot.routeEventDelayMins);

  const totalMinutes = (snapshot.estimatedArrival.getTime() - snapshot.calculatedAt.getTime()) / 60_000;
  const travelDurationMinutes = Math.max(0, totalMinutes - snapshot.routeEventDelayMins);

  const effectiveSpeedKmh =
    travelDurationMinutes > 0.01
      ? (snapshot.distanceRemainingKm / travelDurationMinutes) * 60
      : snapshot.currentSpeedKmh;

  return {
    estimatedArrival: snapshot.estimatedArrival,
    remainingDistanceKm: snapshot.distanceRemainingKm,
    estimatedTravelDurationMinutes: Math.round(travelDurationMinutes),
    effectiveSpeedKmh: Math.round(effectiveSpeedKmh * 100) / 100,
    routeEventDelayMinutes: snapshot.routeEventDelayMins,
    calculatedAt: snapshot.calculatedAt,
    status,
    confidence,
    confidenceReason,
    engine: getETAEngine().name,
  };
}
