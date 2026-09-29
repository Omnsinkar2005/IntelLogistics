import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../../db/client";
import { NotFoundError, BusinessRuleError } from "../../shared/errors";
import { RequirementStatus, OfferStatus, FacilityType } from "../../../generated/prisma/client";
import { getMatchingTransporters } from "../matching/service";

/** Shipment-specific, transporter-specific one-time quotation link token. */
function generateQuoteToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

// Fields required to send a requirement for quotation. Optional at the
// zod-object level (a Draft can omit all of them) and re-checked by
// `requireCompleteForSend` below whenever the caller isn't saving a draft.
const REQUIRED_FOR_SEND = [
  "originFacilityId",
  "destinationFacilityId",
  "productType",
  "weightKg",
  "maxCostInr",
  "slaDeadline",
] as const;

const RequirementFieldsSchema = z.object({
  originFacilityId: z.string().min(1).optional(),
  destinationFacilityId: z.string().min(1).optional(),
  productType: z.string().min(1).optional(),
  productDescription: z.string().optional(),
  weightKg: z.number().positive().optional(),
  volumeCbm: z.number().positive().optional(),
  coldChainRequired: z.boolean().default(false),
  tempMinCelsius: z.number().optional(),
  tempMaxCelsius: z.number().optional(),
  maxCostInr: z.number().positive().optional(),
  slaDeadline: z.string().datetime().optional(),
  specialInstructions: z.string().optional(),
});

// `saveAsDraft: true` bypasses the "required for send" check entirely — an
// incomplete form can always be saved as a Draft. Omitted/false means the
// caller wants the requirement to become Ready to Send, which requires a
// complete form (mirrors the old always-required behavior).
function requireCompleteForSend(
  data: z.infer<typeof RequirementFieldsSchema> & { saveAsDraft?: boolean },
  ctx: z.RefinementCtx
) {
  if (data.saveAsDraft) return;
  for (const key of REQUIRED_FOR_SEND) {
    if (data[key] === undefined) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "Required to mark this requirement Ready to Send",
      });
    }
  }
}

export const CreateRequirementSchema = RequirementFieldsSchema.extend({
  companyId: z.string().min(1),
  createdById: z.string().min(1),
  saveAsDraft: z.boolean().default(false),
}).superRefine(requireCompleteForSend);

export type CreateRequirementInput = z.infer<typeof CreateRequirementSchema>;

// Same fields as create, minus the immutable companyId/createdById — used
// to edit a Draft or Ready to Send requirement (see `updateRequirement`).
export const UpdateRequirementSchema = RequirementFieldsSchema.extend({
  saveAsDraft: z.boolean().default(false),
}).superRefine(requireCompleteForSend);

export type UpdateRequirementInput = z.infer<typeof UpdateRequirementSchema>;

/**
 * Next "REQ-{year}-NNNN" number. Derived from the highest existing number
 * with this prefix, not from a total row count — the table also holds
 * non-"REQ-" rows (historical KPI-seed shipments' requirements, demo
 * requirements) and rows get deleted (demo reset), so `count() + 1` can
 * land on a number that's already taken.
 */
async function nextReferenceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `REQ-${year}-`;
  const latest = await prisma.transportRequirement.findFirst({
    where: { referenceNumber: { startsWith: prefix } },
    orderBy: { referenceNumber: "desc" },
    select: { referenceNumber: true },
  });
  const lastSeq = latest ? parseInt(latest.referenceNumber.slice(prefix.length), 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, "0")}`;
}

/**
 * Looks up and validates the origin/destination facilities for a
 * create/update payload. Both are optional (a Draft may not have picked a
 * route yet) — each is only looked up when its id is present, and the
 * "different facilities" rule only applies once both are known.
 */
async function resolveFacilities(input: {
  originFacilityId?: string;
  destinationFacilityId?: string;
}) {
  const [origin, destination] = await Promise.all([
    input.originFacilityId
      ? prisma.facility.findUnique({ where: { id: input.originFacilityId } })
      : Promise.resolve(null),
    input.destinationFacilityId
      ? prisma.facility.findUnique({ where: { id: input.destinationFacilityId } })
      : Promise.resolve(null),
  ]);
  if (input.originFacilityId && !origin) throw new NotFoundError("Facility", input.originFacilityId);
  if (input.destinationFacilityId && !destination) {
    throw new NotFoundError("Facility", input.destinationFacilityId);
  }
  if (origin && origin.type !== FacilityType.CWH) {
    throw new BusinessRuleError("Origin must be a CWH facility");
  }
  if (destination && destination.type !== FacilityType.DESTINATION) {
    throw new BusinessRuleError("Destination must be an exact destination facility");
  }
  if (origin && destination && origin.id === destination.id) {
    throw new BusinessRuleError("Origin and destination must be different facilities");
  }
  return { origin, destination };
}

export async function createRequirement(input: CreateRequirementInput) {
  const { origin, destination } = await resolveFacilities(input);

  const referenceNumber = await nextReferenceNumber();
  return prisma.transportRequirement.create({
    data: {
      companyId: input.companyId,
      createdById: input.createdById,
      referenceNumber,
      originFacilityId: origin?.id,
      originCity: origin?.city,
      originState: origin?.state,
      originLat: origin?.lat,
      originLng: origin?.lng,
      destinationFacilityId: destination?.id,
      destinationCity: destination?.city,
      destinationState: destination?.state,
      destinationLat: destination?.lat,
      destinationLng: destination?.lng,
      productType: input.productType,
      productDescription: input.productDescription,
      weightKg: input.weightKg,
      volumeCbm: input.volumeCbm,
      coldChainRequired: input.coldChainRequired,
      tempMinCelsius: input.tempMinCelsius,
      tempMaxCelsius: input.tempMaxCelsius,
      maxCostInr: input.maxCostInr,
      slaDeadline: input.slaDeadline ? new Date(input.slaDeadline) : undefined,
      specialInstructions: input.specialInstructions,
      // A complete form is never auto-sent for quotation — it only becomes
      // Ready to Send. Sending is a separate, explicit action (see
      // updateRequirementStatus, DRAFT/READY_TO_SEND -> OPEN).
      status: input.saveAsDraft ? RequirementStatus.DRAFT : RequirementStatus.READY_TO_SEND,
    },
    include: { company: true, createdBy: true, originFacility: true, destinationFacility: true },
  });
}

/**
 * Edits a requirement's own fields (route, cargo, cost, SLA, etc.) — used to
 * complete a Draft or to fix up a Ready to Send requirement before it's
 * sent. Once a requirement has been sent (OPEN or later) its field data is
 * frozen; use `updateRequirementStatus` for status-only transitions from
 * that point on.
 */
export async function updateRequirement(id: string, input: UpdateRequirementInput) {
  const existing = await prisma.transportRequirement.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("TransportRequirement", id);
  if (existing.status !== RequirementStatus.DRAFT && existing.status !== RequirementStatus.READY_TO_SEND) {
    throw new BusinessRuleError(
      `Cannot edit a requirement once it has been sent for quotation (current status: ${existing.status})`
    );
  }

  const { origin, destination } = await resolveFacilities(input);

  return prisma.transportRequirement.update({
    where: { id },
    data: {
      originFacilityId: origin?.id,
      originCity: origin?.city,
      originState: origin?.state,
      originLat: origin?.lat,
      originLng: origin?.lng,
      destinationFacilityId: destination?.id,
      destinationCity: destination?.city,
      destinationState: destination?.state,
      destinationLat: destination?.lat,
      destinationLng: destination?.lng,
      productType: input.productType,
      productDescription: input.productDescription,
      weightKg: input.weightKg,
      volumeCbm: input.volumeCbm,
      coldChainRequired: input.coldChainRequired,
      tempMinCelsius: input.tempMinCelsius,
      tempMaxCelsius: input.tempMaxCelsius,
      maxCostInr: input.maxCostInr,
      slaDeadline: input.slaDeadline ? new Date(input.slaDeadline) : undefined,
      specialInstructions: input.specialInstructions,
      status: input.saveAsDraft ? RequirementStatus.DRAFT : RequirementStatus.READY_TO_SEND,
    },
    include: { company: true, createdBy: true, originFacility: true, destinationFacility: true },
  });
}

export async function listRequirements(companyId?: string) {
  return prisma.transportRequirement.findMany({
    where: companyId ? { companyId } : undefined,
    include: {
      company: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      originFacility: true,
      destinationFacility: true,
      // Only count *submitted* quotations here — the relation itself also
      // holds still-PENDING invites (offer rows created at send time,
      // before a transporter has responded), which must not inflate the
      // "Responses: X/Y" numerator on the Requirements list.
      _count: { select: { offers: { where: { status: OfferStatus.SUBMITTED } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getRequirementById(id: string) {
  const req = await prisma.transportRequirement.findUnique({
    where: { id },
    include: {
      company: true,
      createdBy: { select: { id: true, name: true, email: true } },
      originFacility: true,
      destinationFacility: true,
      offers: {
        include: {
          transporter: { select: { id: true, name: true, city: true } },
        },
      },
      shipment: { select: { id: true, trackingNumber: true, status: true } },
    },
  });
  if (!req) throw new NotFoundError("TransportRequirement", id);
  return req;
}

export const STATUS_TRANSITIONS: Record<RequirementStatus, RequirementStatus[]> = {
  DRAFT: [RequirementStatus.READY_TO_SEND, RequirementStatus.CANCELLED],
  READY_TO_SEND: [RequirementStatus.OPEN, RequirementStatus.DRAFT, RequirementStatus.CANCELLED],
  OPEN: [RequirementStatus.MATCHED, RequirementStatus.CANCELLED],
  MATCHED: [RequirementStatus.ASSIGNED, RequirementStatus.OPEN, RequirementStatus.CANCELLED],
  ASSIGNED: [],
  CANCELLED: [],
};

export async function updateRequirementStatus(id: string, status: RequirementStatus) {
  const req = await prisma.transportRequirement.findUnique({ where: { id } });
  if (!req) throw new NotFoundError("TransportRequirement", id);

  if (!STATUS_TRANSITIONS[req.status].includes(status)) {
    throw new BusinessRuleError(`Cannot transition requirement from ${req.status} to ${status}`);
  }

  const updated = await prisma.transportRequirement.update({ where: { id }, data: { status } });

  // Sending for quotation ("Send" action, READY_TO_SEND -> OPEN): snapshot
  // how many transporters were eligible at send time, so the Requirements
  // page can show "Responses: {offers submitted}/{this}". Reuses the same
  // matching engine the manual matching page already calls — best-effort,
  // since a snapshot failing shouldn't block the send itself.
  if (status === RequirementStatus.OPEN) {
    try {
      const results = await getMatchingTransporters(id);
      const eligibleCount = results.filter((r) => r.eligibility.eligible).length;
      return await prisma.transportRequirement.update({
        where: { id },
        data: { matchedTransporterCount: eligibleCount },
      });
    } catch {
      return updated;
    }
  }

  return updated;
}

export const SendForQuotationSchema = z.object({
  transporterIds: z.array(z.string().min(1)).min(1, "Select at least one transporter"),
  quotationDeadline: z.string().datetime(),
});

export type SendForQuotationInput = z.infer<typeof SendForQuotationSchema>;

/**
 * The actual "send" action: the manager picks specific transporters and a
 * quotation deadline, the requirement moves Ready to Send -> Sent for
 * Quotation, and a one-time quotation-link offer row is created per
 * selected transporter. This replaces the old shortcut where a
 * system-computed cost estimate was shown as if it were a real quote the
 * instant the requirement existed — from here on, a real quote only exists
 * once a transporter submits one via their link (see
 * modules/quotation/service.ts submitQuotation).
 *
 * Idempotent once already sent — same pattern as confirmDelivery/
 * submitQuotation. The Transporter Matching page only renders the send
 * form while status is READY_TO_SEND, so the only way this fires against
 * an already-OPEN requirement is a duplicate in-flight request (e.g. a
 * double-click on the send button); that repeat call returns the
 * already-sent requirement rather than a 422, since the send it's
 * reporting on did in fact succeed. A requirement in any other status
 * (DRAFT, MATCHED, ASSIGNED, CANCELLED) is still a genuine invalid
 * transition and still throws.
 */
export async function sendForQuotation(id: string, input: SendForQuotationInput) {
  const req = await prisma.transportRequirement.findUnique({ where: { id } });
  if (!req) throw new NotFoundError("TransportRequirement", id);
  if (req.status === RequirementStatus.OPEN) {
    return getRequirementById(id);
  }
  if (req.status !== RequirementStatus.READY_TO_SEND) {
    throw new BusinessRuleError(
      `Only a Ready to Send requirement can be sent for quotation (current status: ${req.status})`
    );
  }

  const deadline = new Date(input.quotationDeadline);
  if (deadline.getTime() <= Date.now()) {
    throw new BusinessRuleError("Quotation deadline must be in the future");
  }

  const transporters = await prisma.transporter.findMany({
    where: { id: { in: input.transporterIds }, isActive: true },
  });
  if (transporters.length !== input.transporterIds.length) {
    throw new BusinessRuleError("One or more selected transporters could not be found or are inactive");
  }

  // Reuses the existing transition-table validation/status write.
  await updateRequirementStatus(id, RequirementStatus.OPEN);

  await prisma.$transaction([
    prisma.transportRequirement.update({
      where: { id },
      data: {
        quotationDeadline: deadline,
        // Overwrite the legacy eligibility-based snapshot from
        // updateRequirementStatus with the real number actually sent to.
        matchedTransporterCount: transporters.length,
      },
    }),
    // One offer row per selected transporter — the quotation "invite" that
    // holds their one-time link token. A transporter already invited for
    // this requirement (e.g. a resend) keeps their existing token/status
    // untouched rather than being overwritten, so an already-opened or
    // already-submitted link is never invalidated by a resend.
    ...transporters.map((t) =>
      prisma.transporterOffer.upsert({
        where: { requirementId_transporterId: { requirementId: id, transporterId: t.id } },
        update: {},
        create: {
          requirementId: id,
          transporterId: t.id,
          status: OfferStatus.PENDING,
          quoteToken: generateQuoteToken(),
        },
      })
    ),
  ]);

  return getRequirementById(id);
}
