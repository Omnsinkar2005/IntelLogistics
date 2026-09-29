import { RiskReason, RouteEventInput } from "../types";

export interface RiskRuleContext {
  now: Date;
  slaDeadline: Date;
  currentSpeedKmh: number;
  historicalAvgSpeedKmh: number;
  minutesSinceLastUpdate: number;
  stoppedDurationMinutes: number;
  remainingDistanceKm: number;
  accumulatedDelayMinutes: number;
  activeRouteEvents: RouteEventInput[];
}

/**
 * A rule inspects the context and optionally returns a reason explaining
 * an aggravating factor. Pure and independent — each rule can be tested,
 * reconfigured, or replaced without touching the others.
 */
export type RiskRule = (ctx: RiskRuleContext) => RiskReason | null;
