import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Mail, Truck, MapPin, Package, Snowflake, Clock, Loader2, AlertCircle,
  FileText, ArrowDown, User, Phone,
} from "lucide-react";
import { getPublicAssignmentInfo } from "@/services";
import type { PublicAssignmentInfo } from "@/types";
import { formatDate } from "@/utils";

/**
 * Transporter-facing simulated assignment-notification page, reached via a
 * shipment-specific one-time link (POC stand-in for an emailed "Shipment
 * Assigned" notification — see backend/src/modules/shipments/service.ts
 * getPublicAssignmentInfo). Intentionally minimal: no login, no manager
 * controls — just the email a transporter would have received, and the
 * shipment details it points to. Standalone layout, not the manager
 * dashboard.
 */
export function TransporterAssignmentNotice() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<PublicAssignmentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    getPublicAssignmentInfo(token)
      .then(setInfo)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "This assignment link is invalid or has expired."))
      .finally(() => setLoading(false));
  }, [token]);

  const viewShipmentDetails = () => {
    document.getElementById("shipment-details")?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white flex justify-center p-5 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto shadow-lg shadow-indigo-600/25 mb-3">
            <Truck className="w-7 h-7 text-white" />
          </div>
          <p className="text-sm font-bold text-indigo-900 tracking-wide">Pharma Logistics</p>
          <h1 className="text-xl font-extrabold text-slate-900 mt-1">Shipment Assignment Notification</h1>
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
            <p className="text-sm text-slate-400 font-medium">Loading assignment details…</p>
          </div>
        ) : error || !info ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col items-center gap-3 py-6 text-center">
            <AlertCircle className="w-9 h-9 text-red-400" />
            <p className="text-sm font-semibold text-slate-700">{error}</p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Simulated email */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-slate-50 border-b border-slate-200 px-5 py-3 flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-400" />
                <p className="text-xs font-semibold text-slate-500">Simulated Email Notification</p>
              </div>
              <div className="p-6">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Subject</p>
                <p className="text-base font-extrabold text-slate-900 mb-4">
                  Shipment Assigned - {info.trackingNumber}
                </p>
                <p className="text-sm text-slate-700 leading-relaxed">
                  You have been assigned this shipment by <span className="font-bold">{info.companyName}</span>.
                </p>
                <button
                  onClick={viewShipmentDetails}
                  className="mt-5 w-full py-3.5 rounded-xl bg-indigo-600 text-white font-bold text-sm tracking-wide shadow-md shadow-indigo-600/25 hover:bg-indigo-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  View Shipment Details <ArrowDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Shipment details */}
            <div id="shipment-details" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 scroll-mt-6">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Shipment Details</p>
              <div className="space-y-3">
                <Row label="Shipment ID" value={info.trackingNumber} mono />
                <Row label="Source" value={info.originName} icon={<Truck className="w-3.5 h-3.5" />} />
                <Row label="Destination" value={info.destinationName} icon={<MapPin className="w-3.5 h-3.5" />} />
                {info.productType && <Row label="Product Type" value={info.productType} icon={<Package className="w-3.5 h-3.5" />} />}
                <Row
                  label="Weight / Volume"
                  value={[
                    info.weightKg ? `${parseFloat(info.weightKg).toLocaleString("en-IN")} kg` : null,
                    info.volumeCbm ? `${info.volumeCbm} cbm` : null,
                  ].filter(Boolean).join(" · ") || "—"}
                />
                {info.coldChainRequired && (
                  <Row
                    label="Cold Chain"
                    icon={<Snowflake className="w-3.5 h-3.5" />}
                    value={`${info.tempMinCelsius ?? "—"}°C – ${info.tempMaxCelsius ?? "—"}°C`}
                  />
                )}
                <Row label="SLA / Delivery Deadline" icon={<Clock className="w-3.5 h-3.5" />} value={formatDate(info.slaDeadline)} emphasis />
                {info.specialInstructions && (
                  <Row label="Special Instructions" icon={<FileText className="w-3.5 h-3.5" />} value={info.specialInstructions} />
                )}
                {info.vehicleNumber && <Row label="Assigned Vehicle" value={info.vehicleNumber} mono />}
                {info.driverName && <Row label="Driver Name" icon={<User className="w-3.5 h-3.5" />} value={info.driverName} />}
                {info.driverPhone && <Row label="Driver Phone" icon={<Phone className="w-3.5 h-3.5" />} value={info.driverPhone} />}
              </div>
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-slate-400 mt-5">
          Simulated notification — no real email was sent. No login required.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, icon, mono, emphasis }: { label: string; value: string; icon?: React.ReactNode; mono?: boolean; emphasis?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 flex-shrink-0 pt-0.5">
        {icon}{label}
      </span>
      <span
        className={
          mono
            ? "text-sm font-mono font-bold text-slate-800 text-right"
            : emphasis
              ? "text-sm font-bold text-amber-700 text-right"
              : "text-sm font-semibold text-slate-800 text-right"
        }
      >
        {value}
      </span>
    </div>
  );
}
