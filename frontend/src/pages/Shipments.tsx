import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle, Truck, Clock } from "lucide-react";
import { getShipments } from "@/services";
import type { Shipment } from "@/types";
import {
  PageHeader, Card, Table, Th, Td, Badge, PageLoader, ErrorMessage, EmptyState, StatusDot,
} from "@/components/common";
import { shipmentStatusColor, shipmentStatusLabel, formatDate, timeAgo, cn, slaMinutesLabel, minutesToHuman } from "@/utils";

function RiskIndicator({ shipment }: { shipment: Shipment }) {
  // If there's an active risk event, show it
  const activeRisk = shipment.slaEvents?.find(e => e.isActive);
  if (activeRisk) {
    if (activeRisk.riskLevel === "CRITICAL" || activeRisk.riskLevel === "HIGH") {
      return <Badge className="bg-red-100 text-red-700">High Risk</Badge>;
    }
    return <Badge className="bg-orange-100 text-orange-700">Med Risk</Badge>;
  }

  // Fallback to shipment status or ETA projection
  const eta = shipment.etaSnapshots?.[0];
  if (shipment.status === "AT_RISK") return <Badge className="bg-red-100 text-red-700">At Risk</Badge>;
  if (shipment.status === "DELAYED") return <Badge className="bg-amber-100 text-amber-700">Delayed</Badge>;
  if (eta && !eta.onTrack) return <Badge className="bg-orange-100 text-orange-700">At Risk</Badge>;
  
  if (["DELIVERED", "COMPLETED"].includes(shipment.status)) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return <Badge className="bg-emerald-100 text-emerald-700">Low Risk</Badge>;
}

export function Shipments() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("ALL");
  const navigate = useNavigate();

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      setShipments(await getShipments());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load shipments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const FILTERS = ["ALL", "IN_TRANSIT", "AT_RISK", "DELAYED", "DELIVERED", "COMPLETED"];
  const filtered = filter === "ALL" ? shipments : shipments.filter((s) => s.status === filter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipments"
        subtitle="Track all active and historical shipments"
      />

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 bg-white border border-slate-200 p-1 rounded-xl w-fit shadow-sm">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200",
              filter === f 
                ? "bg-slate-100 text-slate-900 shadow-sm" 
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            )}
          >
            {f === "ALL" ? "All" : shipmentStatusLabel(f as Shipment["status"])}
            {f !== "ALL" && (
              <span className={cn("ml-1.5 px-1.5 py-0.5 rounded-md text-[10px]", filter === f ? "bg-slate-200 text-slate-700" : "bg-slate-100 text-slate-400")}>
                {shipments.filter((s) => s.status === f).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <Card>
        {loading ? (
          <PageLoader />
        ) : error ? (
          <ErrorMessage message={error} onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No shipments found" description="Shipments will appear here once created" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Tracking #</Th>
                <Th>Route</Th>
                <Th>Transporter & Vehicle</Th>
                <Th>Status</Th>
                <Th>Risk</Th>
                <Th>ETA</Th>
                <Th>SLA Deadline</Th>
                <Th>Last Update</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const eta = s.etaSnapshots?.[0];
                const active = ["DISPATCHED", "IN_TRANSIT", "DELAYED", "AT_RISK"].includes(s.status);
                
                return (
                  <tr
                    key={s.id}
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors group"
                    onClick={() => navigate(`/shipments/${s.id}`)}
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        {active && <StatusDot color={s.status === "AT_RISK" || s.status === "DELAYED" ? "amber" : "blue"} pulse />}
                        <span className="font-mono text-xs font-bold text-indigo-700 group-hover:text-indigo-800">{s.trackingNumber}</span>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="font-semibold text-slate-800">{s.originCity}</span>
                        <span className="text-slate-300">→</span>
                        <span className="font-semibold text-slate-800">{s.destinationCity}</span>
                      </div>
                    </Td>
                    <Td>
                      <p className="text-sm font-medium text-slate-800">{s.transporter?.name ?? "—"}</p>
                      <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-500">
                        <Truck className="w-3 h-3" />
                        <span className="font-mono">{s.vehicle?.vehicleNumber ?? "—"}</span>
                      </div>
                    </Td>
                    <Td>
                      <Badge className={shipmentStatusColor(s.status)}>
                        {shipmentStatusLabel(s.status)}
                      </Badge>
                    </Td>
                    <Td>
                      <RiskIndicator shipment={s} />
                    </Td>
                    <Td>
                      {eta ? (
                        <div>
                          <p className="text-sm font-medium text-slate-800">{formatDate(eta.estimatedArrival)}</p>
                          {eta.minutesToEta !== undefined && (
                            <p className="text-[11px] text-slate-500 mt-0.5">{minutesToHuman(eta.minutesToEta)} away</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </Td>
                    <Td>
                      <p className="text-sm text-slate-800">{formatDate(s.slaDeadline)}</p>
                      {s.sla && s.sla.isBreached && (
                        <p className="text-[11px] text-red-600 font-bold mt-0.5">BREACHED</p>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-500 font-medium">{timeAgo(s.updatedAt)}</Td>
                    <Td>
                      <span className="text-xs text-indigo-600 font-bold group-hover:underline">View</span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
