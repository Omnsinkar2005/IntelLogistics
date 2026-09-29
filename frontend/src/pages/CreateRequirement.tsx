import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowLeft, Save, FileEdit, Snowflake, Package, MapPin, IndianRupee, Clock, Building2 } from "lucide-react";
import { createRequirement, updateRequirement, getRequirement, getDefaultManager, getFacilities } from "@/services";
import { PageHeader, Button, Card, CardBody, Input, Select, Textarea, Divider, PageLoader, ErrorMessage } from "@/components/common";
import type { User, Facility } from "@/types";

// All fields are optional at the schema level — an incomplete form can
// always be saved as a Draft (see handleSaveDraft, which reads raw form
// values and skips this resolver entirely). This schema is only enforced
// on the "Save & Mark Ready to Send" path, where a complete form is
// required — but it is never auto-sent for quotation; sending is a
// separate, explicit action taken from the requirement detail page.
const schema = z
  .object({
    originFacilityId: z.string().min(1, "Required").optional(),
    destinationFacilityId: z.string().min(1, "Required").optional(),
    productType: z.string().min(2, "Required").optional(),
    weightKg: z.number().min(1, "Must be > 0").optional(),
    volumeCbm: z.number().optional(),
    coldChainRequired: z.boolean(),
    tempMinCelsius: z.number().optional(),
    tempMaxCelsius: z.number().optional(),
    maxCostInr: z.number().min(1, "Must be > 0").optional(),
    slaDeadline: z.string().min(1, "Required").optional(),
    notes: z.string().optional(),
  })
  .refine((d) => !d.originFacilityId || !d.destinationFacilityId || d.originFacilityId !== d.destinationFacilityId, {
    message: "Origin and destination must be different",
    path: ["destinationFacilityId"],
  });

// An empty number input reads back as an empty string — convert that to
// undefined instead of NaN (plain `valueAsNumber` would produce NaN, which
// `z.number().optional()` rejects, and NaN must never reach the API).
const asOptionalNumber = { setValueAs: (v: string) => (v === "" ? undefined : Number(v)) };

// `datetime-local` inputs need "YYYY-MM-DDTHH:mm" in local time — the API
// returns/expects full ISO instants.
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type FormData = z.infer<typeof schema>;

export function CreateRequirement() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEditing = Boolean(id);

  const [loadingExisting, setLoadingExisting] = useState(isEditing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [blockedStatus, setBlockedStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"draft" | "ready" | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [manager, setManager] = useState<User | null>(null);
  const [managerError, setManagerError] = useState(false);
  const [cwhFacilities, setCwhFacilities] = useState<Facility[]>([]);
  const [destinationFacilities, setDestinationFacilities] = useState<Facility[]>([]);
  const [facilitiesError, setFacilitiesError] = useState(false);

  const { register, handleSubmit, watch, reset, getValues, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { coldChainRequired: false },
  });

  useEffect(() => {
    if (!isEditing) {
      getDefaultManager()
        .then((m) => (m ? setManager(m) : setManagerError(true)))
        .catch(() => setManagerError(true));
    }
    Promise.all([getFacilities("CWH"), getFacilities("DESTINATION")])
      .then(([cwh, dest]) => {
        setCwhFacilities(cwh);
        setDestinationFacilities(dest);
      })
      .catch(() => setFacilitiesError(true));
  }, [isEditing]);

  useEffect(() => {
    if (!id) return;
    getRequirement(id)
      .then((req) => {
        if (req.status !== "DRAFT" && req.status !== "READY_TO_SEND") {
          setBlockedStatus(req.status);
          return;
        }
        reset({
          originFacilityId: req.originFacilityId ?? undefined,
          destinationFacilityId: req.destinationFacilityId ?? undefined,
          productType: req.productType ?? undefined,
          weightKg: req.weightKg ? parseFloat(req.weightKg) : undefined,
          volumeCbm: req.volumeCbm ? parseFloat(req.volumeCbm) : undefined,
          coldChainRequired: req.coldChainRequired,
          tempMinCelsius: req.tempMinCelsius ? parseFloat(req.tempMinCelsius) : undefined,
          tempMaxCelsius: req.tempMaxCelsius ? parseFloat(req.tempMaxCelsius) : undefined,
          maxCostInr: req.maxCostInr ? parseFloat(req.maxCostInr) : undefined,
          slaDeadline: req.slaDeadline ? isoToLocalInput(req.slaDeadline) : undefined,
          notes: req.specialInstructions ?? undefined,
        });
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "Failed to load requirement"))
      .finally(() => setLoadingExisting(false));
  }, [id, reset]);

  const coldChain = watch("coldChainRequired");
  const selectedDestinationId = watch("destinationFacilityId");
  const selectedDestination = destinationFacilities.find((f) => f.id === selectedDestinationId);

  const buildPayload = (data: FormData, saveAsDraft: boolean) => ({
    originFacilityId: data.originFacilityId || undefined,
    destinationFacilityId: data.destinationFacilityId || undefined,
    productType: data.productType || undefined,
    weightKg: data.weightKg,
    volumeCbm: data.volumeCbm,
    coldChainRequired: data.coldChainRequired,
    tempMinCelsius: data.coldChainRequired ? data.tempMinCelsius : undefined,
    tempMaxCelsius: data.coldChainRequired ? data.tempMaxCelsius : undefined,
    maxCostInr: data.maxCostInr,
    slaDeadline: data.slaDeadline ? new Date(data.slaDeadline).toISOString() : undefined,
    specialInstructions: data.notes || undefined,
    saveAsDraft,
  });

  // Bypasses the resolver entirely (reads raw values via getValues) — an
  // incomplete form must always be saveable as a Draft.
  const handleSaveDraft = async () => {
    try {
      setSubmitting("draft");
      setSubmitError("");
      const data = getValues();
      if (isEditing && id) {
        await updateRequirement(id, buildPayload(data, true));
        navigate("/requirements");
      } else {
        if (!manager?.companyId) {
          setSubmitError("No manager/company found to attribute this requirement to. Check the seed data.");
          return;
        }
        const created = await createRequirement({
          companyId: manager.companyId,
          createdById: manager.id,
          ...buildPayload(data, true),
        });
        navigate(`/requirements/${created.id}/edit`);
      }
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Failed to save draft");
    } finally {
      setSubmitting(null);
    }
  };

  // Full-validation path — the requirement becomes Ready to Send, never
  // automatically Sent for Quotation.
  const onSubmitReady = handleSubmit(async (data) => {
    if (data.coldChainRequired && (data.tempMinCelsius === undefined || data.tempMaxCelsius === undefined)) {
      setSubmitError("Temperature range is required for cold chain shipments");
      return;
    }
    try {
      setSubmitting("ready");
      setSubmitError("");
      let requirementId = id;
      if (isEditing && id) {
        await updateRequirement(id, buildPayload(data, false));
      } else {
        if (!manager || !manager.companyId) {
          setSubmitError("No manager/company found to attribute this requirement to. Check the seed data.");
          return;
        }
        const created = await createRequirement({
          companyId: manager.companyId,
          createdById: manager.id,
          ...buildPayload(data, false),
        });
        requirementId = created.id;
      }
      navigate(`/requirements/${requirementId}/match`);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Failed to save requirement");
    } finally {
      setSubmitting(null);
    }
  });

  if (loadingExisting) return <PageLoader />;
  if (loadError) return <ErrorMessage message={loadError} />;
  if (blockedStatus) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="p-6 bg-amber-50 border border-amber-200 rounded-xl text-sm font-medium text-amber-800">
          This requirement has already been sent for quotation (status: {blockedStatus}) and can no longer be edited.
        </div>
        <Button className="mt-4" variant="secondary" onClick={() => navigate(`/requirements/${id}/match`)}>
          View Requirement
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate("/requirements")} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            {isEditing ? "Edit Transport Requirement" : "Create Transport Requirement"}
          </h1>
          <p className="text-sm font-medium text-slate-500 mt-1">
            {isEditing ? "Complete this draft or adjust it before sending for quotation" : "Define shipment details to find the best transporter"}
          </p>
        </div>
      </div>

      {managerError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm font-medium text-red-700">
          No manager user is available to create this requirement. Run the database seed and try again.
        </div>
      )}
      {facilitiesError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm font-medium text-red-700">
          Could not load CWH/destination facilities. Run the database seed and try again.
        </div>
      )}

      <form onSubmit={onSubmitReady}>
        <div className="space-y-6">
          {/* Route Section */}
          <Card>
            <CardBody className="p-6">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-6">
                <MapPin className="w-4 h-4 text-indigo-500" /> Route Details
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Select label="Source (CWH)" {...register("originFacilityId")} error={errors.originFacilityId?.message} defaultValue="">
                    <option value="" disabled>Select CWH</option>
                    {cwhFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} — {f.city}</option>)}
                  </Select>
                </div>
                <div>
                  <Select label="Destination (exact facility)" {...register("destinationFacilityId")} error={errors.destinationFacilityId?.message} defaultValue="">
                    <option value="" disabled>Select exact destination</option>
                    {destinationFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} — {f.city}</option>)}
                  </Select>
                </div>
              </div>

              {selectedDestination && (
                <div className="mt-4 flex items-start gap-3 p-3.5 bg-indigo-50/60 border border-indigo-100 rounded-xl">
                  <Building2 className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-bold text-indigo-900">
                      Receiver: {selectedDestination.organizationName ?? selectedDestination.name}
                    </p>
                    <p className="text-indigo-700 mt-0.5">{selectedDestination.address}</p>
                    <p className="text-indigo-500 mt-1">
                      This information will automatically populate the POD once the shipment is delivered — no manual entry needed.
                    </p>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Cargo Section */}
          <Card>
            <CardBody className="p-6">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-6">
                <Package className="w-4 h-4 text-indigo-500" /> Cargo & Compliance
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input label="Product Type" {...register("productType")} error={errors.productType?.message} placeholder="e.g., Vaccines (Covaxin)" />
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Weight (kg)" type="number" step="0.1" {...register("weightKg", asOptionalNumber)} error={errors.weightKg?.message} placeholder="2500" />
                  <Input label="Volume (cbm)" type="number" step="0.1" {...register("volumeCbm", asOptionalNumber)} error={errors.volumeCbm?.message} placeholder="8.5" />
                </div>
              </div>

              <Divider className="my-6" />

              <div className="flex items-center gap-3 mb-4">
                <input
                  type="checkbox"
                  id="coldChain"
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                  {...register("coldChainRequired")}
                />
                <label htmlFor="coldChain" className="text-sm font-bold text-slate-800 flex items-center gap-1.5 cursor-pointer">
                  <Snowflake className="w-4 h-4 text-cyan-500" /> Requires Cold Chain
                </label>
              </div>

              {coldChain && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-cyan-50/50 border border-cyan-100 rounded-xl">
                  <Input label="Min Temp (°C)" type="number" {...register("tempMinCelsius", asOptionalNumber)} error={errors.tempMinCelsius?.message} placeholder="2" />
                  <Input label="Max Temp (°C)" type="number" {...register("tempMaxCelsius", asOptionalNumber)} error={errors.tempMaxCelsius?.message} placeholder="8" />
                </div>
              )}
            </CardBody>
          </Card>

          {/* Business Rules Section */}
          <Card>
            <CardBody className="p-6">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-6">
                <Clock className="w-4 h-4 text-indigo-500" /> Business Rules
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5 mb-1.5">
                    <IndianRupee className="w-3.5 h-3.5" /> Max Approved Cost (INR)
                  </label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 outline-none transition-colors"
                    {...register("maxCostInr", asOptionalNumber)}
                    placeholder="e.g., 75000"
                  />
                  {errors.maxCostInr && <p className="text-xs text-red-500 mt-1.5">{errors.maxCostInr.message}</p>}
                </div>
                <Input label="SLA Deadline" type="datetime-local" {...register("slaDeadline")} error={errors.slaDeadline?.message} />
                <div className="md:col-span-2">
                  <Textarea label="Special Instructions / Notes" {...register("notes")} rows={3} placeholder="Any specific handling instructions..." />
                </div>
              </div>
            </CardBody>
          </Card>

          {submitError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm font-medium text-red-700">{submitError}</div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="ghost" onClick={() => navigate("/requirements")}>Cancel</Button>
            <Button
              type="button"
              variant="secondary"
              loading={submitting === "draft"}
              disabled={submitting !== null || managerError || facilitiesError}
              onClick={handleSaveDraft}
            >
              <FileEdit className="w-4 h-4" /> Save as Draft
            </Button>
            <Button type="submit" loading={submitting === "ready"} disabled={submitting !== null || managerError || facilitiesError}>
              <Save className="w-4 h-4" /> Save &amp; Mark Ready to Send
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
