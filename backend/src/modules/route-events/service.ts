import { prisma } from "../../db/client";
import { NotFoundError } from "../../shared/errors";
import { getRouteEventProviders } from "./registry";
import { RouteEventBoundingBox, RouteEventRecord } from "./types";

function buildCorridorBbox(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  bufferDeg = 0.5
): RouteEventBoundingBox {
  return {
    latMin: Math.min(lat1, lat2) - bufferDeg,
    latMax: Math.max(lat1, lat2) + bufferDeg,
    lngMin: Math.min(lng1, lng2) - bufferDeg,
    lngMax: Math.max(lng1, lng2) + bufferDeg,
  };
}

export function bboxesOverlap(a: RouteEventBoundingBox, b: RouteEventBoundingBox): boolean {
  return (
    a.latMin <= b.latMax &&
    a.latMax >= b.latMin &&
    a.lngMin <= b.lngMax &&
    a.lngMax >= b.lngMin
  );
}

/** Aggregates active events across every registered provider. */
async function fetchAllProviderEvents(now: Date): Promise<RouteEventRecord[]> {
  const providers = getRouteEventProviders();
  const results = await Promise.all(providers.map((p) => p.fetchActiveEvents({ now })));
  return results.flat();
}

export async function getAllActiveEvents(): Promise<RouteEventRecord[]> {
  return fetchAllProviderEvents(new Date());
}

/**
 * Determines which currently-active events are *relevant* to a shipment:
 * events whose affected area overlaps the corridor between the vehicle's
 * current position and its destination. This relevance filtering is what
 * feeds the SLA risk engine — only events that pass this check are able
 * to contribute to a shipment's risk assessment.
 */
export async function getActiveEventsForShipment(
  shipmentId: string,
  currentLat: number,
  currentLng: number,
  destLat: number,
  destLng: number
): Promise<RouteEventRecord[]> {
  const now = new Date();
  const corridorBbox = buildCorridorBbox(currentLat, currentLng, destLat, destLng);

  const events = await fetchAllProviderEvents(now);
  return events.filter((e) => bboxesOverlap(corridorBbox, e.affectedRegion));
}

export async function getEventsForShipment(shipmentId: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new NotFoundError("Shipment", shipmentId);

  const events = await getActiveEventsForShipment(
    shipmentId,
    Number(shipment.originLat),
    Number(shipment.originLng),
    Number(shipment.destinationLat),
    Number(shipment.destinationLng)
  );

  // Record the link for history/audit. Only events already persisted by
  // their provider (i.e. have an `id`) can be linked today — a future
  // live-API provider would need to persist a new RouteEvent row first.
  for (const event of events) {
    if (!event.id) continue;
    await prisma.shipmentRouteEvent.upsert({
      where: { shipmentId_routeEventId: { shipmentId, routeEventId: event.id } },
      update: {},
      create: { shipmentId, routeEventId: event.id },
    });
  }

  return events;
}
