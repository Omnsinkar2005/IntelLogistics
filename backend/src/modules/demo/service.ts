import { prisma } from "../../db/client";
import { NotFoundError, BusinessRuleError } from "../../shared/errors";
import { LocationSource, ShipmentStatus, RequirementStatus } from "../../../generated/prisma/client";
import { resolvePlannedRouteDistanceKm } from "../../shared/utils";
import { getDefaultManager } from "../users/service";
import { createRequirement, updateRequirementStatus, getRequirementById } from "../requirements/service";
import { completeShipment, dispatchShipment, getShipmentById } from "../shipments/service";
import {
  startSimulation, pauseSimulation, setSimulationMode, getSimulationState, stopSimulation,
} from "../tracking/simulator";
import { recalculateETA, getLatestLocation, getLatestETA } from "../tracking/service";
import { evaluateSLARisk, resolveActiveSLARisk, getShipmentSLARisk } from "../sla/service";
import { confirmDelivery, reviewPOD, getPOD } from "../pod/service";
import { recalculateKPI } from "../kpi/service";
import { DEMO_SCENARIO, DEMO_ROAD_EVENT_TITLE, DEMO_FESTIVAL_EVENT_TITLE } from "./config";

// ─────────────────────────────────────────────────────────────────────────
// DEMO MODE ORCHESTRATION
//
// Every action here either calls a real business-logic service directly,
// or performs plain demo-lifecycle bookkeeping (creating/deleting the demo
// session pointer, refreshing a mock route event's validity window,
// teleporting the demo vehicle to its destination). Nothing in this file
// re-implements ETA, SLA risk, matching, POD, or KPI logic — see the
// imports above. This keeps demo mode from drifting out of sync with the
// real product behavior it's supposed to be showing off.
// ─────────────────────────────────────────────────────────────────────────

async function getSession() {
  return prisma.demoSession.findFirst({ orderBy: { createdAt: "desc" } });
}

async function requireActiveShipmentId(): Promise<string> {
  const session = await getSession();
  if (!session?.shipmentId) {
    throw new BusinessRuleError("No demo shipment yet — create the demo shipment first.");
  }
  return session.shipmentId;
}

async function deleteShipmentCascade(shipmentId: string) {
  stopSimulation(shipmentId);
  await prisma.shipmentLocation.deleteMany({ where: { shipmentId } });
  await prisma.eTASnapshot.deleteMany({ where: { shipmentId } });
  await prisma.sLARiskEvent.deleteMany({ where: { shipmentId } });
  await prisma.shipmentRouteEvent.deleteMany({ where: { shipmentId } });
  await prisma.pOD.deleteMany({ where: { shipmentId } });
  await prisma.sLA.deleteMany({ where: { shipmentId } });
  await prisma.shipment.deleteMany({ where: { id: shipmentId } });
}

/** Re-runs the same two calls the GPS simulator makes on every tick, on demand. */
async function forceRecalculate(shipmentId: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) return;
  const latestLocation = await prisma.shipmentLocation.findFirst({
    where: { shipmentId },
    orderBy: { recordedAt: "desc" },
  });
  if (!latestLocation) return; // simulator hasn't ticked yet — nothing to recompute from

  const totalKm = resolvePlannedRouteDistanceKm({
    distanceKm: shipment.distanceKm ? Number(shipment.distanceKm) : null,
    originLat: Number(shipment.originLat),
    originLng: Number(shipment.originLng),
    destinationLat: Number(shipment.destinationLat),
    destinationLng: Number(shipment.destinationLng),
  });

  await recalculateETA(
    shipmentId,
    Number(latestLocation.latitude),
    Number(latestLocation.longitude),
    Number(latestLocation.speedKmh ?? 0),
    totalKm
  );
  await evaluateSLARisk(shipmentId);
}

/** Activates a named mock route event by shifting its window to bracket right now. */
async function activateNamedRouteEvent(title: string) {
  const event = await prisma.routeEvent.findFirst({ where: { title } });
  if (!event) throw new NotFoundError("RouteEvent", title);
  const now = new Date();
  await prisma.routeEvent.update({
    where: { id: event.id },
    data: {
      validFrom: new Date(now.getTime() - 5 * 60_000),
      validUntil: new Date(now.getTime() + 3 * 3_600_000),
    },
  });
  return event;
}

// ── 1. Create/load demo transport requirement ─────────────────────────────
export async function startDemo() {
  const existing = await getSession();
  if (existing?.requirementId) {
    const requirement = await prisma.transportRequirement.findUnique({ where: { id: existing.requirementId } });
    if (requirement) return { requirement, alreadyStarted: true };
  }

  const manager = await getDefaultManager();
  if (!manager?.companyId) {
    throw new BusinessRuleError("No manager/company found to run the demo. Run the database seed first.");
  }

  const [originFacility, destinationFacility] = await Promise.all([
    prisma.facility.findFirst({ where: { name: DEMO_SCENARIO.originFacilityName } }),
    prisma.facility.findFirst({ where: { name: DEMO_SCENARIO.destinationFacilityName } }),
  ]);
  if (!originFacility || !destinationFacility) {
    throw new BusinessRuleError("Demo facilities not found. Run the database seed first.");
  }

  const slaDeadline = new Date(Date.now() + DEMO_SCENARIO.slaHoursFromStart * 3_600_000);

  const newRequirement = await createRequirement({
    companyId: manager.companyId,
    createdById: manager.id,
    saveAsDraft: false,
    originFacilityId: originFacility.id,
    destinationFacilityId: destinationFacility.id,
    productType: DEMO_SCENARIO.productType,
    productDescription: DEMO_SCENARIO.productDescription,
    weightKg: DEMO_SCENARIO.weightKg,
    volumeCbm: DEMO_SCENARIO.volumeCbm,
    coldChainRequired: DEMO_SCENARIO.coldChainRequired,
    tempMinCelsius: DEMO_SCENARIO.tempMinCelsius,
    tempMaxCelsius: DEMO_SCENARIO.tempMaxCelsius,
    maxCostInr: DEMO_SCENARIO.maxCostInr,
    slaDeadline: slaDeadline.toISOString(),
    specialInstructions: DEMO_SCENARIO.specialInstructions,
  });
  // The demo picks up mid-lifecycle (an active, in-progress shipment), not
  // at the draft-composition step — so it walks the requirement straight
  // through the same Ready to Send -> Sent for Quotation transition a real
  // manager's "Send" action would trigger, via the real transition function
  // (this is also what snapshots matchedTransporterCount for the UI).
  await updateRequirementStatus(newRequirement.id, RequirementStatus.OPEN);
  const requirement = await getRequirementById(newRequirement.id);

  if (existing) {
    await prisma.demoSession.update({ where: { id: existing.id }, data: { requirementId: requirement.id, shipmentId: null } });
  } else {
    await prisma.demoSession.create({ data: { requirementId: requirement.id } });
  }

  return { requirement, alreadyStarted: false };
}

// ── Full state snapshot for the control panel ──────────────────────────────
export async function getDemoState() {
  const session = await getSession();
  if (!session?.requirementId) return { active: false as const };

  const requirement = await prisma.transportRequirement.findUnique({
    where: { id: session.requirementId },
    include: { shipment: true },
  });
  if (!requirement) return { active: false as const };

  const shipment = requirement.shipment;
  if (!shipment) {
    return { active: true as const, requirement, shipment: null };
  }

  const [location, eta, riskData, pod] = await Promise.all([
    getLatestLocation(shipment.id).catch(() => null),
    getLatestETA(shipment.id).catch(() => null),
    getShipmentSLARisk(shipment.id).catch(() => null),
    getPOD(shipment.id).catch(() => null),
  ]);

  return {
    active: true as const,
    requirement,
    shipment,
    location,
    eta,
    risk: riskData?.activeRisk ?? null,
    pod,
    simState: getSimulationState(shipment.id),
  };
}

// ── 2. Load demo transporters / 3. Select transporter ──────────────────────
// No dedicated endpoint — the control panel calls the real, existing
// `GET /requirements/:id/transporters` endpoint directly once it has the
// demo requirement id, and "select" is purely a UI choice among the
// results. See frontend DemoControlPanel.

// ── After shipment creation, record it on the session ──────────────────────
export async function attachDemoShipment(shipmentId: string) {
  const session = await getSession();
  if (!session) throw new BusinessRuleError("Start the demo before creating a shipment.");
  await prisma.demoSession.update({ where: { id: session.id }, data: { shipmentId } });
  return getShipmentById(shipmentId);
}

// ── 5. Start vehicle movement ───────────────────────────────────────────────
export async function startDemoMovement() {
  const shipmentId = await requireActiveShipmentId();
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new NotFoundError("Shipment", shipmentId);

  if (shipment.status === ShipmentStatus.CREATED) {
    return dispatchShipment(shipmentId);
  }
  startSimulation(shipmentId);
  return getShipmentById(shipmentId);
}

// ── 6. Pause vehicle ─────────────────────────────────────────────────────────
export async function pauseDemoMovement() {
  const shipmentId = await requireActiveShipmentId();
  pauseSimulation(shipmentId);
  return { paused: true };
}

// ── 7. Trigger traffic delay ────────────────────────────────────────────────
export async function triggerDemoTrafficDelay() {
  const shipmentId = await requireActiveShipmentId();
  setSimulationMode(shipmentId, "TRAFFIC");
  await forceRecalculate(shipmentId);
  return { mode: "TRAFFIC" };
}

// ── 8. Trigger road event ───────────────────────────────────────────────────
export async function triggerDemoRoadEvent() {
  const shipmentId = await requireActiveShipmentId();
  const event = await activateNamedRouteEvent(DEMO_ROAD_EVENT_TITLE);
  await forceRecalculate(shipmentId);
  return { event: event.title, eventType: event.eventType };
}

// ── 9. Trigger festival/event impact ────────────────────────────────────────
export async function triggerDemoFestivalEvent() {
  const shipmentId = await requireActiveShipmentId();
  const event = await activateNamedRouteEvent(DEMO_FESTIVAL_EVENT_TITLE);
  await forceRecalculate(shipmentId);
  return { event: event.title, eventType: event.eventType };
}

// ── 10. Recalculate ETA ─────────────────────────────────────────────────────
export async function recalculateDemoETA() {
  const shipmentId = await requireActiveShipmentId();
  await forceRecalculate(shipmentId);
  return getLatestETA(shipmentId);
}

// ── 11. Trigger SLA risk ────────────────────────────────────────────────────
// Stops the vehicle and re-evaluates immediately — the most reliable way to
// guarantee a visible, explainable risk escalation on demand for a live
// presentation, rather than waiting on natural thresholds.
export async function triggerDemoSLARisk() {
  const shipmentId = await requireActiveShipmentId();
  setSimulationMode(shipmentId, "STOPPED");
  await forceRecalculate(shipmentId);
  const riskData = await getShipmentSLARisk(shipmentId);
  return riskData.activeRisk;
}

// ── 12. Move vehicle to destination ─────────────────────────────────────────
// DEMO-ONLY: teleports the vehicle to the destination instead of waiting
// out real-time GPS simulation. Drives the exact same recalculateETA /
// evaluateSLARisk / resolveActiveSLARisk calls the simulator's own final
// tick would use — see tracking/simulator.ts. No production code path
// allows this; it exists solely so a presenter isn't stuck waiting hours.
export async function moveDemoToDestination() {
  const shipmentId = await requireActiveShipmentId();
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new NotFoundError("Shipment", shipmentId);

  stopSimulation(shipmentId);

  const destLat = Number(shipment.destinationLat);
  const destLng = Number(shipment.destinationLng);

  await prisma.shipmentLocation.create({
    data: {
      shipmentId,
      vehicleId: shipment.vehicleId,
      latitude: destLat,
      longitude: destLng,
      speedKmh: 0,
      heading: 0,
      source: LocationSource.SIMULATED,
      recordedAt: new Date(),
    },
  });

  const totalKm = resolvePlannedRouteDistanceKm({
    distanceKm: shipment.distanceKm ? Number(shipment.distanceKm) : null,
    originLat: Number(shipment.originLat),
    originLng: Number(shipment.originLng),
    destinationLat: destLat,
    destinationLng: destLng,
  });

  await recalculateETA(shipmentId, destLat, destLng, 0, totalKm);
  await evaluateSLARisk(shipmentId);

  await prisma.shipment.updateMany({
    where: { id: shipmentId, status: { in: [ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELAYED, ShipmentStatus.AT_RISK] } },
    data: { status: ShipmentStatus.DELIVERED, deliveredAt: new Date() },
  });
  await resolveActiveSLARisk(shipmentId);

  return getShipmentById(shipmentId);
}

// ── 13. Open receiver confirmation page ─────────────────────────────────────
// No backend action — the control panel links straight to the real
// `/deliver/:token` receiver page (using the demo shipment's POD QR
// token). Demo mode drives the real UI rather than reimplementing it.

// ── 14. Confirm delivery (simulates the receiver scanning the QR and
// tapping "YES, RECEIVED IN PROPER CONDITION") ──────────────────────────────
export async function quickConfirmDemoDelivery() {
  const shipmentId = await requireActiveShipmentId();
  const pod = await prisma.pOD.findUnique({
    where: { shipmentId },
    include: { shipment: { include: { requirement: { select: { weightKg: true } } } } },
  });
  if (!pod?.qrToken) throw new NotFoundError("POD", shipmentId);

  // Simulates a clean Delivery Inspection & Acceptance — full quantity
  // received, no packaging/product/temperature issues — matching the demo's
  // "everything went fine" happy path.
  const receivedQuantityKg = pod.shipment.requirement?.weightKg ? Number(pod.shipment.requirement.weightKg) : 1;
  return confirmDelivery(pod.qrToken, {
    receivedQuantityKg,
    isPartialDelivery: false,
    packagingDamaged: false,
    productIssueObserved: false,
  });
}

// ── 15. Approve POD ─────────────────────────────────────────────────────────
// Bundled with completion: a presenter clicking "Approve POD" expects to
// see the shipment fully closed out in one step, matching the real
// business rule (completion requires an approved POD) rather than
// bypassing it — this just chains two real calls back to back.
export async function approveDemoPod() {
  const shipmentId = await requireActiveShipmentId();
  const manager = await getDefaultManager();
  if (!manager) throw new BusinessRuleError("No manager found to approve the demo POD.");

  await reviewPOD(shipmentId, { action: "APPROVE", reviewedById: manager.id });
  return completeShipment(shipmentId);
}

// ── 16. Refresh transporter KPIs ────────────────────────────────────────────
export async function refreshDemoKpis() {
  const shipmentId = await requireActiveShipmentId();
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new NotFoundError("Shipment", shipmentId);
  return recalculateKPI(shipment.transporterId);
}

// ── RESET DEMO ───────────────────────────────────────────────────────────────
export async function resetDemo() {
  const session = await getSession();
  if (session?.shipmentId) {
    await deleteShipmentCascade(session.shipmentId);
  }
  if (session?.requirementId) {
    await prisma.transporterOffer.deleteMany({ where: { requirementId: session.requirementId } });
    await prisma.transportRequirement.deleteMany({ where: { id: session.requirementId } });
  }
  await prisma.demoSession.deleteMany({});
  return { reset: true };
}
