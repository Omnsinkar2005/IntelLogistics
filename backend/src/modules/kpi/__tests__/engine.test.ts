import { describe, it, expect } from "vitest";
import { computeKPIs } from "../engine";
import { KPI_WEIGHTS } from "../config";
import { HistoricalShipmentRecord } from "../types";

const DISPATCH = new Date("2026-06-01T06:00:00+05:30");
const DELIVER = new Date("2026-06-02T02:00:00+05:30"); // 20h transit
const DEADLINE_ON_TIME = new Date("2026-06-02T08:00:00+05:30"); // after delivery → on time
const DEADLINE_LATE = new Date("2026-06-01T20:00:00+05:30"); // before delivery → breached

function evenPings(start: Date, end: Date, count: number): Date[] {
  const pings: Date[] = [];
  for (let i = 1; i < count; i++) {
    pings.push(new Date(start.getTime() + ((end.getTime() - start.getTime()) * i) / count));
  }
  return pings;
}

function makeShipment(overrides: Partial<HistoricalShipmentRecord> = {}): HistoricalShipmentRecord {
  return {
    id: "s1",
    status: "COMPLETED",
    dispatchedAt: DISPATCH,
    deliveredAt: DELIVER,
    slaDeadline: DEADLINE_ON_TIME,
    slaIsBreached: false,
    podStatus: "APPROVED",
    podCondition: "GOOD",
    // ~3h20m apart — deliberately sparser than the 30 min tracking-compliance
    // threshold, so tests that don't care about tracking compliance don't
    // accidentally rely on it being compliant.
    locationTimestamps: evenPings(DISPATCH, DELIVER, 6),
    hadHighSeverityException: false,
    ...overrides,
  };
}

// ─── Empty input ────────────────────────────────────────────────────────────

describe("computeKPIs — no shipment data", () => {
  it("marks every KPI unavailable rather than inventing zero", () => {
    const result = computeKPIs([]);
    expect(result.totalShipments).toBe(0);
    expect(result.otifPercent).toBeNull();
    expect(result.avgTatHours).toBeNull();
    expect(result.slaBreachRatePercent).toBeNull();
    expect(result.damageShortageRatePercent).toBeNull();
    expect(result.trackingCompliancePercent).toBeNull();
    expect(result.podCompliancePercent).toBeNull();
    expect(result.exceptionRatePercent).toBeNull();
    expect(result.compositeScore).toBeNull();
    expect(result.components.every((c) => !c.available)).toBe(true);
  });
});

// ─── OTIF ───────────────────────────────────────────────────────────────────

describe("computeKPIs — OTIF", () => {
  it("counts only completed shipments delivered on or before the SLA deadline", () => {
    const shipments = [
      makeShipment({ id: "a", slaDeadline: DEADLINE_ON_TIME }), // on time
      makeShipment({ id: "b", slaDeadline: DEADLINE_LATE }), // late
      makeShipment({ id: "c", status: "DELIVERED" }), // not completed → excluded from OTIF cohort
    ];
    const result = computeKPIs(shipments);
    expect(result.otifPercent).toBeCloseTo(50, 5); // 1 of 2 completed shipments on time
  });

  it("is unavailable when there are no completed shipments", () => {
    const shipments = [makeShipment({ status: "DELIVERED" })];
    const result = computeKPIs(shipments);
    expect(result.otifPercent).toBeNull();
  });
});

// ─── Average TAT ────────────────────────────────────────────────────────────

describe("computeKPIs — average TAT", () => {
  it("averages hours between dispatch and delivery across settled shipments", () => {
    const shipments = [
      makeShipment({ id: "a", dispatchedAt: new Date("2026-06-01T00:00:00Z"), deliveredAt: new Date("2026-06-01T20:00:00Z") }), // 20h
      makeShipment({ id: "b", dispatchedAt: new Date("2026-06-01T00:00:00Z"), deliveredAt: new Date("2026-06-02T00:00:00Z") }), // 24h
    ];
    const result = computeKPIs(shipments);
    expect(result.avgTatHours).toBeCloseTo(22, 5);
  });

  it("includes DELIVERED (not just COMPLETED) shipments, unlike OTIF", () => {
    const shipments = [makeShipment({ status: "DELIVERED" })];
    const result = computeKPIs(shipments);
    expect(result.avgTatHours).not.toBeNull();
  });
});

// ─── SLA breach rate ────────────────────────────────────────────────────────

describe("computeKPIs — SLA breach rate", () => {
  it("is the fraction of completed shipments with isBreached=true", () => {
    const shipments = [
      makeShipment({ id: "a", slaIsBreached: false }),
      makeShipment({ id: "b", slaIsBreached: true }),
      makeShipment({ id: "c", slaIsBreached: true }),
    ];
    const result = computeKPIs(shipments);
    expect(result.slaBreachRatePercent).toBeCloseTo((2 / 3) * 100, 5);
  });

  it("only considers completed shipments, not merely-delivered ones", () => {
    const shipments = [makeShipment({ status: "DELIVERED", slaIsBreached: null })];
    const result = computeKPIs(shipments);
    expect(result.slaBreachRatePercent).toBeNull();
  });
});

// ─── Damage / shortage rate ─────────────────────────────────────────────────

describe("computeKPIs — damage/shortage rate", () => {
  it("counts DAMAGED and PARTIAL as damage/shortage, GOOD as not", () => {
    const shipments = [
      makeShipment({ id: "a", podCondition: "GOOD" }),
      makeShipment({ id: "b", podCondition: "DAMAGED" }),
      makeShipment({ id: "c", podCondition: "PARTIAL" }),
      makeShipment({ id: "d", podCondition: "GOOD" }),
    ];
    const result = computeKPIs(shipments);
    expect(result.damageShortageRatePercent).toBeCloseTo(50, 5);
  });

  it("excludes shipments with no recorded condition rather than treating them as GOOD", () => {
    const shipments = [
      makeShipment({ id: "a", podCondition: "DAMAGED" }),
      makeShipment({ id: "b", podCondition: null }),
      makeShipment({ id: "c", podCondition: null }),
    ];
    const result = computeKPIs(shipments);
    // Only 1 shipment has a known condition, and it's damaged → 100%, not diluted by the unknowns.
    expect(result.damageShortageRatePercent).toBeCloseTo(100, 5);
  });

  it("is unavailable when no shipment has a recorded condition", () => {
    const shipments = [makeShipment({ podCondition: null })];
    const result = computeKPIs(shipments);
    expect(result.damageShortageRatePercent).toBeNull();
  });
});

// ─── Tracking compliance ────────────────────────────────────────────────────

describe("computeKPIs — tracking compliance", () => {
  it("is compliant when no gap between pings (including dispatch/delivery edges) exceeds the threshold", () => {
    // 6 pings spread over 20h ⇒ gaps ~2h51m, but edge-to-edge including start/end still under threshold requires denser pings.
    const denseShipment = makeShipment({ locationTimestamps: evenPings(DISPATCH, DELIVER, 60) }); // ~20 min apart
    const result = computeKPIs([denseShipment]);
    expect(result.trackingCompliancePercent).toBe(100);
  });

  it("fails compliance when a gap between pings exceeds the threshold", () => {
    const sparseShipment = makeShipment({ locationTimestamps: [new Date(DISPATCH.getTime() + 60 * 60_000)] }); // one ping, then nothing for the rest of a 20h trip
    const result = computeKPIs([sparseShipment]);
    expect(result.trackingCompliancePercent).toBe(0);
  });

  it("fails compliance when there are no GPS pings at all", () => {
    const untracked = makeShipment({ locationTimestamps: [] });
    const result = computeKPIs([untracked]);
    expect(result.trackingCompliancePercent).toBe(0);
  });

  it("requires a known transit window (dispatch and delivery timestamps)", () => {
    const noWindow = makeShipment({ dispatchedAt: null });
    const result = computeKPIs([noWindow]);
    expect(result.trackingCompliancePercent).toBeNull();
  });
});

// ─── POD compliance ─────────────────────────────────────────────────────────

describe("computeKPIs — POD compliance", () => {
  it("is measured over settled (delivered) shipments, not just completed ones", () => {
    // A DELIVERED shipment can have a pending/rejected POD — if POD compliance only
    // looked at COMPLETED shipments it would trivially always read 100%, since a
    // shipment can't become COMPLETED without an approved POD.
    const shipments = [
      makeShipment({ id: "a", status: "COMPLETED", podStatus: "APPROVED" }),
      makeShipment({ id: "b", status: "DELIVERED", podStatus: "REJECTED" }),
      makeShipment({ id: "c", status: "DELIVERED", podStatus: "PENDING" }),
    ];
    const result = computeKPIs(shipments);
    expect(result.podCompliancePercent).toBeCloseTo((1 / 3) * 100, 5);
  });
});

// ─── Exception rate ─────────────────────────────────────────────────────────

describe("computeKPIs — exception rate", () => {
  it("is the fraction of completed shipments that had a high-severity SLA risk event", () => {
    const shipments = [
      makeShipment({ id: "a", hadHighSeverityException: false }),
      makeShipment({ id: "b", hadHighSeverityException: true }),
    ];
    const result = computeKPIs(shipments);
    expect(result.exceptionRatePercent).toBeCloseTo(50, 5);
  });
});

// ─── Composite score ────────────────────────────────────────────────────────

describe("computeKPIs — composite score", () => {
  it("weights sum to 1.0 in the config", () => {
    const total = Object.values(KPI_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it("component weighted contributions sum to the composite score", () => {
    const shipments = [makeShipment({ id: "a" }), makeShipment({ id: "b", slaIsBreached: true })];
    const result = computeKPIs(shipments);
    const sum = result.components.reduce((s, c) => s + c.weightedContribution, 0);
    expect(sum).toBeCloseTo(result.compositeScore!, 5);
  });

  it("renormalizes weights among available components instead of penalizing missing data", () => {
    // Every shipment lacks a recorded POD condition ⇒ damage/shortage is unavailable.
    // Everything else about these shipments is good (on time, tracked, POD compliant,
    // no exceptions). The composite should be computed purely from those remaining
    // weighted components, not diluted by treating the missing one as a zero.
    const denseTracking = evenPings(DISPATCH, DELIVER, 60);
    const shipments = [
      makeShipment({ id: "a", podCondition: null, locationTimestamps: denseTracking }),
      makeShipment({ id: "b", podCondition: null, locationTimestamps: denseTracking }),
    ];
    const result = computeKPIs(shipments);
    const damageComp = result.components.find((c) => c.key === "damageShortage")!;
    expect(damageComp.available).toBe(false);
    expect(damageComp.weightedContribution).toBe(0);
    expect(result.compositeScore).not.toBeNull();
    // With everything else "good", the composite should still be high — not dragged
    // down by a phantom zero for the unavailable KPI.
    expect(result.compositeScore!).toBeGreaterThan(80);
  });

  it("is null only when every component is unavailable", () => {
    const result = computeKPIs([makeShipment({ status: "DELIVERED", dispatchedAt: null, podCondition: null, locationTimestamps: [] })]);
    // avgTat/tracking need dispatchedAt; podCompliance still available (settled cohort); so composite should still exist.
    expect(result.compositeScore).not.toBeNull();
  });
});
