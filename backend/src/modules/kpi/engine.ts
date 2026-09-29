import { KPI_THRESHOLDS, KPI_WEIGHTS } from "./config";
import { HistoricalShipmentRecord, KPIComponent, KPIComputationResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// KPI DEFINITIONS
//
// "Settled" cohort = shipments with status DELIVERED or COMPLETED in the
// period (the vehicle actually reached the destination). "Completed"
// cohort = the subset that finished the full lifecycle (POD approved,
// shipment closed) — only there is `sla.isBreached` reliably populated.
//
//   OTIF                = on-time deliveries              / completed shipments
//   Avg TAT              = mean(deliveredAt − dispatchedAt) over settled shipments with both timestamps
//   SLA breach rate       = breached deliveries             / completed shipments
//   Damage/shortage rate  = shipments with DAMAGED/PARTIAL POD condition / settled shipments with a recorded condition
//   Tracking compliance   = shipments with no GPS gap > threshold / settled shipments with a known transit window
//   POD compliance        = shipments with an APPROVED POD  / settled shipments
//   Exception rate        = shipments with a HIGH/CRITICAL SLA risk event / completed shipments
//
// POD compliance deliberately uses the broader "settled" cohort (not just
// "completed") — a shipment can only become COMPLETED once its POD is
// already APPROVED (see shipments/service.ts), so measuring compliance
// against the completed-only cohort would trivially always read 100%.
// ─────────────────────────────────────────────────────────────────────────

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function isTrackingCompliant(
  dispatchedAt: Date,
  deliveredAt: Date,
  pingTimestamps: Date[]
): boolean {
  if (pingTimestamps.length < KPI_THRESHOLDS.minLocationPingsForCompliance) return false;
  const sorted = [...pingTimestamps].sort((a, b) => a.getTime() - b.getTime());
  const boundary = [dispatchedAt, ...sorted, deliveredAt];
  for (let i = 1; i < boundary.length; i++) {
    const gapMinutes = (boundary[i].getTime() - boundary[i - 1].getTime()) / 60_000;
    if (gapMinutes > KPI_THRESHOLDS.trackingGapMinutesThreshold) return false;
  }
  return true;
}

function normalizeTat(avgTatHours: number): number {
  const { bestTatHours, worstTatHours } = KPI_THRESHOLDS;
  if (avgTatHours <= bestTatHours) return 100;
  if (avgTatHours >= worstTatHours) return 0;
  return ((worstTatHours - avgTatHours) / (worstTatHours - bestTatHours)) * 100;
}

export function computeKPIs(shipments: HistoricalShipmentRecord[]): KPIComputationResult {
  const calculatedAt = new Date();
  const settled = shipments; // caller already restricts to DELIVERED/COMPLETED
  const completed = settled.filter((s) => s.status === "COMPLETED");

  // ── OTIF ──────────────────────────────────────────────────────────────
  const otifEligible = completed.filter((s) => s.deliveredAt);
  const onTime = otifEligible.filter((s) => s.deliveredAt! <= s.slaDeadline);
  const otifPercent = otifEligible.length > 0 ? (onTime.length / otifEligible.length) * 100 : null;

  // ── Average TAT ───────────────────────────────────────────────────────
  const tatEligible = settled.filter((s) => s.dispatchedAt && s.deliveredAt);
  const avgTatHours = average(
    tatEligible.map((s) => (s.deliveredAt!.getTime() - s.dispatchedAt!.getTime()) / 3_600_000)
  );

  // ── SLA breach rate ───────────────────────────────────────────────────
  const breachEligible = completed;
  const breached = breachEligible.filter((s) => s.slaIsBreached === true);
  const slaBreachRatePercent = breachEligible.length > 0 ? (breached.length / breachEligible.length) * 100 : null;

  // ── Damage / shortage rate ────────────────────────────────────────────
  const damageEligible = settled.filter((s) => s.podCondition !== null);
  const damaged = damageEligible.filter((s) => s.podCondition === "DAMAGED" || s.podCondition === "PARTIAL");
  const damageShortageRatePercent = damageEligible.length > 0 ? (damaged.length / damageEligible.length) * 100 : null;

  // ── Tracking compliance ───────────────────────────────────────────────
  const trackingEligible = settled.filter((s) => s.dispatchedAt && s.deliveredAt);
  const trackingCompliant = trackingEligible.filter((s) =>
    isTrackingCompliant(s.dispatchedAt!, s.deliveredAt!, s.locationTimestamps)
  );
  const trackingCompliancePercent =
    trackingEligible.length > 0 ? (trackingCompliant.length / trackingEligible.length) * 100 : null;

  // ── POD compliance ────────────────────────────────────────────────────
  const podEligible = settled;
  const podValid = podEligible.filter((s) => s.podStatus === "APPROVED");
  const podCompliancePercent = podEligible.length > 0 ? (podValid.length / podEligible.length) * 100 : null;

  // ── Exception rate ────────────────────────────────────────────────────
  const exceptionEligible = completed;
  const withException = exceptionEligible.filter((s) => s.hadHighSeverityException);
  const exceptionRatePercent = exceptionEligible.length > 0 ? (withException.length / exceptionEligible.length) * 100 : null;

  // ── Component breakdown ───────────────────────────────────────────────
  const components: KPIComponent[] = [
    buildComponent("otif", "OTIF", KPI_WEIGHTS.otif, otifPercent, otifEligible.length, otifPercent,
      (v) => `${v.toFixed(1)}% of shipments delivered on or before the SLA deadline`),
    buildComponent("slaCompliance", "SLA Compliance", KPI_WEIGHTS.slaCompliance, slaBreachRatePercent, breachEligible.length,
      slaBreachRatePercent !== null ? 100 - slaBreachRatePercent : null,
      (v) => `${v.toFixed(1)}% SLA breach rate (${(100 - v).toFixed(1)}% compliance)`),
    buildComponent("tat", "TAT Performance", KPI_WEIGHTS.tat, avgTatHours, tatEligible.length,
      avgTatHours !== null ? normalizeTat(avgTatHours) : null,
      (v) => `Average turnaround time of ${v.toFixed(1)} hours`),
    buildComponent("trackingCompliance", "Tracking Compliance", KPI_WEIGHTS.trackingCompliance, trackingCompliancePercent, trackingEligible.length, trackingCompliancePercent,
      (v) => `${v.toFixed(1)}% of shipments had continuous GPS tracking (no gap over ${KPI_THRESHOLDS.trackingGapMinutesThreshold} min)`),
    buildComponent("damageShortage", "Damage & Shortage", KPI_WEIGHTS.damageShortage, damageShortageRatePercent, damageEligible.length,
      damageShortageRatePercent !== null ? 100 - damageShortageRatePercent : null,
      (v) => `${v.toFixed(1)}% damage/shortage rate`),
    buildComponent("podCompliance", "POD Compliance", KPI_WEIGHTS.podCompliance, podCompliancePercent, podEligible.length, podCompliancePercent,
      (v) => `${v.toFixed(1)}% of delivered shipments have an approved POD`),
    buildComponent("exceptionRate", "Exception Rate", KPI_WEIGHTS.exceptionRate, exceptionRatePercent, exceptionEligible.length,
      exceptionRatePercent !== null ? 100 - exceptionRatePercent : null,
      (v) => `${v.toFixed(1)}% of shipments had a high-severity SLA risk exception`),
  ];

  // Composite = weighted average over AVAILABLE components only — missing
  // data is excluded, never treated as a 0 or 100.
  const available = components.filter((c) => c.available);
  const totalAvailableWeight = available.reduce((sum, c) => sum + c.weight, 0);
  const compositeScore =
    totalAvailableWeight > 0
      ? available.reduce((sum, c) => sum + c.normalizedScore! * c.weight, 0) / totalAvailableWeight
      : null;

  // Now that the composite is known, express each component's contribution
  // as actual points on the 0–100 composite scale (so they sum to it).
  for (const c of components) {
    c.weightedContribution =
      c.available && totalAvailableWeight > 0 ? (c.normalizedScore! * c.weight) / totalAvailableWeight : 0;
  }

  return {
    totalShipments: settled.length,
    onTimeDeliveries: onTime.length,
    otifPercent,
    avgTatHours,
    slaBreachRatePercent,
    damageShortageRatePercent,
    trackingCompliancePercent,
    podCompliancePercent,
    exceptionRatePercent,
    compositeScore,
    components,
    calculatedAt,
  };
}

function buildComponent(
  key: KPIComponent["key"],
  label: string,
  weight: number,
  rawValue: number | null,
  eligibleCount: number,
  normalizedScore: number | null,
  explain: (value: number) => string
): KPIComponent {
  const available = rawValue !== null && normalizedScore !== null;
  return {
    key,
    label,
    weight,
    value: rawValue,
    normalizedScore,
    weightedContribution: 0, // filled in after the composite is computed
    available,
    eligibleCount,
    explanation: available
      ? explain(rawValue!)
      : `Not enough shipment data in this period to calculate ${label}`,
  };
}
