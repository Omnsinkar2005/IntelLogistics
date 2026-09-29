import { OfferStatus } from "../../../generated/prisma/client";

/**
 * A one-time quotation link is still open for a *successful submission*
 * when the offer hasn't already been submitted/withdrawn and the
 * requirement's quotation deadline (if set) hasn't passed. Viewing the
 * link never changes this — only a successful submission does, via the
 * idempotency check in service.ts's submitQuotation.
 */
export function isQuotationWindowOpen(offerStatus: OfferStatus, quotationDeadline: Date | null): boolean {
  if (offerStatus !== OfferStatus.PENDING) return false;
  if (quotationDeadline && Date.now() > quotationDeadline.getTime()) return false;
  return true;
}
