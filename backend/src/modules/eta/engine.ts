import { haversineKm } from "../../shared/utils";
import { ETAConfidence, ETAEngine, ETAEngineInput, ETAEngineResult, ETAStatus } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// DETERMINISTIC ETA ENGINE
//
// No ML, no external routing API. ETA is derived purely from:
//   remaining distance ÷ speed assumption, plus known route-event delay.
//
// Speed assumption and confidence are picked by simple, explainable rules
// (see `determineStatusAndSpeed` / `determineConfidence` below) — the same
// "movement status → deterministic outcome" shape used by the SLA rules
// engine (`src/modules/sla/rules`).
// ─────────────────────────────────────────────────────────────────────────

// Configurable thresholds — can be moved to DB config later.
const THRESHOLDS = {
  stoppedSpeedKmh: 2, // below this, the vehicle is considered stationary
  slowSpeedKmh: 20, // below this (but moving), speed is "reduced"
  nearDestinationKm: 5, // within this distance, estimate error is bounded
  significantRouteEventDelayMins: 45, // route disruption large enough to downgrade confidence
  minSpeedFloorKmh: 5, // floor applied to the speed used for division, to avoid absurd/infinite durations
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Remaining distance from the current position to the destination.
 *
 * Uses straight-line (haversine) distance, scaled by the route's known
 * circuity factor (planned route distance ÷ straight-line origin→destination
 * distance) when a historical/planned route distance is available. This is
 * the "historical route assumption" — it approximates road distance without
 * needing a real routing API.
 */
function computeRemainingDistanceKm(input: ETAEngineInput): number {
  const straightLineRemaining = haversineKm(
    input.currentLat,
    input.currentLng,
    input.destinationLat,
    input.destinationLng
  );

  if (
    input.plannedRouteDistanceKm &&
    input.plannedRouteDistanceKm > 0 &&
    input.originLat != null &&
    input.originLng != null
  ) {
    const straightLineTotal = haversineKm(
      input.originLat,
      input.originLng,
      input.destinationLat,
      input.destinationLng
    );
    if (straightLineTotal > 0.01) {
      const circuityFactor = input.plannedRouteDistanceKm / straightLineTotal;
      return straightLineRemaining * circuityFactor;
    }
  }

  return straightLineRemaining;
}

/**
 * Classifies movement status from remaining distance + speed alone, with
 * no other context. Pure and side-effect free, so it can be used both to
 * drive a fresh calculation and to reconstruct status from a previously
 * persisted ETA snapshot (see `eta/service.ts`).
 */
export function classifyStatus(remainingDistanceKm: number, speedKmh: number): ETAStatus {
  if (remainingDistanceKm <= THRESHOLDS.nearDestinationKm) return "ARRIVING";
  if (speedKmh < THRESHOLDS.stoppedSpeedKmh) return "STOPPED";
  if (speedKmh < THRESHOLDS.slowSpeedKmh) return "SLOW_MOVING";
  return "ON_ROUTE";
}

function determineStatusAndSpeed(
  remainingDistanceKm: number,
  currentSpeedKmh: number,
  historicalAvgSpeedKmh: number
): { status: ETAStatus; effectiveSpeedKmh: number } {
  const status = classifyStatus(remainingDistanceKm, currentSpeedKmh);

  if (status === "ARRIVING") {
    const effectiveSpeedKmh =
      currentSpeedKmh >= THRESHOLDS.stoppedSpeedKmh ? currentSpeedKmh : historicalAvgSpeedKmh;
    return { status, effectiveSpeedKmh };
  }

  if (status === "STOPPED") {
    return { status, effectiveSpeedKmh: historicalAvgSpeedKmh };
  }

  return { status, effectiveSpeedKmh: currentSpeedKmh };
}

function downgrade(level: ETAConfidence): ETAConfidence {
  if (level === "HIGH") return "MEDIUM";
  return "LOW";
}

export function determineConfidence(
  status: ETAStatus,
  routeEventDelayMinutes: number
): { confidence: ETAConfidence; confidenceReason: string } {
  let confidence: ETAConfidence;
  const reasons: string[] = [];

  switch (status) {
    case "ARRIVING":
      confidence = "HIGH";
      reasons.push("Vehicle is close to the destination, so the estimate error is bounded");
      break;
    case "ON_ROUTE":
      confidence = "HIGH";
      reasons.push("Vehicle is moving at a normal speed for this route");
      break;
    case "SLOW_MOVING":
      confidence = "MEDIUM";
      reasons.push("Vehicle speed is below the normal range; projection uses the current reduced speed");
      break;
    case "STOPPED":
      confidence = "LOW";
      reasons.push("Vehicle is stationary; projection falls back to the historical average speed for this route");
      break;
  }

  if (routeEventDelayMinutes >= THRESHOLDS.significantRouteEventDelayMins) {
    confidence = downgrade(confidence);
    reasons.push(`Active route disruptions are adding ${routeEventDelayMinutes} minutes of delay`);
  }

  return { confidence, confidenceReason: reasons.join(". ") };
}

export function calculateETA(input: ETAEngineInput): ETAEngineResult {
  const now = input.now ?? new Date();
  const routeEventDelayMinutes = Math.max(0, Math.round(input.routeEventDelayMinutes ?? 0));

  const remainingDistanceKm = computeRemainingDistanceKm(input);
  const { status, effectiveSpeedKmh } = determineStatusAndSpeed(
    remainingDistanceKm,
    input.currentSpeedKmh,
    input.historicalAvgSpeedKmh
  );
  const safeSpeedKmh = Math.max(effectiveSpeedKmh, THRESHOLDS.minSpeedFloorKmh);

  const estimatedTravelDurationMinutes = (remainingDistanceKm / safeSpeedKmh) * 60;
  const estimatedArrival = new Date(
    now.getTime() + (estimatedTravelDurationMinutes + routeEventDelayMinutes) * 60_000
  );

  const { confidence, confidenceReason } = determineConfidence(status, routeEventDelayMinutes);

  return {
    estimatedArrival,
    remainingDistanceKm: round2(remainingDistanceKm),
    estimatedTravelDurationMinutes: Math.round(estimatedTravelDurationMinutes),
    effectiveSpeedKmh: round2(safeSpeedKmh),
    routeEventDelayMinutes,
    calculatedAt: now,
    status,
    confidence,
    confidenceReason,
    engine: deterministicETAEngine.name,
  };
}

/**
 * Default POC engine. Swap this for a `MapboxETAEngine`, `OSRMETAEngine`,
 * or ML-based engine later by implementing `ETAEngine` and changing what
 * `getETAEngine()` returns — nothing outside this module needs to change.
 */
export const deterministicETAEngine: ETAEngine = {
  name: "deterministic-v1",
  calculate: calculateETA,
};

export function getETAEngine(): ETAEngine {
  return deterministicETAEngine;
}
