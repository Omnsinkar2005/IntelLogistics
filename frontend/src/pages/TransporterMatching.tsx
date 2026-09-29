import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CheckCircle, XCircle, Snowflake, Truck, ArrowRight,
  FileEdit, Send, Clock, Copy, ExternalLink, Hourglass, ClipboardList,
} from "lucide-react";
import { getMatchingTransporters, createShipment, getRequirement, sendForQuotation, getTransporters } from "@/services";
import type { TransportRequirement, MatchResult, TransporterOffer, TransporterKPI } from "@/types";
import { Button, Card, CardBody, Badge, PageLoader, ErrorMessage, ScoreBar, Table, Th, Td } from "@/components/common";
import { formatINR, formatDate, offerStatusLabel, offerStatusColor, cn } from "@/utils";

// Historical SLA Performance is shown as adherence (100 - breach rate) to
// match how the rest of the app already talks about it (e.g. the eligible-
// transporter narrative: "0.0% SLA breach rate (100.0% compliance)").
// Null means "not enough shipment history yet" — never inferred/invented.
function formatSlaAdherence(breachRatePercent: string | null | undefined): string {
  if (breachRatePercent === null || breachRatePercent === undefined) return "No history yet";
  return `${(100 - Number(breachRatePercent)).toFixed(1)}%`;
}
function formatPercent(value: string | null | undefined): string {
  if (value === null || value === undefined) return "No history yet";
  return `${Number(value).toFixed(1)}%`;
}

// A submitted offer with nothing selected for assignment yet needs manual,
// explicit confirmation before a shipment is created — see the inline
// confirm bar rendered below the comparison table.
interface PendingAssignment {
  offer: TransporterOffer;
  vehicleId: string;
  costInr: number;
}

export function TransporterMatching() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [req, setReq] = useState<TransportRequirement | null>(null);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [transporterKpis, setTransporterKpis] = useState<Record<string, TransporterKPI | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [quotationDeadline, setQuotationDeadline] = useState("");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [pendingAssignment, setPendingAssignment] = useState<PendingAssignment | null>(null);

  const load = async () => {
    if (!id) return;
    try {
      setError(null);
      const requirement = await getRequirement(id);
      setReq(requirement);
      // Matches are needed at READY_TO_SEND (to pick who to send to) and at
      // OPEN/MATCHED (to look up an eligible vehicle for the transporter
      // the manager assigns — the actual quoted price now always comes
      // from a real submitted offer, never from this estimate).
      if (["READY_TO_SEND", "OPEN", "MATCHED"].includes(requirement.status)) {
        const results = await getMatchingTransporters(id);
        setMatches(results);
        if (requirement.status === "READY_TO_SEND") {
          setSelectedIds(new Set(results.filter((r) => r.eligibility.eligible).map((r) => r.transporter.id)));
        }
      }
      // Historical KPIs for the quotation comparison table — reuses the
      // same transporter listing the Transporters page already calls, each
      // row's `kpis[0]` being its latest computed snapshot. Only fetched
      // once at least one quotation has actually come in.
      if ((requirement.offers ?? []).some((o) => o.status === "SUBMITTED")) {
        const transporters = await getTransporters();
        const map: Record<string, TransporterKPI | undefined> = {};
        for (const t of transporters) map[t.id] = t.kpis?.[0];
        setTransporterKpis(map);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load matches");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  // Background-refresh while awaiting/receiving quotations, so the
  // Quotations list and "X/Y received" count pick up a transporter's
  // submission without a manual reload — same 10s-poll pattern as
  // ShipmentDetail.tsx. Deliberately scoped to OPEN/MATCHED only: polling
  // during READY_TO_SEND would keep resetting the manager's in-progress
  // transporter checkbox selection (see `load`'s READY_TO_SEND branch
  // above), and there's nothing left to change once ASSIGNED.
  useEffect(() => {
    if (!req || (req.status !== "OPEN" && req.status !== "MATCHED")) return;
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [id, req?.status]);

  const toggleSelected = (transporterId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(transporterId)) next.delete(transporterId);
      else next.add(transporterId);
      return next;
    });
  };

  const handleSend = async () => {
    if (!id || selectedIds.size === 0 || !quotationDeadline) return;
    try {
      setSending(true);
      await sendForQuotation(id, {
        transporterIds: Array.from(selectedIds),
        quotationDeadline: new Date(quotationDeadline).toISOString(),
      });
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to send requirement for quotation");
    } finally {
      setSending(false);
    }
  };

  // The manager reviews the comparison table and clicks "Select" on exactly
  // one transporter (setPendingAssignment) — nothing here ranks, scores, or
  // pre-picks a transporter. Assignment itself only happens once they
  // explicitly confirm that choice below.
  const confirmAssignment = async () => {
    if (!id || !pendingAssignment) return;
    const { offer, vehicleId, costInr } = pendingAssignment;
    try {
      setAssigning(offer.transporterId);
      await createShipment({ requirementId: id, transporterId: offer.transporterId, vehicleId, agreedCostInr: costInr });
      // Requirement now shows "Transporter Assigned" with a "View Shipment"
      // action from here — see Requirements.tsx.
      navigate("/requirements");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to assign transporter");
    } finally {
      setAssigning(null);
      setPendingAssignment(null);
    }
  };

  const copyQuoteLink = (token: string) => {
    const url = `${window.location.origin}/quote/${token}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedToken(token);
    setTimeout(() => setCopiedToken((t) => (t === token ? null : t)), 1500);
  };

  if (loading) return <PageLoader />;
  if (error) return <ErrorMessage message={error} onRetry={load} />;
  if (!req) return null;

  const eligible = matches.filter((m) => m.eligibility.eligible);
  const ineligible = matches.filter((m) => !m.eligibility.eligible);
  const deadlinePassed = req.quotationDeadline ? new Date(req.quotationDeadline).getTime() < Date.now() : false;
  // Kept in the order offers were sent, not by price or score — a
  // comparison table, not a ranking.
  const submittedOffers = (req.offers ?? []).filter((o) => o.status === "SUBMITTED");
  const pendingOffers = (req.offers ?? []).filter((o) => o.status !== "SUBMITTED");

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate("/requirements")} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
            Transporter Matching
            <Badge className="bg-blue-100 text-blue-700 font-mono">{req.referenceNumber}</Badge>
          </h1>
          <p className="text-sm font-medium text-slate-500 mt-1">Select the best transporter for this requirement based on historical performance</p>
        </div>
      </div>

      {/* Requirement Summary — only once the form is complete (Draft may not have route/cargo/cost set yet) */}
      {req.originCity && req.destinationCity && req.productType && req.weightKg && req.maxCostInr && (
        <Card className="border-indigo-100 shadow-sm shadow-indigo-500/5 bg-indigo-50/10">
          <CardBody className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                  <Truck className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Route</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-bold text-slate-900 text-base">{req.originCity}</span>
                    <ArrowRight className="w-4 h-4 text-slate-400" />
                    <span className="font-bold text-slate-900 text-base">{req.destinationCity}</span>
                  </div>
                </div>
              </div>

              <div className="h-10 w-px bg-slate-200 hidden md:block" />

              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cargo</p>
                <p className="font-semibold text-slate-800 mt-0.5">{req.productType} · {parseFloat(req.weightKg).toLocaleString("en-IN")} kg</p>
              </div>

              <div className="h-10 w-px bg-slate-200 hidden md:block" />

              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Budget</p>
                <p className="font-bold text-emerald-700 mt-0.5">{formatINR(req.maxCostInr)}</p>
              </div>

              {req.coldChainRequired && (
                <>
                  <div className="h-10 w-px bg-slate-200 hidden md:block" />
                  <div className="flex flex-col">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cold Chain</p>
                    <div className="flex items-center gap-1.5 text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded border border-cyan-200 mt-0.5 w-fit">
                      <Snowflake className="w-3.5 h-3.5" />
                      <span className="text-xs font-bold">{req.tempMinCelsius}°C – {req.tempMaxCelsius}°C</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {req.status === "DRAFT" ? (
        <Card className="bg-slate-50 border-slate-200">
          <CardBody className="p-8 text-center">
            <FileEdit className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-800 mb-2">This requirement is still a Draft</h2>
            <p className="text-slate-500 mb-6">Complete the form to mark it Ready to Send — a draft is never sent for quotation automatically.</p>
            <Button onClick={() => navigate(`/requirements/${req.id}/edit`)}>
              <FileEdit className="w-4 h-4" /> Continue Editing
            </Button>
          </CardBody>
        </Card>
      ) : req.status === "READY_TO_SEND" ? (
        <div className="space-y-6">
          <Card className="bg-amber-50 border-amber-200">
            <CardBody className="p-6">
              <div className="flex items-start gap-3">
                <Send className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-lg font-bold text-amber-900">Ready to Send</h2>
                  <p className="text-amber-700 text-sm mt-1">
                    Select which registered transporters to request a quotation from and set a quotation deadline.
                    Each selected transporter gets their own one-time link — sending does not reveal a price; a real
                    quote only exists once a transporter submits one.
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-end gap-4">
                <div>
                  <label className="text-xs font-semibold text-amber-900 flex items-center gap-1.5 mb-1.5">
                    <Clock className="w-3.5 h-3.5" /> Quotation Deadline
                  </label>
                  <input
                    type="datetime-local"
                    value={quotationDeadline}
                    onChange={(e) => setQuotationDeadline(e.target.value)}
                    className="px-3 py-2 text-sm border border-amber-200 rounded-lg bg-white focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 outline-none"
                  />
                </div>
                <Button variant="secondary" onClick={() => navigate(`/requirements/${req.id}/edit`)}>
                  <FileEdit className="w-4 h-4" /> Edit
                </Button>
                <Button
                  loading={sending}
                  disabled={selectedIds.size === 0 || !quotationDeadline}
                  onClick={handleSend}
                >
                  <Send className="w-4 h-4" /> Send for Quotation ({selectedIds.size})
                </Button>
              </div>
            </CardBody>
          </Card>

          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              Eligible Transporters — select who to send to ({eligible.length})
            </h2>
            <div className="grid gap-3">
              {eligible.length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl bg-white">
                  <p className="text-slate-500 font-medium">No registered transporters are eligible for this route/cargo yet.</p>
                </div>
              ) : (
                eligible.map((m) => (
                  <Card
                    key={m.transporter.id}
                    className={cn("cursor-pointer transition-colors", selectedIds.has(m.transporter.id) && "border-2 border-indigo-400 shadow-sm shadow-indigo-500/10")}
                    hover
                  >
                    <CardBody className="p-4 flex items-center gap-4" >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(m.transporter.id)}
                        onChange={() => toggleSelected(m.transporter.id)}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 cursor-pointer" onClick={() => toggleSelected(m.transporter.id)}>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-900">{m.transporter.name}</h3>
                          <Badge className="bg-slate-100 text-slate-600 font-medium">{m.transporter.city}</Badge>
                        </div>
                        {m.scoring?.hasKPIHistory ? (
                          <p className="text-xs text-slate-500 mt-1">{m.scoring.narrative}</p>
                        ) : (
                          <p className="text-xs text-slate-400 italic mt-1">No performance history yet</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Match Score</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-bold text-indigo-600">{Math.round(m.scoring?.totalScore ?? 0)}/100</span>
                          <div className="w-16"><ScoreBar score={m.scoring?.totalScore ?? 0} /></div>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                ))
              )}
            </div>
          </div>

          {ineligible.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                <XCircle className="w-5 h-5 text-slate-400" />
                Ineligible Transporters ({ineligible.length})
              </h2>
              <div className="grid gap-3 opacity-75">
                {ineligible.map((m) => (
                  <Card key={m.transporter.id} className="bg-slate-50 border-slate-200">
                    <CardBody className="p-4">
                      <h3 className="font-bold text-slate-700">{m.transporter.name}</h3>
                      <p className="text-sm font-medium text-red-500 mt-1 flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5" />
                        {!m.eligibility.eligible && m.eligibility.failures.map((f) => f.reason).join(", ")}
                      </p>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : req.status === "ASSIGNED" ? (
        <Card className="bg-emerald-50 border-emerald-200">
          <CardBody className="p-8 text-center">
            <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-emerald-900 mb-2">Requirement Fulfilled</h2>
            <p className="text-emerald-700 mb-6">This requirement has already been assigned to a transporter.</p>
            <Button onClick={() => navigate(`/shipments/${req.shipment?.id}`)}>
              View Shipment Details
            </Button>
          </CardBody>
        </Card>
      ) : (
        // OPEN / MATCHED — quotations actually requested/received.
        <div className="space-y-6">
          <Card className={cn("border", deadlinePassed ? "bg-slate-50 border-slate-200" : "bg-blue-50/50 border-blue-100")}>
            <CardBody className="p-4 flex items-center gap-3">
              <Clock className={cn("w-5 h-5 flex-shrink-0", deadlinePassed ? "text-slate-400" : "text-blue-500")} />
              <p className="text-sm font-semibold text-slate-700">
                Quotation deadline: {req.quotationDeadline ? formatDate(req.quotationDeadline) : "—"}
                {deadlinePassed && <span className="ml-2 text-amber-600 font-bold">(closed)</span>}
              </p>
            </CardBody>
          </Card>

          <div>
            <h2 className="text-lg font-bold text-slate-800 mb-4">
              Quotations ({submittedOffers.length}/{req.offers?.length ?? 0} received)
            </h2>

            {(!req.offers || req.offers.length === 0) && (
              <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl bg-white">
                <p className="text-slate-500 font-medium">No quotation requests were sent for this requirement.</p>
              </div>
            )}

            {/* Quotation Comparison — manager reviews these values side by
                side and manually selects one. Deliberately no score, rank,
                "recommended" badge, or price-based ordering: nothing here
                picks a transporter automatically or implies the cheapest
                (or highest-scoring) option is the right one. */}
            {submittedOffers.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5 mb-3">
                  <ClipboardList className="w-4 h-4 text-indigo-500" /> Quotation Comparison
                </h3>
                <Card className="overflow-hidden">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Transporter</Th>
                        <Th>Quoted Cost</Th>
                        <Th>Historical SLA Performance</Th>
                        <Th>OTIF</Th>
                        <Th>Damage / Shortage History</Th>
                        <Th>Completed Shipments</Th>
                        <Th></Th>
                      </tr>
                    </thead>
                    <tbody>
                      {submittedOffers.map((offer) => {
                        const match = matches.find((m) => m.transporter.id === offer.transporterId);
                        const eligibleVehicle = match?.eligibility.eligible ? match.eligibility.eligibleVehicles[0] : null;
                        const kpi = transporterKpis[offer.transporterId];
                        return (
                          <tr key={offer.id} className="hover:bg-slate-50/80">
                            <Td>
                              <div className="font-bold text-slate-900">{offer.transporter?.name ?? "Transporter"}</div>
                              {offer.transporter?.city && <div className="text-xs text-slate-400">{offer.transporter.city}</div>}
                            </Td>
                            <Td className="font-extrabold text-emerald-700">
                              {offer.quotedCostInr ? formatINR(offer.quotedCostInr) : "—"}
                            </Td>
                            <Td className="text-sm text-slate-700">{formatSlaAdherence(kpi?.slaBreachRatePercent)}</Td>
                            <Td className="text-sm text-slate-700">{formatPercent(kpi?.otifPercent)}</Td>
                            <Td className="text-sm text-slate-700">{formatPercent(kpi?.damageShortageRatePercent)}</Td>
                            <Td className="text-sm text-slate-700">{kpi?.totalShipments ?? 0}</Td>
                            <Td>
                              <Button
                                size="sm"
                                variant={pendingAssignment?.offer.id === offer.id ? "primary" : "secondary"}
                                disabled={!eligibleVehicle || !offer.quotedCostInr}
                                onClick={() =>
                                  eligibleVehicle && offer.quotedCostInr &&
                                  setPendingAssignment({ offer, vehicleId: eligibleVehicle.id, costInr: Number(offer.quotedCostInr) })
                                }
                              >
                                Select
                              </Button>
                              {!eligibleVehicle && <p className="text-[10px] text-amber-600 mt-1">No eligible vehicle</p>}
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </Card>

                {/* Manual confirmation — selecting a row above does not assign
                    anything by itself; the manager must explicitly confirm. */}
                {pendingAssignment && (
                  <Card className="mt-3 bg-indigo-50/60 border-indigo-200">
                    <CardBody className="p-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-indigo-900">
                        Assign this requirement to <span className="font-extrabold">{pendingAssignment.offer.transporter?.name}</span> at{" "}
                        <span className="font-extrabold">{formatINR(pendingAssignment.costInr)}</span>?
                      </p>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setPendingAssignment(null)}>Cancel</Button>
                        <Button size="sm" loading={assigning !== null} onClick={confirmAssignment}>
                          Confirm Assignment
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                )}
              </div>
            )}

            {/* Awaiting response — no price to compare yet. */}
            {pendingOffers.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">Awaiting Response</h3>
                <div className="grid gap-3">
                  {pendingOffers.map((offer) => (
                    <Card key={offer.id} className="border-slate-200">
                      <CardBody className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-slate-900">{offer.transporter?.name ?? "Transporter"}</h4>
                          <Badge className={offerStatusColor(offer.status)}>{offerStatusLabel(offer.status)}</Badge>
                        </div>
                        <div className="mt-2 space-y-2">
                          <p className="text-sm text-slate-500 flex items-center gap-1.5">
                            <Hourglass className="w-3.5 h-3.5" /> Awaiting the transporter's response
                          </p>
                          {offer.quoteToken && (
                            <div className="flex items-center gap-2">
                              <code className="text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-500 truncate max-w-[280px]">
                                {`${window.location.origin}/quote/${offer.quoteToken}`}
                              </code>
                              <button
                                type="button"
                                onClick={() => copyQuoteLink(offer.quoteToken!)}
                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                              >
                                <Copy className="w-3.5 h-3.5" /> {copiedToken === offer.quoteToken ? "Copied" : "Copy link"}
                              </button>
                              <a
                                href={`/quote/${offer.quoteToken}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1"
                              >
                                <ExternalLink className="w-3.5 h-3.5" /> Open
                              </a>
                            </div>
                          )}
                          <p className="text-[11px] text-slate-400 italic">
                            No email integration in this POC — this link stands in for the one that would be emailed to the transporter.
                          </p>
                        </div>
                      </CardBody>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
