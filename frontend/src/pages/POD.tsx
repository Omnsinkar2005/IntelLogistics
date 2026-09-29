import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CheckCircle, XCircle, Clock, Building,
  MapPin, PackageCheck, QrCode, AlertTriangle, Scale,
} from "lucide-react";
import {
  getPOD, getShipment, reviewPOD, completeShipment, getDefaultManager, getShipments,
} from "@/services";
import type { POD, Shipment, User as UserType } from "@/types";
import {
  Button, Card, CardHeader, CardBody, Badge, Textarea,
  PageLoader, ErrorMessage, EmptyState, Table, Th, Td,
} from "@/components/common";
import { DeliveryQRCard } from "@/components/pod/DeliveryQRCard";
import {
  podStatusColor, podStatusLabel, podConditionColor, podConditionLabel,
  podVerificationMethodLabel, formatDate, cn,
} from "@/utils";

// ─── POD Detail view (when accessed via /pod/:shipmentId) ─────────────────────
export function PODDetail() {
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const navigate = useNavigate();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [pod, setPod] = useState<POD | null>(null);
  const [manager, setManager] = useState<UserType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [completing, setCompleting] = useState(false);

  // Manager review
  const [rejectionReason, setRejectionReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  const load = async () => {
    if (!shipmentId) return;
    try {
      setLoading(true);
      setError(null);
      const [s, p] = await Promise.all([getShipment(shipmentId), getPOD(shipmentId).catch(() => null)]);
      setShipment(s);
      setPod(p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load POD");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [shipmentId]);
  useEffect(() => { getDefaultManager().then(setManager).catch(() => setManager(null)); }, []);

  const handleReview = async (action: "APPROVE" | "REJECT") => {
    if (!shipmentId) return;
    if (action === "REJECT" && !rejectionReason.trim()) { alert("Rejection reason is required"); return; }
    if (!manager) { alert("No manager user is available to record this review."); return; }
    try {
      setWorking(true);
      await reviewPOD(shipmentId, action, manager.id, rejectionReason || undefined);
      await load();
      setShowReject(false);
      setRejectionReason("");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to review POD");
    } finally {
      setWorking(false);
    }
  };

  const handleComplete = async () => {
    if (!shipmentId) return;
    try {
      setCompleting(true);
      await completeShipment(shipmentId);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to complete shipment");
    } finally {
      setCompleting(false);
    }
  };

  if (loading) return <PageLoader />;
  if (error) return <ErrorMessage message={error} onRetry={load} />;
  if (!pod || !shipment) return null;

  const isCompleted = shipment.status === "COMPLETED";

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Proof of Delivery</h1>
          <p className="text-sm font-medium text-slate-500 mt-1">
            <span className="font-mono font-bold text-slate-700">{shipment.trackingNumber}</span>
            {" · "}{shipment.originFacility?.name ?? shipment.originCity} → {shipment.destinationFacility?.name ?? shipment.destinationCity}
          </p>
        </div>
      </div>

      {/* Status banner */}
      <Card className={cn("border-2 shadow-sm animate-fade-in-up", {
        "border-slate-200": pod.status === "PENDING",
        "border-blue-200 bg-blue-50/50": pod.status === "SUBMITTED",
        "border-emerald-200 bg-emerald-50/50": pod.status === "APPROVED",
        "border-red-200 bg-red-50/50": pod.status === "REJECTED",
      })}>
        <CardBody className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={cn("w-12 h-12 rounded-full flex items-center justify-center border-2", {
                "bg-emerald-100 border-emerald-200": pod.status === "APPROVED",
                "bg-red-100 border-red-200": pod.status === "REJECTED",
                "bg-blue-100 border-blue-200": pod.status === "SUBMITTED",
                "bg-slate-100 border-slate-200": pod.status === "PENDING",
              })}>
                {pod.status === "APPROVED" && <CheckCircle className="w-6 h-6 text-emerald-600" />}
                {pod.status === "REJECTED" && <XCircle className="w-6 h-6 text-red-600" />}
                {pod.status === "SUBMITTED" && <Clock className="w-6 h-6 text-blue-600" />}
                {pod.status === "PENDING" && <QrCode className="w-6 h-6 text-slate-400" />}
              </div>
              <div>
                <p className="font-bold text-slate-900 text-lg">
                  {isCompleted ? "Shipment Completed" : "POD Status"}
                </p>
                {isCompleted && <p className="text-sm font-medium text-emerald-700">Delivery confirmed, approved, and shipment closed</p>}
                {!isCompleted && pod.status === "APPROVED" && <p className="text-sm font-medium text-emerald-700">Delivery confirmed and approved — ready to complete the shipment</p>}
                {!isCompleted && pod.status === "REJECTED" && <p className="text-sm font-medium text-red-700">Rejected: {pod.rejectionReason}</p>}
                {!isCompleted && pod.status === "SUBMITTED" && <p className="text-sm font-medium text-blue-700">Receiver confirmed delivery — awaiting manager review</p>}
                {!isCompleted && pod.status === "PENDING" && <p className="text-sm font-medium text-slate-500">Awaiting the receiver to scan the QR and confirm delivery</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pod.hasException && (
                <Badge className="bg-amber-100 text-amber-700 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Exception
                </Badge>
              )}
              <Badge className={podStatusColor(pod.status)}>{podStatusLabel(pod.status)}</Badge>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Awaiting receiver confirmation */}
      {pod.status === "PENDING" && shipment.pod?.qrToken && (
        <DeliveryQRCard qrToken={shipment.pod.qrToken} />
      )}

      {/* POD summary — once the receiver has confirmed */}
      {(pod.status === "SUBMITTED" || pod.status === "APPROVED" || pod.status === "REJECTED") && (
        <Card>
          <CardHeader>
            <h2 className="font-bold text-slate-800">POD Summary</h2>
          </CardHeader>
          <CardBody className="p-6">
            <div className="grid grid-cols-2 gap-y-6 gap-x-8">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Shipment</p>
                <p className="text-sm font-mono font-semibold text-slate-800">{shipment.trackingNumber}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Source</p>
                <p className="text-sm font-semibold text-slate-800">{shipment.originFacility?.name ?? shipment.originCity}</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <Building className="w-4 h-4 text-slate-500" />
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Receiver Organisation</p>
                  <p className="text-sm font-semibold text-slate-800">{pod.receiverOrganization ?? "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-4 h-4 text-slate-500" />
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Destination Facility</p>
                  <p className="text-sm font-bold text-slate-800">{shipment.destinationFacility?.name ?? shipment.destinationCity}</p>
                </div>
              </div>
              <div className="col-span-2">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Destination Address</p>
                <p className="text-sm font-medium text-slate-700">{shipment.destinationFacility?.address ?? "—"}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Condition</p>
                {pod.condition ? <Badge className={podConditionColor(pod.condition)}>{podConditionLabel(pod.condition)}</Badge> : <span className="text-sm text-slate-400">—</span>}
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Verification Method</p>
                <p className="text-sm font-semibold text-slate-800">{pod.verificationMethod ? podVerificationMethodLabel(pod.verificationMethod) : "—"}</p>
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <Clock className="w-4 h-4 text-slate-400" />
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Confirmation Timestamp</p>
                  <p className="text-sm font-medium">{pod.submittedAt ? formatDate(pod.submittedAt) : "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <Scale className="w-4 h-4 text-slate-500" />
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Received Quantity</p>
                  <p className="text-sm font-semibold text-slate-800">{pod.deliveredQuantityKg ? `${parseFloat(pod.deliveredQuantityKg).toLocaleString("en-IN")} kg` : "—"}</p>
                </div>
              </div>
            </div>

            {(pod.packagingDamaged !== null && pod.packagingDamaged !== undefined) && (
              <div className="mt-6 pt-6 border-t border-slate-100">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Delivery Inspection & Acceptance</p>
                <div className="grid grid-cols-3 gap-3">
                  <InspectionResult label="Packaging" isIssue={!!pod.packagingDamaged} issueLabel="Damaged" okLabel="Intact" />
                  <InspectionResult label="Product" isIssue={!!pod.productIssueObserved} issueLabel="Issue Observed" okLabel="No Visible Issue" />
                  {pod.temperatureExcursion !== null && pod.temperatureExcursion !== undefined && (
                    <InspectionResult label="Temperature" isIssue={pod.temperatureExcursion} issueLabel="Excursion" okLabel="Within Range" />
                  )}
                </div>
                {pod.notes && (
                  <div className="mt-4">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Receiver Remarks</p>
                    <p className="text-sm text-slate-700">{pod.notes}</p>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Manager review actions */}
      {pod.status === "SUBMITTED" && (
        <Card className="border-indigo-200 bg-indigo-50/30 shadow-md shadow-indigo-500/5">
          <CardHeader><h2 className="font-bold text-indigo-900">Manager Review</h2></CardHeader>
          <CardBody className="p-6">
            <p className="text-sm font-medium text-indigo-800 mb-1">Review the POD summary above and approve or reject.</p>
            <p className="text-xs text-indigo-600 mb-5">
              {manager ? `Reviewing as ${manager.name}` : "No manager user found — approve/reject will be unavailable."}
            </p>
            {showReject ? (
              <div className="space-y-4">
                <Textarea rows={3} placeholder="Reason for rejection..." value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)} />
                <div className="flex gap-3">
                  <Button variant="danger" loading={working} onClick={() => handleReview("REJECT")}>
                    Confirm Rejection
                  </Button>
                  <Button variant="secondary" onClick={() => setShowReject(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <Button loading={working} disabled={!manager} onClick={() => handleReview("APPROVE")} className="bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20">
                  <CheckCircle className="w-4 h-4" /> Approve POD
                </Button>
                <Button variant="danger" disabled={!manager} onClick={() => setShowReject(true)}>
                  <XCircle className="w-4 h-4" /> Reject
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Complete shipment — once POD approved */}
      {pod.status === "APPROVED" && !isCompleted && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardBody className="p-6 flex items-center justify-between gap-4">
            <div>
              <p className="font-bold text-emerald-900">POD approved</p>
              <p className="text-sm text-emerald-700 mt-0.5">Complete the shipment to close out the delivery lifecycle.</p>
            </div>
            <Button loading={completing} onClick={handleComplete} className="bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20 flex-shrink-0">
              <PackageCheck className="w-4 h-4" /> Complete Shipment
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ─── POD List (all shipments with POD status) ─────────────────────────────────
export function PODList() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const all = await getShipments();
      setShipments(all.filter((s) => s.pod));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load PODs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Proof of Delivery</h1>
        <p className="text-sm font-medium text-slate-500 mt-1">Review and approve digital PODs confirmed by receivers via QR</p>
      </div>

      <Card>
        {loading ? <PageLoader /> : error ? <ErrorMessage message={error} onRetry={load} /> : shipments.length === 0 ? (
          <EmptyState title="No PODs yet" description="PODs will appear here once shipments are dispatched" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Shipment</Th>
                <Th>Route</Th>
                <Th>Transporter</Th>
                <Th>Receiver Organisation</Th>
                <Th>Confirmed</Th>
                <Th>POD Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/80 cursor-pointer transition-colors group" onClick={() => navigate(`/pod/${s.id}`)}>
                  <Td><span className="font-mono text-xs font-bold text-indigo-700 group-hover:text-indigo-800">{s.trackingNumber}</span></Td>
                  <Td>
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="font-semibold text-slate-800">{s.originFacility?.name ?? s.originCity}</span>
                      <span className="text-slate-300">→</span>
                      <span className="font-semibold text-slate-800">{s.destinationFacility?.name ?? s.destinationCity}</span>
                    </div>
                  </Td>
                  <Td><span className="font-medium text-slate-800">{s.transporter?.name ?? "—"}</span></Td>
                  <Td>
                    {s.pod?.receiverOrganization ? (
                      <span className="font-semibold text-slate-800">{s.pod.receiverOrganization}</span>
                    ) : (
                      <span className="text-slate-400 text-xs italic">Not confirmed</span>
                    )}
                  </Td>
                  <Td className="text-xs font-medium text-slate-600">{s.pod?.submittedAt ? formatDate(s.pod.submittedAt) : "—"}</Td>
                  <Td>
                    {s.pod && (
                      <Badge className={podStatusColor(s.pod.status)}>{podStatusLabel(s.pod.status)}</Badge>
                    )}
                  </Td>
                  <Td><span className="text-xs text-indigo-600 font-bold group-hover:underline">Review</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function InspectionResult({ label, isIssue, issueLabel, okLabel }: { label: string; isIssue: boolean; issueLabel: string; okLabel: string }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2", isIssue ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200")}>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
      <p className={cn("text-xs font-bold", isIssue ? "text-amber-700" : "text-emerald-700")}>{isIssue ? issueLabel : okLabel}</p>
    </div>
  );
}
