import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { FileText, Truck, MapPin, Package, Snowflake, Clock, Loader2, AlertCircle, CheckCircle2, IndianRupee } from "lucide-react";
import { getPublicQuotationInfo, submitQuotation } from "@/services";
import type { PublicQuotationInfo } from "@/types";
import { formatINR, formatDate } from "@/utils";

/**
 * Transporter-facing quotation page, reached via a shipment-specific,
 * transporter-specific one-time link (POC stand-in for an emailed link —
 * see requirements/service.ts sendForQuotation). Intentionally minimal: no
 * login, no manager controls — just the requirement details a transporter
 * needs to quote against, a price + remarks form, and one submit action.
 * Standalone layout, not the manager dashboard. Opening this page never
 * consumes the link; only a successful submission does.
 */
export function TransporterQuoteSubmission() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<PublicQuotationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [price, setPrice] = useState("");
  const [remarks, setRemarks] = useState("");

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    getPublicQuotationInfo(token)
      .then(setInfo)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "This quotation link is invalid or has expired."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const quotedPriceInr = Number(price);
    if (!quotedPriceInr || quotedPriceInr <= 0) {
      setError("Enter a valid quoted price.");
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      await submitQuotation(token, { quotedPriceInr, remarks: remarks || undefined });
      setJustSubmitted(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to submit quotation.");
    } finally {
      setSubmitting(false);
    }
  };

  const alreadyDone = justSubmitted || info?.alreadySubmitted;
  const windowClosed = !!info && !info.quotationWindowOpen && !alreadyDone;

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white flex items-center justify-center p-5">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto shadow-lg shadow-indigo-600/25 mb-3">
            <Truck className="w-7 h-7 text-white" />
          </div>
          <p className="text-sm font-bold text-indigo-900 tracking-wide">Pharma Logistics</p>
          <h1 className="text-xl font-extrabold text-slate-900 mt-1">Transport Quotation Request</h1>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
              <p className="text-sm text-slate-400 font-medium">Loading requirement details…</p>
            </div>
          ) : error && !info ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="w-9 h-9 text-red-400" />
              <p className="text-sm font-semibold text-slate-700">{error}</p>
            </div>
          ) : info ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{info.referenceNumber}</span>
                <span className="text-xs font-semibold text-indigo-600">{info.transporterName}</span>
              </div>

              <div className="space-y-3 pb-5 border-b border-slate-100">
                <Row label="Route" icon={<MapPin className="w-3.5 h-3.5" />} value={`${info.originCity ?? "—"} → ${info.destinationCity ?? "—"}`} />
                <Row label="Product" icon={<Package className="w-3.5 h-3.5" />} value={info.productType ?? "—"} />
                <Row label="Weight" value={info.weightKg ? `${parseFloat(info.weightKg).toLocaleString("en-IN")} kg` : "—"} />
                {info.volumeCbm && <Row label="Volume" value={`${info.volumeCbm} cbm`} />}
                <Row
                  label="Cold Chain"
                  icon={<Snowflake className="w-3.5 h-3.5" />}
                  value={info.coldChainRequired ? `${info.tempMinCelsius}°C – ${info.tempMaxCelsius}°C` : "Not required"}
                />
                <Row label="SLA Deadline" icon={<Clock className="w-3.5 h-3.5" />} value={info.slaDeadline ? formatDate(info.slaDeadline) : "—"} />
                <Row
                  label="Maximum Approved Cost"
                  icon={<IndianRupee className="w-3.5 h-3.5" />}
                  value={info.maxCostInr ? formatINR(info.maxCostInr) : "—"}
                  emphasis
                />
                {info.specialInstructions && (
                  <Row label="Special Instructions" icon={<FileText className="w-3.5 h-3.5" />} value={info.specialInstructions} />
                )}
                <Row
                  label="Quotation Deadline"
                  icon={<Clock className="w-3.5 h-3.5" />}
                  value={info.quotationDeadline ? formatDate(info.quotationDeadline) : "—"}
                  emphasis
                />
              </div>

              {alreadyDone ? (
                <div className="flex flex-col items-center gap-2 text-center py-6">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  <p className="font-bold text-slate-900">Quotation submitted successfully.</p>
                  {(justSubmitted ? price : info.submittedQuotedCostInr) && (
                    <p className="text-lg font-extrabold text-emerald-700">
                      {formatINR(justSubmitted ? Number(price) : info.submittedQuotedCostInr!)}
                    </p>
                  )}
                  <p className="text-sm text-slate-500">The company manager can now review your quotation.</p>
                </div>
              ) : windowClosed ? (
                <div className="flex flex-col items-center gap-2 text-center py-6">
                  <AlertCircle className="w-10 h-10 text-amber-500" />
                  <p className="font-bold text-slate-900">The quotation window for this requirement has closed.</p>
                  <p className="text-sm text-slate-500">This link can no longer be used to submit a quote.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="pt-5 space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5 mb-1.5">
                      <IndianRupee className="w-3.5 h-3.5" /> Quoted Price (INR)
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="e.g., 62000"
                      className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Remarks (optional)</label>
                    <textarea
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      rows={3}
                      placeholder="Any notes about your quotation..."
                      className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 outline-none transition-colors resize-none"
                    />
                  </div>
                  {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-3.5 rounded-xl bg-indigo-600 text-white font-bold text-sm tracking-wide shadow-md shadow-indigo-600/25 hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    SUBMIT QUOTATION
                  </button>
                </form>
              )}
            </>
          ) : null}
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-5">
          One-time quotation link — no login required.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, icon, emphasis }: { label: string; value: string; icon?: React.ReactNode; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 flex-shrink-0">
        {icon}{label}
      </span>
      <span className={emphasis ? "text-sm font-bold text-amber-700 text-right" : "text-sm font-semibold text-slate-800 text-right"}>
        {value}
      </span>
    </div>
  );
}
