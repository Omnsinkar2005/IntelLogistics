import { describe, it, expect } from "vitest";
import { calculateETA } from "../engine";
import { enrichPersistedSnapshot } from "../service";
import { ETAEngineInput } from "../types";

// Verifies that persisting only { estimatedArrival, distanceRemainingKm,
// avgSpeedKmh (raw GPS speed), routeEventDelayMins, calculatedAt } and
// later reconstructing status/confidence/effectiveSpeed from those fields
// alone reproduces the same classification the live engine produced.
// This matters because a naive implementation that persists the
// *fallback-adjusted* speed (instead of the raw GPS reading) would
// misclassify a stopped vehicle as moving normally on reconstruction.

const PUNE = { lat: 18.5204, lng: 73.8567 };
const HYDERABAD = { lat: 17.385, lng: 78.4867 };
const NOW = new Date("2026-09-08T10:00:00+05:30");

const BASE_INPUT: ETAEngineInput = {
  currentLat: PUNE.lat,
  currentLng: PUNE.lng,
  destinationLat: HYDERABAD.lat,
  destinationLng: HYDERABAD.lng,
  currentSpeedKmh: 55,
  plannedRouteDistanceKm: 700,
  originLat: PUNE.lat,
  originLng: PUNE.lng,
  historicalAvgSpeedKmh: 40,
  routeEventDelayMinutes: 0,
  now: NOW,
};

function roundTrip(input: ETAEngineInput) {
  const live = calculateETA(input);
  // Simulate exactly what `recalculateETA` persists to ETASnapshot.
  const reconstructed = enrichPersistedSnapshot({
    estimatedArrival: live.estimatedArrival,
    distanceRemainingKm: live.remainingDistanceKm,
    currentSpeedKmh: input.currentSpeedKmh, // the raw reading, as actually persisted
    routeEventDelayMins: live.routeEventDelayMinutes,
    calculatedAt: live.calculatedAt,
  });
  return { live, reconstructed };
}

describe("enrichPersistedSnapshot — round trip from persisted fields", () => {
  it("reproduces ON_ROUTE / HIGH confidence for normal speed", () => {
    const { live, reconstructed } = roundTrip(BASE_INPUT);
    expect(reconstructed.status).toBe(live.status);
    expect(reconstructed.status).toBe("ON_ROUTE");
    expect(reconstructed.confidence).toBe("HIGH");
  });

  it("reproduces SLOW_MOVING / MEDIUM confidence for reduced speed", () => {
    const { live, reconstructed } = roundTrip({ ...BASE_INPUT, currentSpeedKmh: 12 });
    expect(reconstructed.status).toBe(live.status);
    expect(reconstructed.status).toBe("SLOW_MOVING");
    expect(reconstructed.confidence).toBe("MEDIUM");
  });

  it("reproduces STOPPED / LOW confidence for a stationary vehicle, not the fallback speed's range", () => {
    const { live, reconstructed } = roundTrip({ ...BASE_INPUT, currentSpeedKmh: 0 });
    expect(live.effectiveSpeedKmh).toBe(40); // historical fallback used for the live projection
    expect(reconstructed.status).toBe(live.status);
    expect(reconstructed.status).toBe("STOPPED"); // must NOT reclassify as ON_ROUTE just because fallback speed was 40
    expect(reconstructed.confidence).toBe("LOW");
  });

  it("reproduces ARRIVING / HIGH confidence near the destination", () => {
    const nearDest: ETAEngineInput = {
      ...BASE_INPUT,
      currentLat: HYDERABAD.lat + 0.005,
      currentLng: HYDERABAD.lng,
      currentSpeedKmh: 30,
    };
    const { live, reconstructed } = roundTrip(nearDest);
    expect(reconstructed.status).toBe(live.status);
    expect(reconstructed.status).toBe("ARRIVING");
    expect(reconstructed.confidence).toBe("HIGH");
  });

  it("reverse-derives the effective speed used for the projection within rounding tolerance", () => {
    const { live, reconstructed } = roundTrip({ ...BASE_INPUT, currentSpeedKmh: 0 });
    expect(reconstructed.effectiveSpeedKmh).toBeCloseTo(live.effectiveSpeedKmh, 0);
  });

  it("reverse-derives estimated travel duration matching the live calculation", () => {
    const { live, reconstructed } = roundTrip(BASE_INPUT);
    expect(reconstructed.estimatedTravelDurationMinutes).toBe(live.estimatedTravelDurationMinutes);
  });
});
