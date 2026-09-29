import { prisma } from "../../db/client";
import { NotFoundError, BusinessRuleError } from "../../shared/errors";
import { haversineKm } from "../../shared/utils";
import {
  RequirementInput,
  TransporterCandidate,
  KPISnapshot,
  ScoringWeights,
  DEFAULT_WEIGHTS,
  MatchResult,
} from "./types";
import { runMatchingEngine } from "./engine";

export async function getMatchingTransporters(
  requirementId: string,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): Promise<MatchResult[]> {
  const req = await prisma.transportRequirement.findUnique({
    where: { id: requirementId },
  });
  if (!req) throw new NotFoundError("TransportRequirement", requirementId);

  // Route/cargo/cost/SLA fields are nullable at the schema level (a Draft
  // can be saved with none of them filled in yet), but they're required by
  // the time a requirement is actually sent for quotation — see the
  // completeness check in requirements/service.ts. This should be
  // unreachable via the normal UI (matching is only ever invoked for a
  // requirement that has already been sent), but guard it explicitly
  // rather than silently matching against `NaN`/`null` route data.
  if (
    req.originCity === null || req.originState === null || req.originLat === null || req.originLng === null ||
    req.destinationCity === null || req.destinationLat === null || req.destinationLng === null ||
    req.weightKg === null || req.maxCostInr === null || req.slaDeadline === null
  ) {
    throw new BusinessRuleError(
      "This requirement is incomplete and has not been sent for quotation yet — complete and send it before matching transporters."
    );
  }

  // Estimate route distance using straight-line haversine
  // In production this would use a cached Mapbox Directions result
  const estimatedDistanceKm = haversineKm(
    Number(req.originLat),
    Number(req.originLng),
    Number(req.destinationLat),
    Number(req.destinationLng)
  ) * 1.25; // road distance is typically ~25% longer than straight line

  const requirementInput: RequirementInput = {
    originCity: req.originCity,
    destinationCity: req.destinationCity,
    weightKg: Number(req.weightKg),
    coldChainRequired: req.coldChainRequired,
    tempMinCelsius: req.tempMinCelsius !== null ? Number(req.tempMinCelsius) : null,
    tempMaxCelsius: req.tempMaxCelsius !== null ? Number(req.tempMaxCelsius) : null,
    maxCostInr: Number(req.maxCostInr),
    slaDeadline: req.slaDeadline,
    estimatedDistanceKm: Math.round(estimatedDistanceKm),
  };

  const dbTransporters = await prisma.transporter.findMany({
    where: { isActive: true },
    include: {
      vehicles: { where: { isActive: true } },
      kpis: { orderBy: { computedAt: "desc" }, take: 1 },
    },
  });

  const candidates: TransporterCandidate[] = dbTransporters.map((t) => {
    const kpiRow = t.kpis[0];
    const toNullableNumber = (v: unknown) => (v === null ? null : Number(v));
    const latestKPI: KPISnapshot | null = kpiRow
      ? {
          period: kpiRow.period,
          totalShipments: kpiRow.totalShipments,
          otifPercent: toNullableNumber(kpiRow.otifPercent),
          avgTatHours: toNullableNumber(kpiRow.avgTatHours),
          slaBreachRatePercent: toNullableNumber(kpiRow.slaBreachRatePercent),
          damageShortageRatePercent: toNullableNumber(kpiRow.damageShortageRatePercent),
          trackingCompliancePercent: toNullableNumber(kpiRow.trackingCompliancePercent),
          podCompliancePercent: toNullableNumber(kpiRow.podCompliancePercent),
          exceptionRatePercent: toNullableNumber(kpiRow.exceptionRatePercent),
        }
      : null;

    return {
      id: t.id,
      name: t.name,
      city: t.city,
      state: t.state,
      coldChainCapable: t.coldChainCapable,
      supportedRoutes: (t.supportedRoutes as unknown) as { origin: string; destination: string }[],
      baseCostPerKmInr: Number(t.baseCostPerKmInr),
      vehicles: t.vehicles.map((v) => ({
        id: v.id,
        vehicleNumber: v.vehicleNumber,
        vehicleType: v.vehicleType,
        capacityKg: v.capacityKg,
        coldChain: v.coldChain,
        tempMinCelsius: v.tempMinCelsius !== null ? Number(v.tempMinCelsius) : null,
        tempMaxCelsius: v.tempMaxCelsius !== null ? Number(v.tempMaxCelsius) : null,
        driverName: v.driverName,
        driverPhone: v.driverPhone,
      })),
      latestKPI,
    };
  });

  // Pure computation only — this used to also auto-flip the requirement to
  // MATCHED the instant any eligible transporter existed, which is exactly
  // the shortcut the real quotation flow replaces: "matched"/"quotations
  // received" must now mean a transporter actually submitted a quote (see
  // modules/quotation/service.ts submitQuotation), not merely that the
  // route/vehicle eligibility check passed. This function is called from
  // several places (the send-for-quotation transporter picker, demo mode)
  // purely to compute candidates/vehicle-eligibility — it must not have
  // side effects on the requirement it's given.
  return runMatchingEngine(candidates, requirementInput, weights);
}
