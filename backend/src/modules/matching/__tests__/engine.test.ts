import { describe, it, expect } from "vitest";
import {
  checkEligibility, scoreTransporter, runMatchingEngine,
  estimateTransportCostInr, applyColdChainSurcharge, getTransporterQuoteVarianceInr,
  calculateTransporterQuoteInr,
} from "../engine";
import {
  RequirementInput,
  TransporterCandidate,
  KPISnapshot,
  DEFAULT_WEIGHTS,
} from "../types";

// ─── Pricing ────────────────────────────────────────────────────────────────

describe("estimateTransportCostInr — normal/ambient base cost", () => {
  it("matches the spec example: 1,000km → ₹30,800", () => {
    // fuelLitres = 1000/5 = 200; fuelCost = 200*110 = 22,000;
    // additionalCost = 22,000*0.4 = 8,800; total = 30,800
    expect(estimateTransportCostInr(1000)).toBe(30800);
  });

  it("scales linearly with distance", () => {
    expect(estimateTransportCostInr(500)).toBe(15400);
    expect(estimateTransportCostInr(2000)).toBe(61600);
  });

  it("returns 0 for zero distance", () => {
    expect(estimateTransportCostInr(0)).toBe(0);
  });
});

describe("applyColdChainSurcharge — 35% addition for cold-chain shipments", () => {
  it("matches the spec example: ₹30,800 base → ₹41,580 cold-chain", () => {
    // coldChainAdditionalCost = 30,800 * 0.35 = 10,780; total = 41,580
    expect(applyColdChainSurcharge(30800, true)).toBe(41580);
  });

  it("leaves the cost unchanged for non-cold-chain shipments", () => {
    expect(applyColdChainSurcharge(30800, false)).toBe(30800);
  });
});

describe("getTransporterQuoteVarianceInr — deterministic per-transporter variance", () => {
  it("stays within the ₹2,000–5,000 range", () => {
    for (const id of ["t1", "t2", "transporter-abc", "cmttnd7vn0005i4v9npufopnp"]) {
      const variance = getTransporterQuoteVarianceInr(id);
      expect(variance).toBeGreaterThanOrEqual(2000);
      expect(variance).toBeLessThanOrEqual(5000);
    }
  });

  it("is deterministic — same transporter id always yields the same variance", () => {
    expect(getTransporterQuoteVarianceInr("t1")).toBe(getTransporterQuoteVarianceInr("t1"));
    expect(getTransporterQuoteVarianceInr("t1")).toBe(getTransporterQuoteVarianceInr("t1"));
  });

  it("gives different transporters different variances", () => {
    expect(getTransporterQuoteVarianceInr("t1")).not.toBe(getTransporterQuoteVarianceInr("t2"));
  });
});

describe("calculateTransporterQuoteInr — full quote: base → cold-chain → variance", () => {
  it("applies the cold-chain surcharge before the transporter variance", () => {
    const withoutColdChain = calculateTransporterQuoteInr(1000, false, "t1");
    const withColdChain = calculateTransporterQuoteInr(1000, true, "t1");
    const variance = getTransporterQuoteVarianceInr("t1");
    expect(withoutColdChain).toBe(30800 + variance);
    expect(withColdChain).toBe(41580 + variance);
  });

  it("different transporters quote different final prices for the same shipment", () => {
    const quoteT1 = calculateTransporterQuoteInr(1000, true, "t1");
    const quoteT2 = calculateTransporterQuoteInr(1000, true, "t2");
    expect(quoteT1).not.toBe(quoteT2);
  });

  it("the same transporter and inputs always produce the same quote (stable across refresh)", () => {
    const first = calculateTransporterQuoteInr(1000, true, "t1");
    const second = calculateTransporterQuoteInr(1000, true, "t1");
    expect(first).toBe(second);
  });
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_REQUIREMENT: RequirementInput = {
  originCity: "Pune",
  destinationCity: "Hyderabad",
  weightKg: 2500,
  coldChainRequired: true,
  tempMinCelsius: 2,
  tempMaxCelsius: 8,
  maxCostInr: 75000,
  slaDeadline: new Date("2026-09-10T17:00:00+05:30"),
  estimatedDistanceKm: 620,
};

const GOOD_KPI: KPISnapshot = {
  period: "2026-Q2",
  totalShipments: 52,
  otifPercent: 94.23,
  avgTatHours: 21.8,
  slaBreachRatePercent: 5.77,
  damageShortageRatePercent: 0.9,
  trackingCompliancePercent: 98.1,
  podCompliancePercent: 96.2,
  exceptionRatePercent: 7.7,
};

const POOR_KPI: KPISnapshot = {
  period: "2026-Q2",
  totalShipments: 58,
  otifPercent: 72.0,
  avgTatHours: 32.0,
  slaBreachRatePercent: 28.0,
  damageShortageRatePercent: 5.5,
  trackingCompliancePercent: 65.0,
  podCompliancePercent: 70.0,
  exceptionRatePercent: 30.0,
};

function makeTransporter(overrides: Partial<TransporterCandidate> = {}): TransporterCandidate {
  return {
    id: "t1",
    name: "BlueDart Logistics",
    city: "Pune",
    state: "Maharashtra",
    coldChainCapable: true,
    supportedRoutes: [{ origin: "Pune", destination: "Hyderabad" }],
    baseCostPerKmInr: 95,
    vehicles: [
      {
        id: "v1",
        vehicleNumber: "MH12CD5678",
        vehicleType: "REEFER_LARGE",
        capacityKg: 5000,
        coldChain: true,
        tempMinCelsius: 2,
        tempMaxCelsius: 8,
        driverName: "Santosh Jadhav",
        driverPhone: "+91-94201-11111",
      },
    ],
    latestKPI: GOOD_KPI,
    ...overrides,
  };
}

// ─── Stage 1: Eligibility Tests ───────────────────────────────────────────────

describe("checkEligibility", () => {
  it("returns eligible when all conditions are met", () => {
    const result = checkEligibility(makeTransporter(), BASE_REQUIREMENT);
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.eligibleVehicles).toHaveLength(1);
      expect(result.eligibleVehicles[0].vehicleNumber).toBe("MH12CD5678");
    }
  });

  it("fails when cold chain is required but transporter lacks capability", () => {
    const transporter = makeTransporter({ coldChainCapable: false });
    const result = checkEligibility(transporter, BASE_REQUIREMENT);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      const codes = result.failures.map((f) => f.code);
      expect(codes).toContain("COLD_CHAIN_NOT_AVAILABLE");
      expect(result.failures[0].reason).toMatch(/cold chain/i);
    }
  });

  it("fails when estimated cost exceeds maximum allowed cost", () => {
    // Fuel-based estimate for 620km = (620/5 * 110) * 1.4 ≈ ₹19,096 — set a
    // maxCostInr below that to trigger the failure (cost no longer depends
    // on the transporter's own baseCostPerKmInr).
    const req: RequirementInput = { ...BASE_REQUIREMENT, maxCostInr: 10000 };
    const result = checkEligibility(makeTransporter(), req);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      const codes = result.failures.map((f) => f.code);
      expect(codes).toContain("COST_EXCEEDS_MAXIMUM");
      expect(result.failures[0].reason).toMatch(/₹/);
    }
  });

  it("fails when no vehicle has sufficient capacity", () => {
    const transporter = makeTransporter({
      vehicles: [
        {
          id: "v1",
          vehicleNumber: "MH12CD5678",
          vehicleType: "REEFER_SMALL",
          capacityKg: 1000, // requirement is 2500kg
          coldChain: true,
          tempMinCelsius: 2,
          tempMaxCelsius: 8,
          driverName: "Santosh Jadhav",
          driverPhone: "+91-94201-11111",
        },
      ],
    });
    const result = checkEligibility(transporter, BASE_REQUIREMENT);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      const codes = result.failures.map((f) => f.code);
      expect(codes).toContain("INSUFFICIENT_VEHICLE_CAPACITY");
      expect(result.failures[0].reason).toMatch(/2,500/);
    }
  });

  it("fails when route is not covered", () => {
    const transporter = makeTransporter({
      supportedRoutes: [{ origin: "Mumbai", destination: "Delhi" }],
    });
    const result = checkEligibility(transporter, BASE_REQUIREMENT);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      const codes = result.failures.map((f) => f.code);
      expect(codes).toContain("ROUTE_NOT_COVERED");
      expect(result.failures[0].reason).toMatch(/Pune.*Hyderabad/);
    }
  });

  it("fails with multiple reasons when multiple conditions fail", () => {
    const transporter = makeTransporter({
      coldChainCapable: false,
      supportedRoutes: [{ origin: "Mumbai", destination: "Delhi" }],
    });
    const result = checkEligibility(transporter, BASE_REQUIREMENT);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.failures.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("passes when cold chain is NOT required and transporter lacks it", () => {
    const req: RequirementInput = { ...BASE_REQUIREMENT, coldChainRequired: false };
    const transporter = makeTransporter({
      coldChainCapable: false,
      vehicles: [
        {
          id: "v1",
          vehicleNumber: "MH04KL2345",
          vehicleType: "TRUCK_LARGE",
          capacityKg: 8000,
          coldChain: false,
          tempMinCelsius: null,
          tempMaxCelsius: null,
          driverName: "Dilip Patil",
          driverPhone: "+91-94201-55555",
        },
      ],
    });
    const result = checkEligibility(transporter, req);
    expect(result.eligible).toBe(true);
  });

  it("fails when vehicle cold chain range does not cover required temperature", () => {
    const transporter = makeTransporter({
      vehicles: [
        {
          id: "v1",
          vehicleNumber: "MH12CD5678",
          vehicleType: "REEFER_LARGE",
          capacityKg: 5000,
          coldChain: true,
          tempMinCelsius: 15, // vehicle supports 15–25°C, requirement is 2–8°C
          tempMaxCelsius: 25,
          driverName: "Santosh Jadhav",
          driverPhone: "+91-94201-11111",
        },
      ],
    });
    const result = checkEligibility(transporter, BASE_REQUIREMENT);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      const codes = result.failures.map((f) => f.code);
      expect(codes).toContain("TEMPERATURE_RANGE_MISMATCH");
    }
  });

  it("includes estimated cost in both eligible and ineligible results", () => {
    const eligible = checkEligibility(makeTransporter(), BASE_REQUIREMENT);
    expect(eligible.estimatedCostInr).toBeGreaterThan(0);

    const ineligible = checkEligibility(
      makeTransporter({ coldChainCapable: false }),
      BASE_REQUIREMENT
    );
    expect(ineligible.estimatedCostInr).toBeGreaterThan(0);
  });
});

// ─── Stage 2: Scoring Tests ───────────────────────────────────────────────────

describe("scoreTransporter", () => {
  it("produces a score between 0 and 100", () => {
    const t = makeTransporter();
    const result = scoreTransporter(t, BASE_REQUIREMENT, 58900);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });

  it("produces 7 score components matching the weight keys", () => {
    const result = scoreTransporter(makeTransporter(), BASE_REQUIREMENT, 58900);
    expect(result.components).toHaveLength(7);
  });

  it("weighted scores sum to approximately the total score", () => {
    const result = scoreTransporter(makeTransporter(), BASE_REQUIREMENT, 58900);
    const sum = result.components.reduce((acc, c) => acc + c.weightedScore, 0);
    expect(Math.abs(sum - result.totalScore)).toBeLessThan(0.5);
  });

  it("transporter with good KPI scores higher than one with poor KPI", () => {
    const goodTransporter = makeTransporter({ latestKPI: GOOD_KPI });
    const poorTransporter = makeTransporter({ id: "t2", latestKPI: POOR_KPI });
    const goodScore = scoreTransporter(goodTransporter, BASE_REQUIREMENT, 58900);
    const poorScore = scoreTransporter(poorTransporter, BASE_REQUIREMENT, 58900);
    expect(goodScore.totalScore).toBeGreaterThan(poorScore.totalScore);
  });

  it("cheaper transporter scores higher on cost component than expensive one", () => {
    const cheap = makeTransporter({ baseCostPerKmInr: 60 });
    const expensive = makeTransporter({ id: "t2", baseCostPerKmInr: 110 });
    const cheapScore = scoreTransporter(cheap, BASE_REQUIREMENT, 60 * 620);
    const expensiveScore = scoreTransporter(expensive, BASE_REQUIREMENT, 110 * 620);
    const cheapCostComp = cheapScore.components.find((c) => c.label === "Cost Competitiveness")!;
    const expCostComp = expensiveScore.components.find((c) => c.label === "Cost Competitiveness")!;
    expect(cheapCostComp.normalizedScore).toBeGreaterThan(expCostComp.normalizedScore);
  });

  it("generates a non-empty narrative string", () => {
    const result = scoreTransporter(makeTransporter(), BASE_REQUIREMENT, 58900);
    expect(result.narrative).toBeTruthy();
    expect(result.narrative).toContain("BlueDart Logistics");
    expect(result.narrative).toContain("/100");
  });

  it("marks hasKPIHistory false when no KPI data", () => {
    const t = makeTransporter({ latestKPI: null });
    const result = scoreTransporter(t, BASE_REQUIREMENT, 58900);
    expect(result.hasKPIHistory).toBe(false);
    expect(result.narrative).toMatch(/no historical/i);
  });

  it("respects custom weights", () => {
    const customWeights = { ...DEFAULT_WEIGHTS, otif: 0.60, cost: 0.00, slaCompliance: 0.10, tat: 0.10, trackingCompliance: 0.10, damageShortage: 0.05, podCompliance: 0.05 };
    const result = scoreTransporter(makeTransporter(), BASE_REQUIREMENT, 58900, customWeights);
    const otifComp = result.components.find((c) => c.label === "OTIF")!;
    expect(otifComp.weight).toBe(0.60);
  });

  it("treats a null KPI field as unavailable with a neutral score, not zero", () => {
    const t = makeTransporter({ latestKPI: { ...GOOD_KPI, damageShortageRatePercent: null } });
    const result = scoreTransporter(t, BASE_REQUIREMENT, 58900);
    const comp = result.components.find((c) => c.label === "Damage & Shortage")!;
    expect(comp.available).toBe(false);
    expect(comp.normalizedScore).toBe(50);
    expect(comp.explanation).toMatch(/not available/i);
  });

  it("marks all other components available when only one KPI field is null", () => {
    const t = makeTransporter({ latestKPI: { ...GOOD_KPI, avgTatHours: null } });
    const result = scoreTransporter(t, BASE_REQUIREMENT, 58900);
    const otherComponents = result.components.filter((c) => c.label !== "TAT Performance");
    expect(otherComponents.every((c) => c.available)).toBe(true);
  });

  it("excludes an unavailable component's explanation from narrative strengths/weaknesses", () => {
    // A component stuck at the neutral 50 score would otherwise be misread as a weakness (<70).
    const t = makeTransporter({ latestKPI: { ...GOOD_KPI, podCompliancePercent: null } });
    const result = scoreTransporter(t, BASE_REQUIREMENT, 58900);
    expect(result.narrative).not.toMatch(/not available/i);
  });
});

// ─── Full Engine: Ranking Tests ───────────────────────────────────────────────

describe("runMatchingEngine", () => {
  it("ranks eligible transporters before ineligible ones", () => {
    const eligible = makeTransporter({ id: "t1", latestKPI: GOOD_KPI });
    const ineligible = makeTransporter({
      id: "t2",
      name: "No Cold Chain Co.",
      coldChainCapable: false,
    });
    const results = runMatchingEngine([eligible, ineligible], BASE_REQUIREMENT);
    expect(results[0].eligibility.eligible).toBe(true);
    expect(results[1].eligibility.eligible).toBe(false);
  });

  it("assigns rank 1 to the highest-scoring eligible transporter", () => {
    const t1 = makeTransporter({ id: "t1", name: "Good Co.", latestKPI: GOOD_KPI });
    const t2 = makeTransporter({ id: "t2", name: "Poor Co.", latestKPI: POOR_KPI, supportedRoutes: [{ origin: "Pune", destination: "Hyderabad" }] });
    const results = runMatchingEngine([t2, t1], BASE_REQUIREMENT);
    const ranked1 = results.find((r) => r.rank === 1);
    expect(ranked1?.transporter.name).toBe("Good Co.");
  });

  it("marks only the top-ranked transporter as recommended", () => {
    const t1 = makeTransporter({ id: "t1", latestKPI: GOOD_KPI });
    const t2 = makeTransporter({ id: "t2", name: "Second Co.", latestKPI: POOR_KPI, supportedRoutes: [{ origin: "Pune", destination: "Hyderabad" }] });
    const results = runMatchingEngine([t1, t2], BASE_REQUIREMENT);
    const recommended = results.filter((r) => r.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].rank).toBe(1);
  });

  it("assigns null rank and null scoring to ineligible transporters", () => {
    const ineligible = makeTransporter({ coldChainCapable: false });
    const results = runMatchingEngine([ineligible], BASE_REQUIREMENT);
    expect(results[0].rank).toBeNull();
    expect(results[0].scoring).toBeNull();
    expect(results[0].recommended).toBe(false);
  });

  it("returns empty array when no transporters provided", () => {
    const results = runMatchingEngine([], BASE_REQUIREMENT);
    expect(results).toHaveLength(0);
  });

  it("handles all transporters being ineligible", () => {
    const t1 = makeTransporter({ id: "t1", coldChainCapable: false });
    const t2 = makeTransporter({ id: "t2", name: "No Route", supportedRoutes: [] });
    const results = runMatchingEngine([t1, t2], BASE_REQUIREMENT);
    expect(results.every((r) => !r.eligibility.eligible)).toBe(true);
    expect(results.every((r) => r.rank === null)).toBe(true);
  });

  it("score breakdown components are present in each eligible result", () => {
    const t = makeTransporter();
    const results = runMatchingEngine([t], BASE_REQUIREMENT);
    expect(results[0].scoring?.components).toHaveLength(7);
    const labels = results[0].scoring!.components.map((c) => c.label);
    expect(labels).toContain("OTIF");
    expect(labels).toContain("SLA Compliance");
    expect(labels).toContain("Cost Competitiveness");
  });
});
