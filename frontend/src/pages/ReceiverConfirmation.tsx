import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { PackageCheck, CheckCircle2, Truck, MapPin, Snowflake, Loader2, AlertCircle, AlertTriangle } from "lucide-react";
import { getPublicDeliveryInfo, confirmDelivery } from "@/services";
import type { PublicDeliveryInfo } from "@/types";

/**
 * Receiver-facing delivery confirmation page, reached by scanning a
 * shipment's QR code (or the shipment/POD screen's "Open Receiver
 * Confirmation" dev link). No login, no signature, no manager/transporter
 * controls — the shipment's pre-mapped delivery details, a Delivery
 * Inspection & Acceptance form, and one submit action. Standalone layout,
 * not the manager dashboard. An issue raised during inspection is recorded
 * as an exception on the POD, not blocked — the receiver can always submit.
 */
export function ReceiverConfirmation() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<PublicDeliveryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const [receivedQuantityKg, setReceivedQuantityKg] = useState("");
  const [packagingDamaged, setPackagingDamaged] = useState<boolean | null>(null);
  const [productIssueObserved, setProductIssueObserved] = useState<boolean | null>(null);
  const [temperatureExcursion, setTemperatureExcursion] = useState<boolean | null>(null);
  const [remarks, setRemarks] = useState("");

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    getPublicDeliveryInfo(token)
      .then((data) => {
        setInfo(data);
        if (data.expectedQuantityKg) setReceivedQuantityKg(data.expectedQuantityKg);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "This delivery link is invalid or has expired."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  const expectedQuantityKg = info?.expectedQuantityKg ? parseFloat(info.expectedQuantityKg) : null;
  const receivedNum = parseFloat(receivedQuantityKg);
  const isPartialDelivery = useMemo(() => {
    if (expectedQuantityKg === null || Number.isNaN(receivedNum)) return false;
    return receivedNum < expectedQuantityKg;
  }, [expectedQuantityKg, receivedNum]);

  const hasIssue = packagingDamaged === true || productIssueObserved === true || temperatureExcursion === true || isPartialDelivery;

  const canSubmit =
    !Number.isNaN(receivedNum) && receivedNum > 0 &&
    packagingDamaged !== null && productIssueObserved !== null &&
    (!info?.coldChainRequired || temperatureExcursion !== null);

  const handleSubmit = async () => {
    if (!token || !canSubmit) return;
    try {
      setSubmitting(true);
      setError(null);
      await confirmDelivery(token, {
        receivedQuantityKg: receivedNum,
        isPartialDelivery,
        packagingDamaged: packagingDamaged!,
        productIssueObserved: productIssueObserved!,
        temperatureExcursion: info?.coldChainRequired ? temperatureExcursion! : undefined,
        remarks: remarks || undefined,
      });
      setJustSubmitted(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to submit delivery confirmation.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white flex items-center justify-center p-5">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto shadow-lg shadow-indigo-600/25 mb-3">
            <Snowflake className="w-7 h-7 text-white" />
          </div>
          <p className="text-sm font-bold text-indigo-900 tracking-wide">Pharma Logistics</p>
          <h1 className="text-xl font-extrabold text-slate-900 mt-1">Delivery Confirmation</h1>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
              <p className="text-sm text-slate-400 font-medium">Loading delivery details…</p>
            </div>
          ) : error && !info ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="w-9 h-9 text-red-400" />
              <p className="text-sm font-semibold text-slate-700">{error}</p>
            </div>
          ) : info ? (
            <>
              <div className="space-y-3 pb-5 border-b border-slate-100">
                <Row label="Shipment" value={info.trackingNumber} mono />
                <Row label="From" value={info.originName} icon={<Truck className="w-3.5 h-3.5" />} />
                <Row label="To" value={info.destinationName} icon={<MapPin className="w-3.5 h-3.5" />} />
                {info.productType && <Row label="Product" value={info.productType} icon={<PackageCheck className="w-3.5 h-3.5" />} />}
                {info.expectedQuantityKg && (
                  <Row label="Expected Quantity" value={`${parseFloat(info.expectedQuantityKg).toLocaleString("en-IN")} kg`} />
                )}
              </div>

              {justSubmitted || info.alreadyConfirmed ? (
                <div className="flex flex-col items-center gap-2 text-center py-6">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  <p className="font-bold text-slate-900">Digital POD submitted successfully.</p>
                  <p className="text-sm text-slate-500">
                    POD has been registered and sent for manager approval.
                  </p>
                </div>
              ) : (
                <div className="pt-5 space-y-5">
                  <p className="text-sm font-bold text-slate-800">Delivery Inspection & Acceptance</p>

                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Received Quantity (kg)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={receivedQuantityKg}
                      onChange={(e) => setReceivedQuantityKg(e.target.value)}
                      placeholder="e.g., 500"
                      className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 outline-none transition-colors"
                    />
                    {expectedQuantityKg !== null && !Number.isNaN(receivedNum) && receivedNum > 0 && (
                      <p className={`text-xs font-semibold mt-1.5 ${isPartialDelivery ? "text-amber-600" : "text-emerald-600"}`}>
                        {isPartialDelivery ? "Partial Delivery" : "Full Delivery"}
                      </p>
                    )}
                  </div>

                  <ToggleField
                    label="Packaging Condition"
                    value={packagingDamaged}
                    trueLabel="Damaged"
                    falseLabel="Intact"
                    onChange={setPackagingDamaged}
                  />

                  <ToggleField
                    label="Product Condition"
                    value={productIssueObserved}
                    trueLabel="Issue Observed"
                    falseLabel="No Visible Issue"
                    onChange={setProductIssueObserved}
                  />

                  {info.coldChainRequired && (
                    <ToggleField
                      label="Cold-Chain Temperature Check"
                      value={temperatureExcursion}
                      trueLabel="Excursion"
                      falseLabel="Within Range"
                      onChange={setTemperatureExcursion}
                    />
                  )}

                  <div>
                    <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Remarks (optional)</label>
                    <textarea
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      rows={2}
                      placeholder="Any notes about this delivery..."
                      className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 outline-none transition-colors resize-none"
                    />
                  </div>

                  {hasIssue && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs font-semibold text-amber-800">
                        This delivery will be recorded as an exception for manager review — it will not block your submission.
                      </p>
                    </div>
                  )}

                  {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

                  <button
                    onClick={handleSubmit}
                    disabled={submitting || !canSubmit}
                    className="w-full py-3.5 rounded-xl bg-emerald-600 text-white font-bold text-sm tracking-wide shadow-md shadow-emerald-600/25 hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    SUBMIT DIGITAL POD
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-5">
          Proof-of-delivery confirmation — no login required.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, icon, mono }: { label: string; value: string; icon?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
        {icon}{label}
      </span>
      <span className={mono ? "text-sm font-mono font-bold text-slate-800" : "text-sm font-semibold text-slate-800 text-right"}>
        {value}
      </span>
    </div>
  );
}

function ToggleField({
  label, value, trueLabel, falseLabel, onChange,
}: {
  label: string;
  value: boolean | null;
  trueLabel: string;
  falseLabel: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 mb-1.5 block">{label}</label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`py-2 rounded-lg text-xs font-bold border transition-colors ${
            value === false
              ? "bg-emerald-600 border-emerald-600 text-white"
              : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
          }`}
        >
          {falseLabel}
        </button>
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`py-2 rounded-lg text-xs font-bold border transition-colors ${
            value === true
              ? "bg-amber-500 border-amber-500 text-white"
              : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
          }`}
        >
          {trueLabel}
        </button>
      </div>
    </div>
  );
}
