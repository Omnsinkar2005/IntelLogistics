import { z } from "zod";
import { prisma } from "../../db/client";
import { NotFoundError, BusinessRuleError } from "../../shared/errors";
import { OfferStatus, RequirementStatus } from "../../../generated/prisma/client";
import { isQuotationWindowOpen } from "./rules";

export const SubmitQuotationSchema = z.object({
  quotedPriceInr: z.number().positive(),
  remarks: z.string().optional(),
});

export type SubmitQuotationInput = z.infer<typeof SubmitQuotationSchema>;

// ─────────────────────────────────────────────────────────────────────────
// ONE-TIME QUOTATION LINK — transporter-facing, no login.
//
// Company Manager selects transporters + a quotation deadline and sends
// the requirement for quotation (requirements/service.ts sendForQuotation)
// -> each selected transporter gets a shipment-specific, transporter-
// specific one-time link (POC stand-in for an emailed link — see the
// quoteToken doc-comment on TransporterOffer in schema.prisma) -> the
// transporter opens it, reviews the requirement, and submits a quoted
// price -> the quotation is recorded and the manager can see it on the
// requirement. Opening the link never mutates anything; only a successful
// submission consumes it.
// ─────────────────────────────────────────────────────────────────────────

async function findOfferByToken(token: string) {
  const offer = await prisma.transporterOffer.findUnique({
    where: { quoteToken: token },
    include: {
      requirement: true,
      transporter: { select: { id: true, name: true } },
    },
  });
  if (!offer) throw new NotFoundError("TransporterOffer", token);
  return offer;
}

/**
 * Public, transporter-facing view of a requirement by its one-time quote
 * token. Never echoes the token itself. Includes the requirement's Maximum
 * Approved Cost — shown to the transporter alongside the other shipment
 * requirements per explicit product direction.
 */
export async function getPublicQuotationInfo(token: string) {
  const offer = await findOfferByToken(token);
  const { requirement } = offer;

  return {
    transporterName: offer.transporter.name,
    referenceNumber: requirement.referenceNumber,
    originCity: requirement.originCity,
    originState: requirement.originState,
    destinationCity: requirement.destinationCity,
    destinationState: requirement.destinationState,
    productType: requirement.productType,
    weightKg: requirement.weightKg,
    volumeCbm: requirement.volumeCbm,
    coldChainRequired: requirement.coldChainRequired,
    tempMinCelsius: requirement.tempMinCelsius,
    tempMaxCelsius: requirement.tempMaxCelsius,
    maxCostInr: requirement.maxCostInr,
    slaDeadline: requirement.slaDeadline,
    specialInstructions: requirement.specialInstructions,
    quotationDeadline: requirement.quotationDeadline,
    offerStatus: offer.status,
    alreadySubmitted: offer.status !== OfferStatus.PENDING,
    quotationWindowOpen: isQuotationWindowOpen(offer.status, requirement.quotationDeadline),
    submittedQuotedCostInr: offer.quotedCostInr,
    submittedRemarks: offer.notes,
    submittedAt: offer.submittedAt,
  };
}

/**
 * Transporter enters a quoted price (+ optional remarks) and submits.
 * Idempotent — once the offer has moved past PENDING (by this call),
 * a repeated POST to the same link is a no-op that returns the existing
 * submitted quote rather than erroring or overwriting it. Opening the link
 * (getPublicQuotationInfo, a pure read) never triggers this in the first
 * place, so only a successful submission can ever consume it.
 */
export async function submitQuotation(token: string, input: SubmitQuotationInput) {
  const offer = await findOfferByToken(token);

  if (offer.status !== OfferStatus.PENDING) {
    return {
      status: offer.status,
      quotedCostInr: offer.quotedCostInr,
      notes: offer.notes,
      submittedAt: offer.submittedAt,
    };
  }

  if (!isQuotationWindowOpen(offer.status, offer.requirement.quotationDeadline)) {
    throw new BusinessRuleError("The quotation deadline for this requirement has passed.");
  }

  const updated = await prisma.transporterOffer.update({
    where: { quoteToken: token },
    data: {
      quotedCostInr: input.quotedPriceInr,
      notes: input.remarks,
      status: OfferStatus.SUBMITTED,
      submittedAt: new Date(),
    },
  });

  // First quote in -> "Sent for Quotation" becomes "Quotations Received".
  // This is the real trigger the old shortcut faked: MATCHED now means a
  // transporter has actually responded, not merely that the matching
  // engine found them route/vehicle-eligible.
  if (offer.requirement.status === RequirementStatus.OPEN) {
    await prisma.transportRequirement.update({
      where: { id: offer.requirementId },
      data: { status: RequirementStatus.MATCHED },
    });
  }

  return {
    status: updated.status,
    quotedCostInr: updated.quotedCostInr,
    notes: updated.notes,
    submittedAt: updated.submittedAt,
  };
}
