import { SLARiskLevel } from "../../../generated/prisma/client";
import { SLA_RISK_THRESHOLDS as THRESHOLDS } from "./config";
import { ALL_RULES } from "./rules/index";
import { RiskRuleContext } from "./rules/types";
import {
  RiskConfidence,
  RiskReason,
  SLAStatus,
  SLARiskEngine,
  SLARiskEngineInput,
  SLARiskEngineResult,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────
// DETERMINISTIC SLA RISK ENGINE
//
// No ML. Status is decided in two passes:
//   1. Base status from ETA vs. SLA deadline (the state machine described
//      in the product spec: ON_TRACK / AT_RISK / HIGH_RISK / BREACH).
//   2. Escalation from aggravating factors (speed drop, unexpected stop,
//      accumulated delay, high-impact route events, thin buffer) — each
//      is an independent, explainable rule (see `./rules`).
//
// Both passes produce `RiskReason`s that flow straight into the response
// so "why is this shipment at risk?" is always answerable.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_ORDER: SLAStatus[] = ["ON_TRACK", "AT_RISK", "HIGH_RISK", "BREACH"];
const SEVERITY_WEIGHT: Record<SLARiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

// Aggravating factors alone can escalate up to HIGH_RISK, but never force a
// BREACH — that status is reserved for the objective deadline math in
// `determineBaseStatus` (deadline already passed, or no time left to
// recover), not a soft combination of contributing signals.
const ESCALATION_CEILING_INDEX = STATUS_ORDER.indexOf("HIGH_RISK");

function escalate(status: SLAStatus, steps: number): SLAStatus {
  const idx = STATUS_ORDER.indexOf(status);
  if (idx === -1) return status; // DELIVERED — never escalated
  const target = Math.min(idx + steps, ESCALATION_CEILING_INDEX);
  return STATUS_ORDER[Math.max(idx, target)];
}

/** `status` → legacy `SLARiskLevel`, for the existing color-coded UI. */
export function statusToRiskLevel(status: SLAStatus): SLARiskLevel {
  const map: Record<SLAStatus, SLARiskLevel> = {
    ON_TRACK: "LOW",
    AT_RISK: "MEDIUM",
    HIGH_RISK: "HIGH",
    BREACH: "CRITICAL",
    DELIVERED: "LOW",
  };
  return map[status];
}

/** Inverse of `statusToRiskLevel`, used to detect a status transition from a persisted event. */
export function riskLevelToStatus(riskLevel: SLARiskLevel): SLAStatus {
  const map: Record<SLARiskLevel, SLAStatus> = {
    LOW: "ON_TRACK",
    MEDIUM: "AT_RISK",
    HIGH: "HIGH_RISK",
    CRITICAL: "BREACH",
  };
  return map[riskLevel];
}

/**
 * IF ETA <= SLA deadline: ON_TRACK (or AT_RISK if the buffer is thin).
 * IF ETA exceeds the SLA deadline: HIGH_RISK, or BREACH when the deadline
 * has already passed or there's too little time left to recover.
 */
function determineBaseStatus(
  now: Date,
  slaDeadline: Date,
  estimatedArrival: Date | null
): { status: SLAStatus; reason: RiskReason | null } {
  if (!estimatedArrival) return { status: "ON_TRACK", reason: null };

  const minutesPastDeadline = (now.getTime() - slaDeadline.getTime()) / 60_000;
  if (minutesPastDeadline > 0) {
    return {
      status: "BREACH",
      reason: {
        code: "SLA_DEADLINE_PASSED",
        description: `SLA deadline has passed by ${Math.round(minutesPastDeadline)} minutes and the shipment has not been delivered`,
        impactMinutes: Math.round(minutesPastDeadline),
        severity: "CRITICAL",
      },
    };
  }

  const bufferAtArrivalMinutes = (slaDeadline.getTime() - estimatedArrival.getTime()) / 60_000;
  if (bufferAtArrivalMinutes < 0) {
    const overageMinutes = Math.abs(bufferAtArrivalMinutes);
    const bufferToDeadlineMinutes = (slaDeadline.getTime() - now.getTime()) / 60_000;
    const imminent = bufferToDeadlineMinutes <= THRESHOLDS.imminentBreachBufferMinutes;
    return {
      status: imminent ? "BREACH" : "HIGH_RISK",
      reason: {
        code: "ETA_EXCEEDS_SLA",
        description: `Estimated arrival is ${Math.round(overageMinutes)} minutes past the SLA deadline`,
        impactMinutes: Math.round(overageMinutes),
        severity: imminent ? "CRITICAL" : "HIGH",
      },
    };
  }

  if (bufferAtArrivalMinutes <= THRESHOLDS.warningBufferMinutes) {
    return {
      status: "AT_RISK",
      reason: {
        code: "ETA_APPROACHING_SLA",
        description: `Estimated arrival leaves only ${Math.round(bufferAtArrivalMinutes)} minutes of buffer before the SLA deadline`,
        impactMinutes: 0,
        severity: "MEDIUM",
      },
    };
  }

  return { status: "ON_TRACK", reason: null };
}

function determineConfidence(
  status: SLAStatus,
  aggravatingCount: number,
  isStale: boolean
): { confidence: RiskConfidence; confidenceReason: string } {
  if (isStale) {
    return {
      confidence: "LOW",
      confidenceReason: "GPS data is stale, so this assessment may not reflect the vehicle's real position",
    };
  }
  if (status === "BREACH") {
    return { confidence: "HIGH", confidenceReason: "Based on the current ETA and SLA deadline, this outcome is highly likely" };
  }
  if (aggravatingCount >= 2) {
    return { confidence: "HIGH", confidenceReason: `${aggravatingCount} independent risk factors corroborate this assessment` };
  }
  if (aggravatingCount === 1) {
    return { confidence: "MEDIUM", confidenceReason: "Based on a single contributing risk factor" };
  }
  return { confidence: "HIGH", confidenceReason: "No risk factors detected; assessment is based on the current ETA vs. SLA deadline" };
}

export function assessSLARisk(input: SLARiskEngineInput): SLARiskEngineResult {
  const now = input.now ?? new Date();

  if (input.isDelivered) {
    return {
      status: "DELIVERED",
      riskLevel: statusToRiskLevel("DELIVERED"),
      predictedDelayMinutes: 0,
      bufferMinutes: Math.round((input.slaDeadline.getTime() - now.getTime()) / 60_000),
      reasons: [],
      confidence: "HIGH",
      confidenceReason: "Shipment has been delivered",
      calculatedAt: now,
      engine: deterministicSLARiskEngine.name,
    };
  }

  const { status: baseStatus, reason: baseReason } = determineBaseStatus(now, input.slaDeadline, input.estimatedArrival);

  const ruleCtx: RiskRuleContext = {
    now,
    slaDeadline: input.slaDeadline,
    currentSpeedKmh: input.currentSpeedKmh,
    historicalAvgSpeedKmh: input.historicalAvgSpeedKmh,
    minutesSinceLastUpdate: input.minutesSinceLastUpdate,
    stoppedDurationMinutes: input.stoppedDurationMinutes,
    remainingDistanceKm: input.remainingDistanceKm,
    accumulatedDelayMinutes: input.accumulatedDelayMinutes,
    activeRouteEvents: input.activeRouteEvents,
  };

  const ruleReasons = ALL_RULES.map((rule) => rule(ruleCtx)).filter((r): r is RiskReason => r !== null);

  const isStale = ruleReasons.some((r) => r.code === "STALE_GPS");
  // Staleness affects confidence, not escalation — a stale reading shouldn't itself imply risk.
  const escalatingReasons = ruleReasons.filter((r) => r.code !== "STALE_GPS");
  const totalWeight = escalatingReasons.reduce((sum, r) => sum + SEVERITY_WEIGHT[r.severity], 0);

  let steps = 0;
  if (totalWeight >= THRESHOLDS.escalation.twoLevelWeight) steps = 2;
  else if (totalWeight >= THRESHOLDS.escalation.oneLevelWeight) steps = 1;

  const finalStatus = escalate(baseStatus, steps);

  const reasons: RiskReason[] = [];
  if (baseReason) reasons.push(baseReason);
  reasons.push(...ruleReasons);

  const bufferMinutes = Math.round((input.slaDeadline.getTime() - now.getTime()) / 60_000);
  const predictedDelayMinutes = input.estimatedArrival
    ? Math.max(0, Math.round((input.estimatedArrival.getTime() - input.slaDeadline.getTime()) / 60_000))
    : 0;

  const { confidence, confidenceReason } = determineConfidence(finalStatus, escalatingReasons.length, isStale);

  return {
    status: finalStatus,
    riskLevel: statusToRiskLevel(finalStatus),
    predictedDelayMinutes,
    bufferMinutes,
    reasons,
    confidence,
    confidenceReason,
    calculatedAt: now,
    engine: deterministicSLARiskEngine.name,
  };
}

/**
 * Default POC engine. A future ML model can implement `SLARiskEngine`
 * directly, or wrap this engine to keep its rule-based `reasons` for
 * explainability while overriding `predictedDelayMinutes`/`status` with a
 * learned prediction — swap what `getSLARiskEngine()` returns and nothing
 * outside this module needs to change.
 */
export const deterministicSLARiskEngine: SLARiskEngine = {
  name: "deterministic-sla-v1",
  assess: assessSLARisk,
};

export function getSLARiskEngine(): SLARiskEngine {
  return deterministicSLARiskEngine;
}
