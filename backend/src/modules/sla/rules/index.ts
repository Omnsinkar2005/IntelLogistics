import { SLA_RISK_THRESHOLDS as THRESHOLDS } from "../config";
import { RiskRule } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// AGGRAVATING-FACTOR RULES
//
// Each rule inspects one signal and, if it crosses a configurable
// threshold, returns a human-readable reason. `engine.ts` collects these,
// uses their severity to decide whether to escalate the base ETA-vs-SLA
// status, and folds them into the response's `reasons` list.
//
// Rule codes are stable identifiers used elsewhere (e.g. the frontend's
// recommended-action logic keys off `SPEED_DROP` / `ROUTE_EVENT` /
// `UNSCHEDULED_STOP`) — keep them unless the consumers are updated too.
// ─────────────────────────────────────────────────────────────────────────

export const speedDropRule: RiskRule = (ctx) => {
  if (ctx.historicalAvgSpeedKmh < THRESHOLDS.minMeaningfulSpeedKmh) return null;
  if (ctx.currentSpeedKmh < THRESHOLDS.stoppedSpeedKmh) return null; // a full stop is reported by vehicleStoppedRule instead

  const dropPercent = ((ctx.historicalAvgSpeedKmh - ctx.currentSpeedKmh) / ctx.historicalAvgSpeedKmh) * 100;
  if (dropPercent < THRESHOLDS.speedDropPercent) return null;

  // Extra minutes the remaining distance will take at the reduced speed vs. the historical pace.
  const extraMinutes =
    ctx.remainingDistanceKm * (1 / ctx.currentSpeedKmh - 1 / ctx.historicalAvgSpeedKmh) * 60;

  return {
    code: "SPEED_DROP",
    description: `Vehicle average speed decreased by ${Math.round(dropPercent)}%`,
    impactMinutes: Math.max(0, Math.round(extraMinutes)),
    severity: dropPercent >= 50 ? "HIGH" : "MEDIUM",
  };
};

export const vehicleStoppedRule: RiskRule = (ctx) => {
  if (ctx.stoppedDurationMinutes < THRESHOLDS.vehicleStoppedMinutes) return null;
  if (ctx.remainingDistanceKm <= 5) return null; // effectively arrived; a stop here isn't a schedule risk

  return {
    code: "UNSCHEDULED_STOP",
    description: `Vehicle has been stopped for ${Math.round(ctx.stoppedDurationMinutes)} minutes`,
    impactMinutes: Math.round(ctx.stoppedDurationMinutes),
    severity: ctx.stoppedDurationMinutes >= THRESHOLDS.vehicleStoppedMinutes * 2 ? "HIGH" : "MEDIUM",
  };
};

export const accumulatedDelayRule: RiskRule = (ctx) => {
  if (ctx.accumulatedDelayMinutes < THRESHOLDS.accumulatedDelayMinutes) return null;

  return {
    code: "ACCUMULATED_DELAY",
    description: `${Math.round(ctx.accumulatedDelayMinutes)} minutes of delay accumulated`,
    impactMinutes: Math.round(ctx.accumulatedDelayMinutes),
    severity: ctx.accumulatedDelayMinutes >= THRESHOLDS.accumulatedDelayMinutes * 2 ? "HIGH" : "MEDIUM",
  };
};

const SEVERITY_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export const routeEventRule: RiskRule = (ctx) => {
  if (ctx.activeRouteEvents.length === 0) return null;

  // Pick the most severe active event (curated severity, not just delay minutes);
  // ties broken by estimated delay.
  const worst = ctx.activeRouteEvents.reduce((a, b) => {
    const rankDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (rankDiff !== 0) return rankDiff > 0 ? b : a;
    return b.estimatedDelayMinutes > a.estimatedDelayMinutes ? b : a;
  });
  if (worst.estimatedDelayMinutes < THRESHOLDS.mediumImpactRouteEventMinutes) return null;

  const highImpact = worst.severity === "HIGH" || worst.severity === "CRITICAL";
  const locationSuffix = worst.affectedCity ? ` near ${worst.affectedCity}` : "";
  return {
    code: "ROUTE_EVENT",
    description: highImpact
      ? `High-impact event detected on route: ${worst.title}${locationSuffix} (+${worst.estimatedDelayMinutes} min)`
      : `Route disruption detected: ${worst.title}${locationSuffix} (+${worst.estimatedDelayMinutes} min)`,
    impactMinutes: worst.estimatedDelayMinutes,
    severity: worst.severity,
  };
};

export const lowBufferRule: RiskRule = (ctx) => {
  const bufferToDeadlineMinutes = (ctx.slaDeadline.getTime() - ctx.now.getTime()) / 60_000;
  if (bufferToDeadlineMinutes <= 0 || bufferToDeadlineMinutes > THRESHOLDS.lowBufferMinutes) return null;
  if (ctx.remainingDistanceKm <= 5) return null; // arriving anyway; a tight window isn't meaningful risk here

  return {
    code: "SLA_BUFFER_LOW",
    description: "Remaining SLA buffer is insufficient",
    impactMinutes: 0,
    severity: bufferToDeadlineMinutes <= THRESHOLDS.lowBufferMinutes / 2 ? "HIGH" : "MEDIUM",
  };
};

export const staleGpsRule: RiskRule = (ctx) => {
  if (ctx.minutesSinceLastUpdate < THRESHOLDS.staleGpsMinutes) return null;

  return {
    code: "STALE_GPS",
    description: `No GPS update received for ${Math.round(ctx.minutesSinceLastUpdate)} minutes`,
    impactMinutes: 0,
    severity: "MEDIUM",
  };
};

export const ALL_RULES: RiskRule[] = [
  speedDropRule,
  vehicleStoppedRule,
  accumulatedDelayRule,
  routeEventRule,
  lowBufferRule,
  staleGpsRule,
];
