import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Snowflake, ArrowRight } from "lucide-react";
import { getRequirements } from "@/services";
import type { TransportRequirement, RequirementStatus } from "@/types";
import {
  PageHeader, Button, Card, Table, Th, Td, Badge,
  PageLoader, ErrorMessage, EmptyState, StatusDot
} from "@/components/common";
import { requirementStatusColor, requirementStatusLabel, requirementResponsesLabel, formatDate, formatINR, cn } from "@/utils";

const FILTER_STATUSES: RequirementStatus[] = [
  "DRAFT", "READY_TO_SEND", "OPEN", "MATCHED", "ASSIGNED", "CANCELLED",
];

export function Requirements() {
  const [reqs, setReqs] = useState<TransportRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RequirementStatus | "ALL">("ALL");
  const navigate = useNavigate();

  const load = async () => {
    try {
      setError(null);
      setReqs(await getRequirements());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load requirements");
    } finally {
      setLoading(false);
    }
  };

  // Background-refresh so response counts (Responses: X/Y) and statuses
  // pick up a transporter's quotation without a manual reload — same
  // polling pattern as ShipmentDetail.tsx. `load` doesn't toggle `loading`
  // on repeat calls (only the initial mount does, via useState(true) ->
  // the finally block above), so a poll tick updates the table silently
  // instead of flashing the full-page loader every 10s.
  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, []);

  const counts = useMemo(() => {
    const c: Partial<Record<RequirementStatus, number>> = {};
    for (const r of reqs) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [reqs]);

  const filtered = statusFilter === "ALL" ? reqs : reqs.filter((r) => r.status === statusFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transport Requirements"
        subtitle="Manage and track all transport requirements raised by your team"
        action={
          <Button onClick={() => navigate("/requirements/new")}>
            <Plus className="w-4 h-4" /> Create Requirement
          </Button>
        }
      />

      {/* Status filter tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStatusFilter("ALL")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors",
            statusFilter === "ALL"
              ? "bg-indigo-600 border-indigo-600 text-white"
              : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
          )}
        >
          All <span className="opacity-70">({reqs.length})</span>
        </button>
        {FILTER_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors",
              statusFilter === s
                ? "bg-indigo-600 border-indigo-600 text-white"
                : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
            )}
          >
            {requirementStatusLabel(s)} <span className="opacity-70">({counts[s] ?? 0})</span>
          </button>
        ))}
      </div>

      <Card>
        {loading ? (
          <PageLoader />
        ) : error ? (
          <ErrorMessage message={error} onRetry={load} />
        ) : reqs.length === 0 ? (
          <EmptyState
            title="No requirements yet"
            description="Create your first transport requirement to get started"
            action={
              <Button size="sm" onClick={() => navigate("/requirements/new")}>
                <Plus className="w-3.5 h-3.5" /> Create Requirement
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={`No ${requirementStatusLabel(statusFilter as RequirementStatus).toLowerCase()} requirements`}
            description="Try a different status filter"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Req. ID</Th>
                <Th>Route</Th>
                <Th>Product</Th>
                <Th>Weight</Th>
                <Th>Cold Chain</Th>
                <Th>Max Cost</Th>
                <Th>SLA Deadline</Th>
                <Th>Status</Th>
                <Th>Responses</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50/80 cursor-pointer transition-colors group" onClick={() => {
                  if (req.status === "ASSIGNED" && req.shipment) {
                    navigate(`/shipments/${req.shipment.id}`);
                  } else if (req.status === "DRAFT") {
                    navigate(`/requirements/${req.id}/edit`);
                  } else {
                    navigate(`/requirements/${req.id}/match`);
                  }
                }}>
                  <Td>
                    <div className="flex items-center gap-2">
                      {req.status === "OPEN" && <StatusDot pulse color="blue" />}
                      <span className="font-mono text-xs font-bold text-indigo-700 group-hover:text-indigo-800">{req.referenceNumber}</span>
                    </div>
                  </Td>
                  <Td>
                    {req.originCity && req.destinationCity ? (
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="font-semibold text-slate-800">{req.originCity}</span>
                        <ArrowRight className="w-3 h-3 text-slate-300" />
                        <span className="font-semibold text-slate-800">{req.destinationCity}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Route not set</span>
                    )}
                  </Td>
                  <Td className="max-w-[160px] truncate font-medium text-slate-700">{req.productType || <span className="text-slate-400 italic">—</span>}</Td>
                  <Td className="font-medium text-slate-700">{req.weightKg ? `${parseFloat(req.weightKg).toLocaleString("en-IN")} kg` : "—"}</Td>
                  <Td>
                    {req.coldChainRequired ? (
                      <div className="flex items-center gap-1.5 text-cyan-700 bg-cyan-50 border border-cyan-100 px-2 py-0.5 rounded w-fit">
                        <Snowflake className="w-3 h-3" />
                        <span className="text-[11px] font-bold">
                          {req.tempMinCelsius}°C – {req.tempMaxCelsius}°C
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Not required</span>
                    )}
                  </Td>
                  <Td className="font-bold text-slate-800">{req.maxCostInr ? formatINR(req.maxCostInr) : "—"}</Td>
                  <Td className="text-xs font-medium text-slate-600">{req.slaDeadline ? formatDate(req.slaDeadline) : "—"}</Td>
                  <Td>
                    <Badge className={requirementStatusColor(req.status)}>
                      {requirementStatusLabel(req.status)}
                    </Badge>
                  </Td>
                  <Td className="text-xs font-semibold text-slate-600">{requirementResponsesLabel(req)}</Td>
                  <Td>
                    <span className="text-xs text-indigo-600 font-bold group-hover:underline">
                      {req.status === "ASSIGNED" ? "View Shipment" : req.status === "DRAFT" ? "Continue Editing" : "View"}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
