import { describe, it, expect } from "vitest";
import { assessSLARisk, deterministicSLARiskEngine, riskLevelToStatus, statusToRiskLevel } from "../engine";
import { SLARiskEngineInput } from "../types";

const NOW = new Date("2026-09-10T12:00:00+05:30");

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

const BASE_INPUT: SLARiskEngineInput = {
  slaDeadline: minutesFromNow(300), // 5 hours away
  estimatedArrival: minutesFromNow(120), // arriving with a comfortable 180 min buffer (above the 120 min warning threshold)
  isDelivered: false,
  currentSpeedKmh: 55,
  historicalAvgSpeedKmh: 50,
  minutesSinceLastUpdate: 1,
  stoppedDurationMinutes: 0,
  remainingDistanceKm: 200,
  accumulatedDelayMinutes: 0,
  activeRouteEvents: [],
  now: NOW,
};

// ─── Base status: ETA vs SLA deadline ──────────────────────────────────────────

describe("assessSLARisk — base status", () => {
  it("ON_TRACK when ETA comfortably precedes the SLA deadline with no aggravating factors", () => {
    const result = assessSLARisk(BASE_INPUT);
    expect(result.status).toBe("ON_TRACK");
    expect(result.predictedDelayMinutes).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });

  it("AT_RISK when ETA is within the configurable warning buffer of the deadline", () => {
    const result = assessSLARisk({ ...BASE_INPUT, estimatedArrival: minutesFromNow(280) }); // 20 min buffer
    expect(result.status).toBe("AT_RISK");
    expect(result.reasons.some((r) => r.code === "ETA_APPROACHING_SLA")).toBe(true);
  });

  it("HIGH_RISK when ETA exceeds the deadline but the deadline itself hasn't passed and there's still time to recover", () => {
    // Deadline in 300 min, ETA 38 min past it (338 min from now) — 300 min of runway left, well above the imminent-breach threshold.
    const result = assessSLARisk({ ...BASE_INPUT, estimatedArrival: minutesFromNow(338) });
    expect(result.status).toBe("HIGH_RISK");
    expect(result.predictedDelayMinutes).toBe(38);
    expect(result.reasons.some((r) => r.code === "ETA_EXCEEDS_SLA")).toBe(true);
  });

  it("BREACH when ETA exceeds the deadline and too little time is left to recover", () => {
    const result = assessSLARisk({
      ...BASE_INPUT,
      slaDeadline: minutesFromNow(20), // deadline imminent
      estimatedArrival: minutesFromNow(40),
    });
    expect(result.status).toBe("BREACH");
  });

  it("BREACH when the SLA deadline has already passed and the shipment hasn't been delivered", () => {
    const result = assessSLARisk({
      ...BASE_INPUT,
      slaDeadline: minutesFromNow(-15),
      estimatedArrival: minutesFromNow(10),
    });
    expect(result.status).toBe("BREACH");
    expect(result.reasons.some((r) => r.code === "SLA_DEADLINE_PASSED")).toBe(true);
  });

  it("DELIVERED short-circuits everything else", () => {
    const result = assessSLARisk({ ...BASE_INPUT, isDelivered: true, estimatedArrival: minutesFromNow(500) });
    expect(result.status).toBe("DELIVERED");
    expect(result.reasons).toHaveLength(0);
    expect(result.predictedDelayMinutes).toBe(0);
  });

  it("treats a null ETA (no GPS yet) as ON_TRACK rather than erroring", () => {
    const result = assessSLARisk({ ...BASE_INPUT, estimatedArrival: null });
    expect(result.status).toBe("ON_TRACK");
  });
});

// ─── Aggravating factors escalate risk ─────────────────────────────────────────

describe("assessSLARisk — aggravating factors", () => {
  it("reports a significant speed drop and escalates AT_RISK toward HIGH_RISK", () => {
    const atRisk: SLARiskEngineInput = { ...BASE_INPUT, estimatedArrival: minutesFromNow(280) };
    const withSpeedDrop: SLARiskEngineInput = { ...atRisk, currentSpeedKmh: 20 }; // 60% below historical 50

    const base = assessSLARisk(atRisk);
    const degraded = assessSLARisk(withSpeedDrop);

    expect(base.status).toBe("AT_RISK");
    const speedReason = degraded.reasons.find((r) => r.code === "SPEED_DROP");
    expect(speedReason).toBeTruthy();
    expect(speedReason!.description).toMatch(/decreased by \d+%/);
    expect(speedReason!.severity).toBe("HIGH"); // >=50% drop
    expect(degraded.status).toBe("HIGH_RISK"); // escalated one level by the severe speed drop
  });

  it("reports an unexpected stop when the vehicle has been stationary long enough", () => {
    const result = assessSLARisk({ ...BASE_INPUT, stoppedDurationMinutes: 25 });
    const reason = result.reasons.find((r) => r.code === "UNSCHEDULED_STOP");
    expect(reason).toBeTruthy();
    expect(reason!.description).toContain("25 minutes");
  });

  it("does not flag a stop when the vehicle has effectively arrived", () => {
    const result = assessSLARisk({ ...BASE_INPUT, stoppedDurationMinutes: 25, remainingDistanceKm: 2 });
    expect(result.reasons.some((r) => r.code === "UNSCHEDULED_STOP")).toBe(false);
  });

  it("reports accumulated schedule delay above the threshold", () => {
    const result = assessSLARisk({ ...BASE_INPUT, accumulatedDelayMinutes: 24 });
    const reason = result.reasons.find((r) => r.code === "ACCUMULATED_DELAY");
    expect(reason).toBeTruthy();
    expect(reason!.description).toContain("24 minutes");
  });

  it("reports a high-impact route event", () => {
    const result = assessSLARisk({
      ...BASE_INPUT,
      activeRouteEvents: [{ title: "NH-65 closure near Solapur", eventType: "ROAD_CLOSURE", affectedCity: "Solapur", severity: "HIGH", estimatedDelayMinutes: 70 }],
    });
    const reason = result.reasons.find((r) => r.code === "ROUTE_EVENT");
    expect(reason).toBeTruthy();
    expect(reason!.description).toMatch(/High-impact event detected on route/);
    expect(reason!.severity).toBe("HIGH");
  });

  it("flags an insufficient remaining SLA buffer as a distinct signal", () => {
    const result = assessSLARisk({
      ...BASE_INPUT,
      slaDeadline: minutesFromNow(30), // thin buffer to deadline
      estimatedArrival: minutesFromNow(10),
    });
    const reason = result.reasons.find((r) => r.code === "SLA_BUFFER_LOW");
    expect(reason).toBeTruthy();
    expect(reason!.description).toBe("Remaining SLA buffer is insufficient");
  });

  it("reproduces the documented example: multiple aggravating factors compound into HIGH_RISK", () => {
    const result = assessSLARisk({
      ...BASE_INPUT,
      estimatedArrival: minutesFromNow(338), // 38 min past the 300-min deadline
      currentSpeedKmh: 20, // ~60% below historical average of 50
      accumulatedDelayMinutes: 24,
      activeRouteEvents: [{ title: "Ganesh Chaturthi procession", eventType: "FESTIVAL", affectedCity: "Solapur", severity: "HIGH", estimatedDelayMinutes: 60 }],
    });

    expect(result.status).toBe("HIGH_RISK");
    expect(result.predictedDelayMinutes).toBe(38);
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain("ETA_EXCEEDS_SLA");
    expect(codes).toContain("SPEED_DROP");
    expect(codes).toContain("ACCUMULATED_DELAY");
    expect(codes).toContain("ROUTE_EVENT");
  });

  it("escalates ON_TRACK by two levels to HIGH_RISK when enough severe aggravating factors are present", () => {
    const result = assessSLARisk({
      ...BASE_INPUT, // base status alone would be ON_TRACK
      currentSpeedKmh: 15, // severe speed drop (HIGH, weight 2)
      stoppedDurationMinutes: 0,
      accumulatedDelayMinutes: 30, // HIGH (weight 2)
      activeRouteEvents: [{ title: "Major highway closure", eventType: "ROAD_CLOSURE", affectedCity: null, severity: "HIGH", estimatedDelayMinutes: 90 }], // HIGH (weight 2)
    });
    expect(result.status).toBe("HIGH_RISK");
  });

  it("never escalates past BREACH", () => {
    const result = assessSLARisk({
      ...BASE_INPUT,
      slaDeadline: minutesFromNow(-15),
      estimatedArrival: minutesFromNow(10),
      currentSpeedKmh: 5,
      stoppedDurationMinutes: 30,
      accumulatedDelayMinutes: 40,
      activeRouteEvents: [{ title: "Flooded bridge", eventType: "ROAD_CLOSURE", affectedCity: null, severity: "CRITICAL", estimatedDelayMinutes: 120 }],
    });
    expect(result.status).toBe("BREACH");
  });
});

// ─── Confidence ─────────────────────────────────────────────────────────────

describe("assessSLARisk — confidence", () => {
  it("is LOW when GPS data is stale, regardless of computed status", () => {
    const result = assessSLARisk({ ...BASE_INPUT, estimatedArrival: minutesFromNow(280), minutesSinceLastUpdate: 45 });
    expect(result.confidence).toBe("LOW");
    expect(result.confidenceReason.toLowerCase()).toContain("stale");
  });

  it("is HIGH with no aggravating factors", () => {
    const result = assessSLARisk(BASE_INPUT);
    expect(result.confidence).toBe("HIGH");
  });

  it("is MEDIUM with exactly one corroborating aggravating factor", () => {
    const result = assessSLARisk({ ...BASE_INPUT, accumulatedDelayMinutes: 20 });
    expect(result.confidence).toBe("MEDIUM");
  });

  it("is HIGH when multiple independent factors corroborate the assessment", () => {
    const result = assessSLARisk({
      ...BASE_INPUT,
      accumulatedDelayMinutes: 20,
      currentSpeedKmh: 20,
    });
    expect(result.confidence).toBe("HIGH");
  });
});

// ─── Status ↔ risk level mapping ────────────────────────────────────────────

describe("statusToRiskLevel / riskLevelToStatus", () => {
  it("round-trips for the four risk-bearing statuses", () => {
    for (const status of ["ON_TRACK", "AT_RISK", "HIGH_RISK", "BREACH"] as const) {
      expect(riskLevelToStatus(statusToRiskLevel(status))).toBe(status);
    }
  });
});

// ─── Determinism ────────────────────────────────────────────────────────────

describe("assessSLARisk — determinism", () => {
  it("produces identical output for identical input", () => {
    const a = assessSLARisk(BASE_INPUT);
    const b = assessSLARisk(BASE_INPUT);
    expect(a).toEqual(b);
    expect(a.engine).toBe(deterministicSLARiskEngine.name);
  });
});
