// ─────────────────────────────────────────────────────────────────────────
// ETA ENGINE — CONTRACT
//
// This interface is the swap point for future ETA providers (Mapbox,
// Google Directions, OSRM, or an ML model). The rest of the system only
// ever talks to `ETAEngine.calculate()` — it never depends on how the
// number was produced.
// ─────────────────────────────────────────────────────────────────────────

export type ETAStatus = "ON_ROUTE" | "SLOW_MOVING" | "STOPPED" | "ARRIVING";
export type ETAConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface ETAEngineInput {
  currentLat: number;
  currentLng: number;
  destinationLat: number;
  destinationLng: number;
  /** Instantaneous speed from the latest GPS fix (km/h). */
  currentSpeedKmh: number;
  /**
   * Planned/historical route distance (km), e.g. the shipment's route
   * polyline length or straight-line origin→destination distance captured
   * at dispatch. Used to scale straight-line remaining distance so it
   * better approximates road distance. Falls back to raw haversine when
   * not available.
   */
  plannedRouteDistanceKm?: number;
  originLat?: number;
  originLng?: number;
  /**
   * Assumed average speed (km/h) for this route, derived from historical
   * data (e.g. the agreed SLA transit time over the route distance). Used
   * as the fallback when the current GPS speed is not a reliable signal
   * (vehicle stopped, no recent fix).
   */
  historicalAvgSpeedKmh: number;
  /** Known additive delay from active route disruptions (minutes). */
  routeEventDelayMinutes?: number;
  /** Calculation timestamp — defaults to `new Date()`. Injectable for tests. */
  now?: Date;
}

export interface ETAEngineResult {
  /** Predicted arrival time. */
  estimatedArrival: Date;
  /** Remaining distance to destination (km). */
  remainingDistanceKm: number;
  /** Predicted time on the road, excluding route-event delay (minutes). */
  estimatedTravelDurationMinutes: number;
  /** Speed assumption actually used for the projection (km/h). */
  effectiveSpeedKmh: number;
  /** Additive delay from active route disruptions (minutes). */
  routeEventDelayMinutes: number;
  /** When this result was produced. */
  calculatedAt: Date;
  /** Deterministic movement status driving the calculation strategy. */
  status: ETAStatus;
  /** How much to trust this estimate. */
  confidence: ETAConfidence;
  /** Human-readable explanation of the confidence rating. */
  confidenceReason: string;
  /** Identifies which engine produced this result. */
  engine: string;
}

export interface ETAEngine {
  readonly name: string;
  calculate(input: ETAEngineInput): ETAEngineResult;
}
