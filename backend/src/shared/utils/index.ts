export function generateReferenceNumber(prefix: string, sequence: number): string {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

/** Haversine distance in km between two lat/lng points */
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Check if a point is inside a bounding box */
export function pointInBbox(
  lat: number, lng: number,
  bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number }
): boolean {
  return lat >= bbox.latMin && lat <= bbox.latMax && lng >= bbox.lngMin && lng <= bbox.lngMax;
}

/** Interpolate a point along a polyline by fraction 0–1 */
export function interpolatePolyline(
  points: [number, number][],
  fraction: number
): { lat: number; lng: number; heading: number } {
  if (points.length === 0) return { lat: 0, lng: 0, heading: 0 };
  if (fraction <= 0) return { lat: points[0][1], lng: points[0][0], heading: 0 };
  if (fraction >= 1) {
    const last = points[points.length - 1];
    return { lat: last[1], lng: last[0], heading: 0 };
  }

  // Compute total length
  let totalDist = 0;
  const segments: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = haversineKm(points[i - 1][1], points[i - 1][0], points[i][1], points[i][0]);
    segments.push(d);
    totalDist += d;
  }

  const target = fraction * totalDist;
  let accumulated = 0;
  for (let i = 0; i < segments.length; i++) {
    if (accumulated + segments[i] >= target) {
      const segFrac = (target - accumulated) / segments[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const lat = p1[1] + segFrac * (p2[1] - p1[1]);
      const lng = p1[0] + segFrac * (p2[0] - p1[0]);
      const heading = bearingDeg(p1[1], p1[0], p2[1], p2[0]);
      return { lat, lng, heading };
    }
    accumulated += segments[i];
  }

  const last = points[points.length - 1];
  return { lat: last[1], lng: last[0], heading: 0 };
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

/**
 * Planned/historical route distance (km) for a shipment: the persisted
 * route distance when known, otherwise a straight-line fallback. Shared
 * by the GPS simulator and the SLA risk engine so both agree on what
 * "the route" is expected to be.
 */
export function resolvePlannedRouteDistanceKm(params: {
  distanceKm?: number | null;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
}): number {
  if (params.distanceKm && params.distanceKm > 0) return params.distanceKm;
  return haversineKm(params.originLat, params.originLng, params.destinationLat, params.destinationLng);
}
