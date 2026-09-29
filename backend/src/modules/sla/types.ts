import { SLARiskLevel } from "../../../generated/prisma/client";

// ─────────────────────────────────────────────────────────────────────────
// SLA RISK ENGINE — CONTRACT
//
// This interface is the swap point for a future ML model. The rest of the
// system only ever talks to `SLARiskEngine.assess()` — it never depends on
// how the prediction was produced. A future implementation can replace the
// deterministic engine entirely, or wrap it and blend its output with a
// learned model (e.g. use the rule engine's reasons for explainability
// while an ML model refines `predictedDelayMinutes`).
// ─────────────────────────────────────────────────────────────────────────

export type SLAStatus = "ON_TRACK" | "AT_RISK" | "HIGH_RISK" | "BREACH" | "DELIVERED";
export type RiskConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface RouteEventInput {
  title: string;
  eventType: string;
  affectedCity: string | null;
  severity: SLARiskLevel;
  estimatedDelayMinutes: number;
}

export interface RiskReason {
  code: string;
  description: string;
  impactMinutes: number;
  severity: SLARiskLevel;
}

export interface SLARiskEngineInput {
  slaDeadline: Date;
  /** Latest ETA engine prediction. Null when no GPS position has been received yet. */
  estimatedArrival: Date | null;
  /** True once the shipment has been delivered — short-circuits to DELIVERED. */
  isDelivered: boolean;
  currentSpeedKmh: number;
  /** Expected average speed for this route (e.g. derived from the agreed SLA transit time). */
  historicalAvgSpeedKmh: number;
  /** Minutes since the last GPS fix was received (staleness, not stop duration). */
  minutesSinceLastUpdate: number;
  /** Minutes the vehicle has been continuously at/near zero speed. */
  stoppedDurationMinutes: number;
  remainingDistanceKm: number;
  /** Schedule variance so far: actual elapsed time minus expected elapsed time at the historical pace. */
  accumulatedDelayMinutes: number;
  activeRouteEvents: RouteEventInput[];
  /** Calculation timestamp — defaults to `new Date()`. Injectable for tests. */
  now?: Date;
}

export interface SLARiskEngineResult {
  status: SLAStatus;
  /** Legacy severity, derived 1:1 from `status` — kept for existing color-coded UI. */
  riskLevel: SLARiskLevel;
  predictedDelayMinutes: number;
  /** Minutes remaining between now and the SLA deadline. */
  bufferMinutes: number;
  reasons: RiskReason[];
  confidence: RiskConfidence;
  confidenceReason: string;
  calculatedAt: Date;
  engine: string;
}

export interface SLARiskEngine {
  readonly name: string;
  assess(input: SLARiskEngineInput): SLARiskEngineResult;
}
