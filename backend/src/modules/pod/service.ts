import { z } from "zod";
import { prisma } from "../../db/client";
import { NotFoundError, BusinessRuleError } from "../../shared/errors";
import { PODStatus, PODVerificationMethod } from "../../../generated/prisma/client";
import { isEligibleForDeliveryConfirmation, deriveDeliveryOutcome } from "./rules";

export const ReviewPODSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reviewedById: z.string().min(1),
  rejectionReason: z.string().optional(),
});

export type ReviewPODInput = z.infer<typeof ReviewPODSchema>;

// Derived, not stored — reconstructed from what's already on the record so
// it can never drift from the fields it's describing.
export type PODVerificationStatus = "PENDING" | "VERIFIED";

function deriveVerificationStatus(pod: { submittedAt: Date | null }): PODVerificationStatus {
  return pod.submittedAt ? "VERIFIED" : "PENDING";
}

export async function getPOD(shipmentId: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new NotFoundError("Shipment", shipmentId);

  const pod = await prisma.pOD.findUnique({
    where: { shipmentId },
    include: {
      reviewedBy: { select: { id: true, name: true } },
    },
  });
  if (!pod) throw new NotFoundError("POD", shipmentId);

  // Never expose the OTP hash or the raw QR token through the manager-facing endpoint.
  const { otpHash: _otpHash, qrToken: _qrToken, ...safePod } = pod;
  return { ...safePod, verificationStatus: deriveVerificationStatus(pod) };
}

export async function reviewPOD(shipmentId: string, input: ReviewPODInput) {
  const pod = await prisma.pOD.findUnique({ where: { shipmentId } });
  if (!pod) throw new NotFoundError("POD", shipmentId);
  if (pod.status !== PODStatus.SUBMITTED) {
    throw new BusinessRuleError("Only a submitted POD can be reviewed");
  }
  if (input.action === "REJECT" && !input.rejectionReason) {
    throw new BusinessRuleError("Rejection reason is required");
  }

  const reviewer = await prisma.user.findUnique({ where: { id: input.reviewedById } });
  if (!reviewer) throw new NotFoundError("User", input.reviewedById);

  const newStatus = input.action === "APPROVE" ? PODStatus.APPROVED : PODStatus.REJECTED;

  return prisma.pOD.update({
    where: { shipmentId },
    data: {
      status: newStatus,
      reviewedById: input.reviewedById,
      reviewedAt: new Date(),
      rejectionReason: input.action === "REJECT" ? input.rejectionReason : null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// QR-BASED DIGITAL POD — receiver-facing delivery confirmation.
//
// Driver reaches destination → shipment-specific QR (embeds POD.qrToken)
// → receiver scans it and opens the confirmation page, which shows the
// shipment's pre-mapped delivery details → receiver completes a Delivery
// Inspection & Acceptance (quantity received vs. expected, packaging
// condition, product condition, cold-chain temperature check, optional
// remarks) and submits → POD is registered (SUBMITTED) with receiver/
// facility info pulled from the shipment's destination facility. An issue
// raised during inspection is recorded as an exception on the POD, not
// treated as an automatic failure — it still reaches SUBMITTED and goes to
// the manager for review. No signature, no OTP.
// ─────────────────────────────────────────────────────────────────────────

export const ConfirmDeliverySchema = z.object({
  receivedQuantityKg: z.number().positive(),
  isPartialDelivery: z.boolean(),
  packagingDamaged: z.boolean(),
  productIssueObserved: z.boolean(),
  // Omitted/undefined for non-cold-chain shipments, where it's never asked.
  temperatureExcursion: z.boolean().optional(),
  remarks: z.string().optional(),
});

export type ConfirmDeliveryInput = z.infer<typeof ConfirmDeliverySchema>;

/** Public, receiver-facing view of a shipment by its POD QR token. */
export async function getPublicDeliveryInfo(token: string) {
  const pod = await prisma.pOD.findUnique({
    where: { qrToken: token },
    include: {
      shipment: {
        include: {
          originFacility: true,
          destinationFacility: true,
          requirement: { select: { productType: true, weightKg: true, coldChainRequired: true } },
        },
      },
    },
  });
  if (!pod) throw new NotFoundError("POD", token);

  const { shipment } = pod;
  return {
    trackingNumber: shipment.trackingNumber,
    originName: shipment.originFacility?.name ?? shipment.originCity,
    destinationName: shipment.destinationFacility?.name ?? shipment.destinationCity,
    productType: shipment.requirement?.productType ?? null,
    expectedQuantityKg: shipment.requirement?.weightKg ?? null,
    coldChainRequired: shipment.requirement?.coldChainRequired ?? false,
    alreadyConfirmed: pod.status !== PODStatus.PENDING,
    podStatus: pod.status,
  };
}

/**
 * Receiver completes the Delivery Inspection & Acceptance form and submits.
 * Idempotent — once the POD has moved past PENDING (by this call or a
 * manager review), repeated confirmations are a no-op returning the
 * existing record rather than erroring or creating a second submission.
 */
export async function confirmDelivery(token: string, input: ConfirmDeliveryInput) {
  const pod = await prisma.pOD.findUnique({
    where: { qrToken: token },
    include: { shipment: { include: { destinationFacility: true } } },
  });
  if (!pod) throw new NotFoundError("POD", token);

  if (pod.status !== PODStatus.PENDING) {
    return pod;
  }

  const { shipment } = pod;
  if (!isEligibleForDeliveryConfirmation(shipment.status)) {
    throw new BusinessRuleError("This shipment is not yet ready for delivery confirmation.");
  }

  const destinationFacility = shipment.destinationFacility;
  const receiverOrganization = destinationFacility?.organizationName ?? destinationFacility?.name ?? shipment.destinationCity;

  const { condition, hasException } = deriveDeliveryOutcome({
    packagingDamaged: input.packagingDamaged,
    productIssueObserved: input.productIssueObserved,
    temperatureExcursion: input.temperatureExcursion ?? null,
    isPartialDelivery: input.isPartialDelivery,
  });

  return prisma.pOD.update({
    where: { qrToken: token },
    data: {
      receiverOrganization,
      deliveredQuantityKg: input.receivedQuantityKg,
      condition,
      packagingDamaged: input.packagingDamaged,
      productIssueObserved: input.productIssueObserved,
      temperatureExcursion: input.temperatureExcursion ?? null,
      hasException,
      notes: input.remarks,
      deliveryLat: shipment.destinationLat,
      deliveryLng: shipment.destinationLng,
      verificationMethod: PODVerificationMethod.QR_CONFIRMATION,
      status: PODStatus.SUBMITTED,
      submittedAt: new Date(),
    },
  });
}
