import { describe, it, expect } from "vitest";
import { calculateETA, classifyStatus, determineConfidence, deterministicETAEngine } from "../engine";
import { ETAEngineInput } from "../types";
import { haversineKm } from "../../../shared/utils";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// Pune → Hyderabad, same corridor used by the matching-engine tests.

const PUNE = { lat: 18.5204, lng: 73.8567 };
const HYDERABAD = { lat: 17.385, lng: 78.4867 };
const NOW = new Date("2026-09-08T10:00:00+05:30");

const STRAIGHT_LINE_KM = haversineKm(PUNE.lat, PUNE.lng, HYDERABAD.lat, HYDERABAD.lng);

const BASE_INPUT: ETAEngineInput = {
  currentLat: PUNE.lat,
  currentLng: PUNE.lng,
  destinationLat: HYDERABAD.lat,
  destinationLng: HYDERABAD.lng,
  currentSpeedKmh: 55,
  plannedRouteDistanceKm: 700, // historical/planned route distance > straight line (road circuity)
  originLat: PUNE.lat,
  originLng: PUNE.lng,
  historicalAvgSpeedKmh: 40,
  routeEventDelayMinutes: 0,
  now: NOW,
};

// ─── Normal speed ───────────────────────────────────────────────────────────

describe("calculateETA — normal speed", () => {
  it("classifies as ON_ROUTE with HIGH confidence", () => {
    const result = calculateETA(BASE_INPUT);
    expect(result.status).toBe("ON_ROUTE");
    expect(result.confidence).toBe("HIGH");
  });

  it("uses the current GPS speed as the effective speed", () => {
    const result = calculateETA(BASE_INPUT);
    expect(result.effectiveSpeedKmh).toBe(55);
  });

  it("scales remaining distance by the route's circuity factor from the planned distance", () => {
    const result = calculateETA(BASE_INPUT);
    const circuityFactor = 700 / STRAIGHT_LINE_KM;
    expect(result.remainingDistanceKm).toBeCloseTo(STRAIGHT_LINE_KM * circuityFactor, 1);
    expect(result.remainingDistanceKm).toBeGreaterThan(STRAIGHT_LINE_KM); // planned route is longer than straight line
  });

  it("derives travel duration and arrival time from remaining distance ÷ speed", () => {
    const result = calculateETA(BASE_INPUT);
    const exactMinutes = (result.remainingDistanceKm / 55) * 60;
    expect(result.estimatedTravelDurationMinutes).toBe(Math.round(exactMinutes));
    // Arrival is derived from the unrounded duration for accuracy; allow sub-second float drift.
    expect(
      Math.abs(result.estimatedArrival.getTime() - (NOW.getTime() + exactMinutes * 60_000))
    ).toBeLessThan(1000);
  });

  it("falls back to raw haversine distance when no planned route distance is available", () => {
    const result = calculateETA({
      ...BASE_INPUT,
      plannedRouteDistanceKm: undefined,
      originLat: undefined,
      originLng: undefined,
    });
    expect(result.remainingDistanceKm).toBeCloseTo(STRAIGHT_LINE_KM, 1);
  });

  it("is produced by the deterministic engine and is reproducible for identical input", () => {
    const a = calculateETA(BASE_INPUT);
    const b = calculateETA(BASE_INPUT);
    expect(a).toEqual(b);
    expect(a.engine).toBe(deterministicETAEngine.name);
  });
});

// ─── Reduced speed ──────────────────────────────────────────────────────────

describe("calculateETA — reduced speed", () => {
  const reducedInput: ETAEngineInput = { ...BASE_INPUT, currentSpeedKmh: 12 };

  it("classifies as SLOW_MOVING with MEDIUM confidence", () => {
    const result = calculateETA(reducedInput);
    expect(result.status).toBe("SLOW_MOVING");
    expect(result.confidence).toBe("MEDIUM");
  });

  it("still projects using the current (reduced) speed, not the historical average", () => {
    const result = calculateETA(reducedInput);
    expect(result.effectiveSpeedKmh).toBe(12);
  });

  it("produces a later arrival than the normal-speed scenario for the same position", () => {
    const normal = calculateETA(BASE_INPUT);
    const reduced = calculateETA(reducedInput);
    expect(reduced.estimatedArrival.getTime()).toBeGreaterThan(normal.estimatedArrival.getTime());
  });
});

// ─── Vehicle stopped ────────────────────────────────────────────────────────

describe("calculateETA — vehicle stopped", () => {
  const stoppedInput: ETAEngineInput = { ...BASE_INPUT, currentSpeedKmh: 0 };

  it("classifies as STOPPED with LOW confidence", () => {
    const result = calculateETA(stoppedInput);
    expect(result.status).toBe("STOPPED");
    expect(result.confidence).toBe("LOW");
  });

  it("falls back to the historical average speed instead of dividing by zero", () => {
    const result = calculateETA(stoppedInput);
    expect(result.effectiveSpeedKmh).toBe(40);
    expect(Number.isFinite(result.estimatedTravelDurationMinutes)).toBe(true);
  });

  it("explains the confidence rating in plain language", () => {
    const result = calculateETA(stoppedInput);
    expect(result.confidenceReason.toLowerCase()).toContain("stationary");
  });
});

// ─── Near destination ───────────────────────────────────────────────────────

describe("calculateETA — near destination", () => {
  // ~1km from the destination
  const nearDestInput: ETAEngineInput = {
    ...BASE_INPUT,
    currentLat: HYDERABAD.lat + 0.005,
    currentLng: HYDERABAD.lng,
    currentSpeedKmh: 30,
  };

  it("classifies as ARRIVING with HIGH confidence, even without route circuity scaling", () => {
    const result = calculateETA(nearDestInput);
    expect(result.remainingDistanceKm).toBeLessThanOrEqual(5);
    expect(result.status).toBe("ARRIVING");
    expect(result.confidence).toBe("HIGH");
  });

  it("uses current speed when moving, and historical average when stopped at arrival", () => {
    const moving = calculateETA(nearDestInput);
    expect(moving.effectiveSpeedKmh).toBe(30);

    const stoppedAtArrival = calculateETA({ ...nearDestInput, currentSpeedKmh: 0 });
    expect(stoppedAtArrival.status).toBe("ARRIVING");
    expect(stoppedAtArrival.effectiveSpeedKmh).toBe(40);
  });

  it("produces a short travel duration", () => {
    const result = calculateETA(nearDestInput);
    expect(result.estimatedTravelDurationMinutes).toBeLessThan(15);
  });
});

// ─── Route event delay ──────────────────────────────────────────────────────

describe("calculateETA — active route event delay", () => {
  it("adds the delay to the estimated arrival on top of travel time", () => {
    const withoutDelay = calculateETA(BASE_INPUT);
    const withDelay = calculateETA({ ...BASE_INPUT, routeEventDelayMinutes: 60 });
    const diffMinutes = (withDelay.estimatedArrival.getTime() - withoutDelay.estimatedArrival.getTime()) / 60_000;
    expect(diffMinutes).toBeCloseTo(60, 0);
    expect(withDelay.routeEventDelayMinutes).toBe(60);
  });

  it("downgrades confidence when the delay is significant", () => {
    const result = calculateETA({ ...BASE_INPUT, routeEventDelayMinutes: 60 });
    expect(result.confidence).toBe("MEDIUM"); // downgraded from HIGH
    expect(result.confidenceReason).toMatch(/disruption/i);
  });

  it("does not downgrade confidence for a minor delay", () => {
    const result = calculateETA({ ...BASE_INPUT, routeEventDelayMinutes: 10 });
    expect(result.confidence).toBe("HIGH");
  });
});

// ─── Pure helpers ───────────────────────────────────────────────────────────

describe("classifyStatus", () => {
  it("returns ARRIVING within the near-destination threshold regardless of speed", () => {
    expect(classifyStatus(2, 0)).toBe("ARRIVING");
    expect(classifyStatus(5, 60)).toBe("ARRIVING");
  });

  it("returns STOPPED below the stopped-speed threshold", () => {
    expect(classifyStatus(100, 1)).toBe("STOPPED");
  });

  it("returns SLOW_MOVING between the stopped and normal thresholds", () => {
    expect(classifyStatus(100, 15)).toBe("SLOW_MOVING");
  });

  it("returns ON_ROUTE at normal speed", () => {
    expect(classifyStatus(100, 60)).toBe("ON_ROUTE");
  });
});

describe("determineConfidence", () => {
  it("is deterministic for the same status and delay", () => {
    const a = determineConfidence("ON_ROUTE", 0);
    const b = determineConfidence("ON_ROUTE", 0);
    expect(a).toEqual(b);
  });

  it("never downgrades below LOW", () => {
    const result = determineConfidence("STOPPED", 999);
    expect(result.confidence).toBe("LOW");
  });
});
