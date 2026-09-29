import { prisma } from "../../db/client";
import { NotFoundError } from "../../shared/errors";
import { recalculateETA as computeETA, enrichPersistedSnapshot } from "../eta/service";

export async function getLatestLocation(shipmentId: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new NotFoundError("Shipment", shipmentId);

  const location = await prisma.shipmentLocation.findFirst({
    where: { shipmentId },
    orderBy: { recordedAt: "desc" },
  });

  return location;
}

export async function getLocationHistory(shipmentId: string, limit = 200) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new NotFoundError("Shipment", shipmentId);

  return prisma.shipmentLocation.findMany({
    where: { shipmentId },
    orderBy: { recordedAt: "asc" },
    take: limit,
    select: {
      id: true,
      latitude: true,
      longitude: true,
      speedKmh: true,
      heading: true,
      source: true,
      recordedAt: true,
    },
  });
}

export async function getLatestETA(shipmentId: string) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { sla: true },
  });
  if (!shipment) throw new NotFoundError("Shipment", shipmentId);

  const eta = await prisma.eTASnapshot.findFirst({
    where: { shipmentId },
    orderBy: { calculatedAt: "desc" },
  });

  if (!eta) return null;

  // Reconstruct the explainable status/confidence/duration from the
  // persisted snapshot — see `eta/service.ts` for why this is lossless.
  const enriched = enrichPersistedSnapshot({
    estimatedArrival: eta.estimatedArrival,
    distanceRemainingKm: Number(eta.distanceRemainingKm),
    currentSpeedKmh: Number(eta.avgSpeedKmh),
    routeEventDelayMins: eta.routeEventDelayMins,
    calculatedAt: eta.calculatedAt,
  });

  const now = new Date();
  const minutesToSla = shipment.sla
    ? Math.round((shipment.sla.deadline.getTime() - now.getTime()) / 60_000)
    : null;
  const minutesToEta = Math.round((eta.estimatedArrival.getTime() - now.getTime()) / 60_000);
  const onTrack = shipment.sla ? eta.estimatedArrival <= shipment.sla.deadline : true;

  return {
    ...eta,
    estimatedTravelDurationMinutes: enriched.estimatedTravelDurationMinutes,
    status: enriched.status,
    confidence: enriched.confidence,
    confidenceReason: enriched.confidenceReason,
    engine: enriched.engine,
    minutesToEta,
    minutesToSla,
    onTrack,
    slaDeadline: shipment.sla?.deadline ?? null,
  };
}

/**
 * Recalculates ETA from a fresh GPS position and persists a snapshot.
 * Thin facade over the ETA engine module (`../eta`) — the rest of the
 * shipment/SLA system depends only on this function's signature, so the
 * ETA engine implementation underneath can change without touching them.
 */
export async function recalculateETA(
  shipmentId: string,
  currentLat: number,
  currentLng: number,
  currentSpeedKmh: number,
  plannedRouteDistanceKm: number
) {
  return computeETA(shipmentId, currentLat, currentLng, currentSpeedKmh, plannedRouteDistanceKm);
}
