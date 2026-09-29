import {
  RequirementInput,
  TransporterCandidate,
  VehicleCandidate,
  KPISnapshot,
  EligibilityOutcome,
  EligibilityFailure,
  RiskSeverity,
  ScoringResult,
  ScoreComponent,
  ScoringWeights,
  DEFAULT_WEIGHTS,
  MatchResult,
} from "./types";

const BEST_TAT_HOURS = 18;
const WORST_TAT_HOURS = 36;

// ─── Pricing — fuel-cost-based estimate (POC scope) ──────────────────────────
// Base formula is distance-only (not transporter-specific). Cold-chain
// shipments get a 35% surcharge on top of the base cost. Each transporter
// then gets a small, deterministic quote variance layered on last, so
// quotes visibly differ across transporters without becoming random on
// every refresh.
const FUEL_PRICE_PER_LITRE_INR = 110;
const DEFAULT_MILEAGE_KM_PER_LITRE = 5;
const ADDITIONAL_COST_RATE = 0.4; // 40% of fuel cost — tolls, driver, misc.
const COLD_CHAIN_SURCHARGE_RATE = 0.35;
const MIN_TRANSPORTER_VARIANCE_INR = 2000;
const MAX_TRANSPORTER_VARIANCE_INR = 5000;

/** Normal/ambient base cost. Unchanged from the original fuel-cost formula. */
export function estimateTransportCostInr(distanceKm: number): number {
  const fuelLitres = distanceKm / DEFAULT_MILEAGE_KM_PER_LITRE;
  const fuelCost = fuelLitres * FUEL_PRICE_PER_LITRE_INR;
  const additionalCost = fuelCost * ADDITIONAL_COST_RATE;
  return Math.round(fuelCost + additionalCost);
}

/** Adds the cold-chain surcharge (35% of base cost) when the shipment requires it. */
export function applyColdChainSurcharge(baseCostInr: number, coldChainRequired: boolean): number {
  if (!coldChainRequired) return baseCostInr;
  const coldChainAdditionalCost = baseCostInr * COLD_CHAIN_SURCHARGE_RATE;
  return Math.round(baseCostInr + coldChainAdditionalCost);
}

/**
 * Deterministic per-transporter quote variance (₹2,000–5,000). Derived
 * purely from the transporter's own id, so the same transporter always
 * gets the same variance — quotes stay stable across page refreshes
 * without persisting anything new — while different transporters land on
 * different values.
 */
export function getTransporterQuoteVarianceInr(transporterId: string): number {
  let hash = 0;
  for (let i = 0; i < transporterId.length; i++) {
    hash = (Math.imul(31, hash) + transporterId.charCodeAt(i)) | 0;
  }
  // A raw string hash alone doesn't avalanche enough — ids that differ by
  // one character (e.g. "t1" vs "t2") can land within 1 of each other,
  // which collapses to the same integer once scaled into a ₹3,000-wide
  // range. One mulberry32-style mixing round spreads nearby seeds apart.
  let t = (hash + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296; // deterministic value in [0, 1)
  return Math.round(MIN_TRANSPORTER_VARIANCE_INR + unit * (MAX_TRANSPORTER_VARIANCE_INR - MIN_TRANSPORTER_VARIANCE_INR));
}

/** Full transporter quote: base cost → cold-chain surcharge → transporter variance, in that order. */
export function calculateTransporterQuoteInr(
  distanceKm: number,
  coldChainRequired: boolean,
  transporterId: string
): number {
  const baseCostInr = estimateTransportCostInr(distanceKm);
  const coldChainCostInr = applyColdChainSurcharge(baseCostInr, coldChainRequired);
  return coldChainCostInr + getTransporterQuoteVarianceInr(transporterId);
}

// ─── Stage 1: Hard Eligibility Filtering ─────────────────────────────────────

export function checkEligibility(
  transporter: TransporterCandidate,
  req: RequirementInput
): EligibilityOutcome {
  const failures: EligibilityFailure[] = [];
  const estimatedCostInr = calculateTransporterQuoteInr(
    req.estimatedDistanceKm,
    req.coldChainRequired,
    transporter.id
  );

  if (transporter.vehicles.length === 0) {
    failures.push({
      code: "NO_ACTIVE_VEHICLES",
      reason: `${transporter.name} has no active vehicles registered on the platform`,
    });
  }

  if (req.coldChainRequired && !transporter.coldChainCapable) {
    failures.push({
      code: "COLD_CHAIN_NOT_AVAILABLE",
      reason: `${transporter.name} does not have cold chain capability. This shipment requires temperature control (${req.tempMinCelsius}°C – ${req.tempMaxCelsius}°C)`,
    });
  }

  const coversRoute = transporter.supportedRoutes.some(
    (r) =>
      r.origin.toLowerCase() === req.originCity.toLowerCase() &&
      r.destination.toLowerCase() === req.destinationCity.toLowerCase()
  );
  if (!coversRoute) {
    failures.push({
      code: "ROUTE_NOT_COVERED",
      reason: `${transporter.name} does not service the ${req.originCity} → ${req.destinationCity} route`,
    });
  }

  if (estimatedCostInr > req.maxCostInr) {
    failures.push({
      code: "COST_EXCEEDS_MAXIMUM",
      reason: `Estimated cost ₹${estimatedCostInr.toLocaleString("en-IN")} exceeds the maximum allowed ₹${req.maxCostInr.toLocaleString("en-IN")}`,
    });
  }

  const eligibleVehicles = transporter.vehicles.filter((v) =>
    vehicleMeetsRequirement(v, req)
  );

  if (transporter.vehicles.length > 0 && eligibleVehicles.length === 0) {
    const allUnderCapacity = transporter.vehicles.every((v) => v.capacityKg < req.weightKg);
    const allTempMismatch =
      req.coldChainRequired &&
      transporter.vehicles.every((v) => v.coldChain && !vehicleTemperatureCompatible(v, req));

    if (allUnderCapacity) {
      const maxCap = Math.max(...transporter.vehicles.map((v) => v.capacityKg));
      failures.push({
        code: "INSUFFICIENT_VEHICLE_CAPACITY",
        reason: `No vehicle has sufficient capacity for ${req.weightKg.toLocaleString("en-IN")} kg. Largest available: ${maxCap.toLocaleString("en-IN")} kg`,
      });
    } else if (allTempMismatch) {
      failures.push({
        code: "TEMPERATURE_RANGE_MISMATCH",
        reason: `No vehicle supports the required temperature range ${req.tempMinCelsius}°C – ${req.tempMaxCelsius}°C`,
      });
    }
  }

  if (failures.length > 0) {
    return { eligible: false, failures, estimatedCostInr };
  }

  return { eligible: true, eligibleVehicles, estimatedCostInr };
}

function vehicleMeetsRequirement(v: VehicleCandidate, req: RequirementInput): boolean {
  if (v.capacityKg < req.weightKg) return false;
  if (req.coldChainRequired) {
    if (!v.coldChain) return false;
    if (!vehicleTemperatureCompatible(v, req)) return false;
  }
  return true;
}

function vehicleTemperatureCompatible(v: VehicleCandidate, req: RequirementInput): boolean {
  if (req.tempMinCelsius === null || req.tempMaxCelsius === null) return true;
  if (v.tempMinCelsius === null || v.tempMaxCelsius === null) return true;
  return (
    Number(v.tempMinCelsius) <= req.tempMinCelsius &&
    Number(v.tempMaxCelsius) >= req.tempMaxCelsius
  );
}

// ─── Stage 2: Performance Scoring ────────────────────────────────────────────

export function scoreTransporter(
  transporter: TransporterCandidate,
  req: RequirementInput,
  estimatedCostInr: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): ScoringResult {
  const kpi = transporter.latestKPI;

  if (!kpi) {
    return buildNoHistoryScore(transporter, estimatedCostInr, req, weights);
  }

  const components: ScoreComponent[] = [
    buildKPIComponent(
      "OTIF", weights.otif, kpi.otifPercent,
      (v) => v,
      (v) => `${v.toFixed(1)}% of shipments delivered on time and in full`
    ),
    buildKPIComponent(
      "SLA Compliance", weights.slaCompliance, kpi.slaBreachRatePercent,
      (v) => 100 - v,
      (v) => `${v.toFixed(1)}% SLA breach rate (${(100 - v).toFixed(1)}% compliance)`
    ),
    buildKPIComponent(
      "TAT Performance", weights.tat, kpi.avgTatHours,
      normalizeTAT,
      (v) => `Average TAT of ${v.toFixed(1)} hours`
    ),
    buildKPIComponent(
      "Tracking Compliance", weights.trackingCompliance, kpi.trackingCompliancePercent,
      (v) => v,
      (v) => `${v.toFixed(1)}% GPS tracking compliance`
    ),
    buildKPIComponent(
      "Damage & Shortage", weights.damageShortage, kpi.damageShortageRatePercent,
      (v) => 100 - v,
      (v) => `${v.toFixed(1)}% damage/shortage rate`
    ),
    buildKPIComponent(
      "POD Compliance", weights.podCompliance, kpi.podCompliancePercent,
      (v) => v,
      (v) => `${v.toFixed(1)}% digital POD submission rate`
    ),
    buildComponent(
      "Cost Competitiveness",
      weights.cost,
      estimatedCostInr,
      normalizeCost(estimatedCostInr, req.maxCostInr),
      `Estimated cost ₹${estimatedCostInr.toLocaleString("en-IN")} vs maximum ₹${req.maxCostInr.toLocaleString("en-IN")}`
    ),
  ];

  const totalScore = parseFloat(
    components.reduce((sum, c) => sum + c.weightedScore, 0).toFixed(1)
  );

  return {
    totalScore,
    components,
    narrative: buildNarrative(transporter.name, totalScore, components, kpi),
    hasKPIHistory: true,
  };
}

function buildComponent(
  label: string,
  weight: number,
  rawValue: number,
  normalizedScore: number,
  explanation: string
): ScoreComponent {
  const clamped = Math.min(100, Math.max(0, normalizedScore));
  return {
    label,
    weight,
    rawValue,
    normalizedScore: parseFloat(clamped.toFixed(1)),
    weightedScore: parseFloat((clamped * weight).toFixed(2)),
    explanation,
    available: true,
  };
}

/** A KPI-derived component that degrades to a neutral, clearly-flagged score when the underlying KPI is unavailable. */
function buildKPIComponent(
  label: string,
  weight: number,
  rawValue: number | null,
  computeNormalized: (value: number) => number,
  explain: (value: number) => string
): ScoreComponent {
  if (rawValue === null) {
    const neutral = 50;
    return {
      label,
      weight,
      rawValue: 0,
      normalizedScore: neutral,
      weightedScore: parseFloat((neutral * weight).toFixed(2)),
      explanation: `${label} is not available for this transporter yet — treated as neutral`,
      available: false,
    };
  }
  return buildComponent(label, weight, rawValue, computeNormalized(rawValue), explain(rawValue));
}

function normalizeTAT(avgTatHours: number): number {
  if (avgTatHours <= BEST_TAT_HOURS) return 100;
  if (avgTatHours >= WORST_TAT_HOURS) return 0;
  return ((WORST_TAT_HOURS - avgTatHours) / (WORST_TAT_HOURS - BEST_TAT_HOURS)) * 100;
}

function normalizeCost(estimatedCost: number, maxCost: number): number {
  const ratio = estimatedCost / maxCost;
  if (ratio <= 0.5) return 100;
  if (ratio >= 1.0) return 0;
  return ((1.0 - ratio) / 0.5) * 100;
}

function buildNoHistoryScore(
  transporter: TransporterCandidate,
  estimatedCostInr: number,
  req: RequirementInput,
  weights: ScoringWeights
): ScoringResult {
  const costScore = normalizeCost(estimatedCostInr, req.maxCostInr);
  const neutral = 50;

  const components: ScoreComponent[] = [
    buildComponent("OTIF", weights.otif, 0, neutral, "No historical data available"),
    buildComponent("SLA Compliance", weights.slaCompliance, 0, neutral, "No historical data available"),
    buildComponent("TAT Performance", weights.tat, 0, neutral, "No historical data available"),
    buildComponent("Tracking Compliance", weights.trackingCompliance, 0, neutral, "No historical data available"),
    buildComponent("Damage & Shortage", weights.damageShortage, 0, neutral, "No historical data available"),
    buildComponent("POD Compliance", weights.podCompliance, 0, neutral, "No historical data available"),
    buildComponent(
      "Cost Competitiveness",
      weights.cost,
      estimatedCostInr,
      costScore,
      `Estimated cost ₹${estimatedCostInr.toLocaleString("en-IN")} vs maximum ₹${req.maxCostInr.toLocaleString("en-IN")}`
    ),
  ];

  const totalScore = parseFloat(
    components.reduce((sum, c) => sum + c.weightedScore, 0).toFixed(1)
  );

  return {
    totalScore,
    components,
    narrative: `${transporter.name} has no historical performance data. Score is based on cost competitiveness only. Exercise caution when selecting a transporter without a performance track record.`,
    hasKPIHistory: false,
  };
}

function buildNarrative(
  name: string,
  totalScore: number,
  components: ScoreComponent[],
  kpi: KPISnapshot
): string {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  for (const c of components) {
    if (c.label === "Cost Competitiveness" || !c.available) continue;
    if (c.normalizedScore >= 90) strengths.push(c.explanation);
    else if (c.normalizedScore < 70) weaknesses.push(c.explanation);
  }

  const costComp = components.find((c) => c.label === "Cost Competitiveness")!;

  let narrative = `${name} scored ${totalScore}/100 (based on ${kpi.period} data, ${kpi.totalShipments} shipments).`;
  if (strengths.length > 0) narrative += ` Strengths: ${strengths.join("; ")}.`;
  if (weaknesses.length > 0) narrative += ` Areas of concern: ${weaknesses.join("; ")}.`;
  narrative += ` ${costComp.explanation}.`;

  if (totalScore >= 90) {
    narrative += " Highly recommended — consistently strong performance across all metrics.";
  } else if (totalScore >= 80) {
    narrative += " Good overall performance with minor areas for improvement.";
  } else if (totalScore >= 70) {
    narrative += " Acceptable performance. Review areas of concern before selection.";
  } else {
    narrative += " Below-average performance. Consider alternatives if available.";
  }

  return narrative;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export function runMatchingEngine(
  transporters: TransporterCandidate[],
  req: RequirementInput,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): MatchResult[] {
  const withEligibility = transporters.map((t) => ({
    transporter: t,
    eligibility: checkEligibility(t, req),
  }));

  const eligibleScored = withEligibility
    .filter((e) => e.eligibility.eligible)
    .map((e) => {
      const outcome = e.eligibility as { eligible: true; estimatedCostInr: number };
      return {
        transporter: e.transporter,
        eligibility: e.eligibility,
        scoring: scoreTransporter(e.transporter, req, outcome.estimatedCostInr, weights),
        estimatedCostInr: outcome.estimatedCostInr,
      };
    })
    .sort((a, b) => b.scoring.totalScore - a.scoring.totalScore);

  const rankedIds = new Map(eligibleScored.map((e, i) => [e.transporter.id, i + 1]));

  const results: MatchResult[] = [];

  for (const { transporter, eligibility, scoring } of eligibleScored) {
    results.push({
      transporter: {
        id: transporter.id,
        name: transporter.name,
        city: transporter.city,
        state: transporter.state,
        coldChainCapable: transporter.coldChainCapable,
        baseCostPerKmInr: transporter.baseCostPerKmInr,
      },
      eligibility,
      scoring,
      rank: rankedIds.get(transporter.id) ?? null,
      recommended: rankedIds.get(transporter.id) === 1,
    });
  }

  for (const { transporter, eligibility } of withEligibility.filter((e) => !e.eligibility.eligible)) {
    results.push({
      transporter: {
        id: transporter.id,
        name: transporter.name,
        city: transporter.city,
        state: transporter.state,
        coldChainCapable: transporter.coldChainCapable,
        baseCostPerKmInr: transporter.baseCostPerKmInr,
      },
      eligibility,
      scoring: null,
      rank: null,
      recommended: false,
    });
  }

  return results;
}
