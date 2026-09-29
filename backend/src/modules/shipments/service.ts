import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../../db/client";
import { NotFoundError, BusinessRuleError, ConflictError } from "../../shared/errors";
import { ShipmentStatus, RequirementStatus } from "../../../generated/prisma/client";
import { startSimulation, stopSimulation } from "../tracking/simulator";
import { recalculateKPI } from "../kpi/service";

/** Shipment-specific token — used for the delivery QR and the assignment-notification link. */
function generateQrToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export const CreateShipmentSchema = z.object({
  requirementId: z.string().min(1),
  transporterId: z.string().min(1),
  vehicleId: z.string().min(1),
  agreedCostInr: z.number().positive(),
  notes: z.string().optional(),
});

export type CreateShipmentInput = z.infer<typeof CreateShipmentSchema>;

/**
 * Next "SHP-{year}-NNNN" number. Derived from the highest existing number
 * with this prefix, not from a total row count — same reasoning as
 * requirements/service.ts's nextReferenceNumber: the table also holds
 * non-"SHP-" rows (historical KPI-seed shipments) and rows get deleted
 * (demo reset), so `count() + 1` can land on a number that's already taken.
 */
async function nextTrackingNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SHP-${year}-`;
  const latest = await prisma.shipment.findFirst({
    where: { trackingNumber: { startsWith: prefix } },
    orderBy: { trackingNumber: "desc" },
    select: { trackingNumber: true },
  });
  const lastSeq = latest ? parseInt(latest.trackingNumber.slice(prefix.length), 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, "0")}`;
}

export async function createShipment(input: CreateShipmentInput) {
  const req = await prisma.transportRequirement.findUnique({
    where: { id: input.requirementId },
  });
  if (!req) throw new NotFoundError("TransportRequirement", input.requirementId);
  if (req.status === RequirementStatus.ASSIGNED) {
    throw new ConflictError("A shipment already exists for this requirement");
  }
  if (req.status === RequirementStatus.CANCELLED) {
    throw new BusinessRuleError("Cannot create shipment for a cancelled requirement");
  }
  // Route/cargo/SLA fields are nullable at the schema level (Draft support),
  // but guaranteed present by the time a requirement reaches OPEN/MATCHED —
  // see the completeness check in requirements/service.ts. Guard explicitly
  // rather than silently writing nulls onto the new shipment.
  if (
    req.originCity === null || req.originState === null ||
    req.originLat === null || req.originLng === null || req.destinationCity === null ||
    req.destinationState === null || req.destinationLat === null || req.destinationLng === null ||
    req.slaDeadline === null
  ) {
    throw new BusinessRuleError(
      "This requirement is incomplete and has not been sent for quotation yet — it cannot be assigned to a shipment."
    );
  }
  // Narrowed, non-null locals — `req.xxx` doesn't stay narrowed inside the
  // `$transaction` closure below since it's a separate function scope.
  const {
    originFacilityId, originCity, originState, originLat, originLng,
    destinationFacilityId, destinationCity, destinationState, destinationLat, destinationLng,
    slaDeadline,
  } = req;

  const vehicle = await prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw new NotFoundError("Vehicle", input.vehicleId);

  const trackingNumber = await nextTrackingNumber();

  const shipment = await prisma.$transaction(async (tx) => {
    const s = await tx.shipment.create({
      data: {
        requirementId: input.requirementId,
        transporterId: input.transporterId,
        vehicleId: input.vehicleId,
        trackingNumber,
        assignmentToken: generateQrToken(),
        originFacilityId,
        originCity,
        originState,
        originLat,
        originLng,
        destinationFacilityId,
        destinationCity,
        destinationState,
        destinationLat,
        destinationLng,
        agreedCostInr: input.agreedCostInr,
        slaDeadline,
        notes: input.notes,
        status: ShipmentStatus.CREATED,
      },
      include: {
        transporter: { select: { id: true, name: true } },
        vehicle: { select: { id: true, vehicleNumber: true, driverName: true, driverPhone: true } },
        requirement: { select: { id: true, referenceNumber: true } },
        originFacility: true,
        destinationFacility: true,
      },
    });

    // Create SLA record
    const tatHours = Math.round(
      (slaDeadline.getTime() - Date.now()) / 3_600_000
    );
    await tx.sLA.create({
      data: {
        shipmentId: s.id,
        deadline: slaDeadline,
        agreedTatHours: tatHours,
      },
    });

    // Create pending POD record — the QR token is generated up front so
    // the delivery QR is available from the shipment screen immediately.
    await tx.pOD.create({
      data: { shipmentId: s.id, status: "PENDING", qrToken: generateQrToken() },
    });

    // Mark requirement as assigned
    await tx.transportRequirement.update({
      where: { id: input.requirementId },
      data: { status: RequirementStatus.ASSIGNED },
    });

    return s;
  });

  return shipment;
}

export async function listShipments(status?: ShipmentStatus) {
  return prisma.shipment.findMany({
    where: status ? { status } : undefined,
    include: {
      transporter: { select: { id: true, name: true } },
      vehicle: { select: { id: true, vehicleNumber: true, driverName: true } },
      sla: { select: { deadline: true, isBreached: true } },
      pod: { select: { id: true, status: true, receiverOrganization: true, submittedAt: true, reviewedAt: true } },
      _count: { select: { slaEvents: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getShipmentById(id: string) {
  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: {
      transporter: true,
      vehicle: true,
      requirement: {
        select: {
          id: true,
          referenceNumber: true,
          productType: true,
          weightKg: true,
          coldChainRequired: true,
          tempMinCelsius: true,
          tempMaxCelsius: true,
        },
      },
      originFacility: true,
      destinationFacility: true,
      sla: true,
      pod: {
        select: {
          id: true,
          status: true,
          qrToken: true,
          receiverOrganization: true,
          submittedAt: true,
          reviewedAt: true,
        },
      },
      slaEvents: {
        where: { isActive: true },
        orderBy: { triggeredAt: "desc" },
        take: 1,
      },
      etaSnapshots: {
        orderBy: { calculatedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!shipment) throw new NotFoundError("Shipment", id);
  return shipment;
}

// ─────────────────────────────────────────────────────────────────────────
// SIMULATED ASSIGNMENT NOTIFICATION — transporter-facing, no login.
//
// The moment a shipment is created (createShipment above), an
// assignmentToken is generated and embedded in a one-time link — a POC
// stand-in for the "Shipment Assigned" email the transporter would
// otherwise receive. The manager-facing shipment screen displays this link
// (same copy/open pattern as the POD QR and the quotation link); opening
// it shows the transporter everything a real assignment email would.
// Read-only — there's nothing for the transporter to submit here.
// ─────────────────────────────────────────────────────────────────────────

/** Public, transporter-facing view of a shipment by its assignment token. */
export async function getPublicAssignmentInfo(token: string) {
  const shipment = await prisma.shipment.findUnique({
    where: { assignmentToken: token },
    include: {
      transporter: { select: { name: true } },
      vehicle: { select: { vehicleNumber: true, driverName: true, driverPhone: true } },
      originFacility: true,
      destinationFacility: true,
      requirement: {
        select: {
          productType: true,
          weightKg: true,
          volumeCbm: true,
          coldChainRequired: true,
          tempMinCelsius: true,
          tempMaxCelsius: true,
          specialInstructions: true,
          company: { select: { name: true } },
        },
      },
    },
  });
  if (!shipment) throw new NotFoundError("Shipment", token);

  return {
    trackingNumber: shipment.trackingNumber,
    companyName: shipment.requirement.company.name,
    transporterName: shipment.transporter.name,
    originName: shipment.originFacility?.name ?? shipment.originCity,
    destinationName: shipment.destinationFacility?.name ?? shipment.destinationCity,
    productType: shipment.requirement.productType,
    weightKg: shipment.requirement.weightKg,
    volumeCbm: shipment.requirement.volumeCbm,
    coldChainRequired: shipment.requirement.coldChainRequired,
    tempMinCelsius: shipment.requirement.tempMinCelsius,
    tempMaxCelsius: shipment.requirement.tempMaxCelsius,
    slaDeadline: shipment.slaDeadline,
    specialInstructions: shipment.requirement.specialInstructions,
    vehicleNumber: shipment.vehicle?.vehicleNumber ?? null,
    driverName: shipment.vehicle?.driverName ?? null,
    driverPhone: shipment.vehicle?.driverPhone ?? null,
  };
}

export async function dispatchShipment(id: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id } });
  if (!shipment) throw new NotFoundError("Shipment", id);
  if (shipment.status !== ShipmentStatus.CREATED) {
    throw new BusinessRuleError(`Shipment is already ${shipment.status}`);
  }

  const updated = await prisma.shipment.update({
    where: { id },
    data: { status: ShipmentStatus.DISPATCHED, dispatchedAt: new Date() },
    include: {
      vehicle: true,
      transporter: { select: { id: true, name: true } },
    },
  });

  // Start GPS simulation
  startSimulation(id);

  return updated;
}

export async function completeShipment(id: string) {
  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: { pod: true, sla: true },
  });
  if (!shipment) throw new NotFoundError("Shipment", id);
  if (shipment.pod?.status !== "APPROVED") {
    throw new BusinessRuleError("POD must be approved before completing the shipment");
  }

  const now = new Date();
  const isBreached = shipment.sla ? now > shipment.sla.deadline : false;
  const varianceMinutes = shipment.sla
    ? Math.round((shipment.sla.deadline.getTime() - now.getTime()) / 60_000)
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.shipment.update({
      where: { id },
      data: {
        status: ShipmentStatus.COMPLETED,
        completedAt: now,
        deliveredAt: shipment.deliveredAt ?? now,
      },
    });

    if (shipment.sla) {
      await tx.sLA.update({
        where: { shipmentId: id },
        data: {
          isBreached,
          breachedAt: isBreached ? now : null,
          deliveryVarianceMinutes: varianceMinutes,
        },
      });
    }

    stopSimulation(id);
    return result;
  });

  // Reflect this shipment's outcome in the transporter's KPI snapshot for
  // the current period. Best-effort — a KPI recalculation failure shouldn't
  // block the completion that already succeeded above.
  try {
    await recalculateKPI(shipment.transporterId);
  } catch (err) {
    console.error(`[Shipments] KPI recalculation failed for transporter ${shipment.transporterId}:`, err);
  }

  return updated;
}

export async function getShipmentTimeline(id: string) {
  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: {
      slaEvents: { orderBy: { triggeredAt: "asc" } },
      routeEvents: {
        include: { routeEvent: true },
        orderBy: { detectedAt: "asc" },
      },
      pod: { select: { status: true, submittedAt: true, reviewedAt: true } },
      sla: true,
    },
  });
  if (!shipment) throw new NotFoundError("Shipment", id);

  const events: Array<{ time: Date; type: string; title: string; detail?: string }> = [];

  events.push({ time: shipment.createdAt, type: "STATUS", title: "Shipment Created" });
  if (shipment.dispatchedAt) {
    events.push({ time: shipment.dispatchedAt, type: "STATUS", title: "Dispatched" });
  }
  for (const re of shipment.routeEvents) {
    events.push({
      time: re.detectedAt,
      type: "ROUTE_EVENT",
      title: re.routeEvent.title,
      detail: `${re.routeEvent.estimatedDelayMinutes} min delay`,
    });
  }
  for (const se of shipment.slaEvents) {
    events.push({
      time: se.triggeredAt,
      type: "SLA_RISK",
      title: `SLA Risk: ${se.riskLevel}`,
      detail: se.resolvedAt ? "Resolved" : "Active",
    });
  }
  if (shipment.deliveredAt) {
    events.push({ time: shipment.deliveredAt, type: "STATUS", title: "Delivered" });
  }
  if (shipment.pod?.submittedAt) {
    events.push({ time: shipment.pod.submittedAt, type: "POD", title: "POD Submitted" });
  }
  if (shipment.pod?.reviewedAt) {
    events.push({
      time: shipment.pod.reviewedAt,
      type: "POD",
      title: `POD ${shipment.pod.status}`,
    });
  }
  if (shipment.completedAt) {
    events.push({ time: shipment.completedAt, type: "STATUS", title: "Completed" });
  }

  events.sort((a, b) => a.time.getTime() - b.time.getTime());
  return { shipment: { id: shipment.id, trackingNumber: shipment.trackingNumber, status: shipment.status }, events };
}
