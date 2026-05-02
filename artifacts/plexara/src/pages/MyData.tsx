import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  Database, FileText, Activity, Pill, Stethoscope, AlertCircle,
  CheckCircle2, Clock, RefreshCw, Trash2, FlaskConical, FileCheck,
  TrendingUp, MinusCircle, Loader2, XCircle,
} from "lucide-react";
import type { ExtractionSummary } from "../components/dashboard/ExtractionSummaryBlock";

/**
 * Auditability Fix 2b — "My Data" page.
 *
 * Patient-facing audit surface. Renders everything the system has
 * captured for the active patient — records, biomarkers, supplements,
 * medications, symptoms, evidence — with explicit Retry / Delete
 * controls on each errored record. Backed by GET /patients/:id/summary
 * which is a single read-only aggregation (no LLM, no PII leaves).
 *
 * The goal is trust: a beta tester whose Care Plan is empty needs ONE
 * place to verify whether their upload reached the system at all and,
 * if not, to retry without re-uploading.
 */

type SummaryResponse = {
  profile: {
    name: string;
    dateOfBirth: string | null;
    sex: string | null;
    conditions: Array<Record<string, string | undefined>>;
    allergies: Array<Record<string, string | undefined>>;
  };
  records: {
    total: number;
    byStatus: { complete: number; processing: number; error: number };
    list: Array<{
      id: number;
      type: string;
      fileName: string;
      testDate: string | null;
      status: string;
      uploadedAt: string;
      // Verification spec (Fix 3a/3b) — these come from the patient
      // summary route which now joins extractionSummary + computes a
      // contributionStatus per row. Optional so older snapshots and
      // records that pre-date the schema migration still render.
      detectedType?: string | null;
      extractionSummary?: ExtractionSummary | null;
      contributionStatus?: {
        status: "contributing" | "partial" | "not_contributing" | "processing" | "error";
        reason: string;
      } | null;
    }>;
  };
  biomarkers: {
    total: number;
    list: Array<{
      name: string;
      latestValue: string;
      testDate: string | null;
      category: string | null;
    }>;
  };
  supplements: {
    active: number;
    inactive: number;
    list: Array<{
      id: number;
      name: string;
      dosage: string | null;
      frequency: string | null;
      active: boolean;
      notes: string | null;
      startedAt: string | null;
    }>;
  };
  medications: {
    active: number;
    list: Array<{
      id: number;
      name: string;
      dosage: string | null;
      frequency: string | null;
      drugClass: string | null;
      active: boolean;
      notes: string | null;
    }>;
  };
  symptoms: {
    total: number;
    recent: Array<{
      name: string;
      severity: number;
      loggedAt: string;
      category: string | null;
    }>;
  };
  evidence: {
    total: number;
    entries: Array<{
      recordId: number;
      documentType: string;
      summary: string | null;
      testDate: string | null;
      keyFindings: string[] | null;
      uploadDate: string;
    }>;
  };
  interpretations: { total: number };
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    complete: { label: "Complete", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800", Icon: CheckCircle2 },
    processing: { label: "Processing", cls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800", Icon: Clock },
    pending: { label: "Pending", cls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800", Icon: Clock },
    error: { label: "Error", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-800", Icon: AlertCircle },
    consent_blocked: { label: "Consent needed", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800", Icon: AlertCircle },
  };
  const v = map[status] ?? { label: status, cls: "bg-secondary text-muted-foreground border-border", Icon: Clock };
  const { Icon } = v;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${v.cls}`}>
      <Icon className="w-3 h-3" />
      {v.label}
    </span>
  );
}

/**
 * Verification spec (Fix 3a/3b) — one collapsible visual group inside the
 * Records section. Renders nothing when the bucket is empty so the page
 * stays clean for new accounts. Tone drives the accent strip + icon
 * tint so the eye can scan groups in milliseconds without reading
 * labels.
 */
function ContributionGroup({
  kind,
  icon: Icon,
  title,
  description,
  records,
  tone,
  onRetry,
  onDelete,
  retryBusy,
  deleteBusy,
  hideRetry = false,
}: {
  kind: string;
  icon: typeof CheckCircle2;
  title: string;
  description: string;
  records: Array<{
    id: number;
    type: string;
    fileName: string;
    testDate: string | null;
    status: string;
    uploadedAt: string;
    detectedType?: string | null;
    contributionStatus?: { status: string; reason: string } | null;
  }>;
  tone: "success" | "warn" | "muted" | "info" | "error";
  onRetry: (id: number) => void;
  onDelete: (id: number, name: string) => void;
  retryBusy: boolean;
  deleteBusy: boolean;
  hideRetry?: boolean;
}) {
  if (records.length === 0) return null;
  const toneCls: Record<typeof tone, { stripe: string; icon: string; pill: string }> = {
    success: { stripe: "border-l-emerald-500", icon: "text-emerald-600", pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300" },
    warn: { stripe: "border-l-amber-500", icon: "text-amber-600", pill: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300" },
    muted: { stripe: "border-l-muted-foreground/40", icon: "text-muted-foreground", pill: "bg-secondary text-muted-foreground" },
    info: { stripe: "border-l-blue-500", icon: "text-blue-600", pill: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300" },
    error: { stripe: "border-l-rose-500", icon: "text-rose-600", pill: "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300" },
  };
  const t = toneCls[tone];
  return (
    <div className={`pl-4 border-l-2 ${t.stripe}`} data-testid={`contribution-group-${kind}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${t.icon} ${kind === "processing" ? "animate-spin" : ""}`} />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className={`ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full ${t.pill}`}>
          {records.length}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>
      <div className="divide-y divide-border">
        {records.map((r) => (
          <div key={r.id} className="py-2.5 flex items-start gap-4" data-testid={`record-row-${r.id}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm text-foreground truncate">{r.fileName}</span>
                <StatusBadge status={r.status} />
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {r.type}
                {r.detectedType && r.detectedType !== r.type && (
                  <span className="ml-1 text-amber-700 dark:text-amber-400">
                    (detected as {r.detectedType.replace(/_/g, " ")})
                  </span>
                )}
                {" · "}Test {formatDate(r.testDate)} · Uploaded {formatDate(r.uploadedAt)}
              </div>
              {r.contributionStatus?.reason && (
                <div className="text-[11px] text-muted-foreground mt-0.5 italic">
                  {r.contributionStatus.reason}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!hideRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(r.id)}
                  disabled={retryBusy}
                  className="inline-flex items-center gap-1 px-2.5 h-8 rounded-md border border-border bg-card hover:bg-secondary text-xs font-medium text-foreground disabled:opacity-50"
                  data-testid={`retry-record-${r.id}`}
                >
                  <RefreshCw className="w-3 h-3" />
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={() => onDelete(r.id, r.fileName)}
                disabled={deleteBusy}
                className="inline-flex items-center gap-1 px-2.5 h-8 rounded-md border border-border bg-card hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 text-xs font-medium text-muted-foreground disabled:opacity-50"
                data-testid={`delete-record-${r.id}`}
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, total, subtitle }: {
  icon: typeof Database;
  title: string;
  total: number | string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-baseline gap-3 mb-4 pb-3 border-b border-border">
      <Icon className="w-5 h-5 text-primary" />
      <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
      <span className="text-sm text-muted-foreground">({total})</span>
      {subtitle && <span className="ml-auto text-xs text-muted-foreground">{subtitle}</span>}
    </div>
  );
}

export default function MyData() {
  const { patientId, isLoading: patientLoading } = useCurrentPatient();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const summaryQueryKey = useMemo(() => ["my-data-summary", patientId], [patientId]);

  const { data, isLoading, error } = useQuery<SummaryResponse>({
    queryKey: summaryQueryKey,
    queryFn: () => api<SummaryResponse>(`/patients/${patientId}/summary`),
    enabled: !!patientId,
    refetchInterval: 15_000,
  });

  const retryMutation = useMutation({
    mutationFn: (recordId: number) =>
      api(`/patients/${patientId}/records/${recordId}/retry`, { method: "POST" }),
    onSuccess: (_d, recordId) => {
      toast({ title: "Retrying extraction", description: `Record #${recordId} is being reprocessed.` });
      queryClient.invalidateQueries({ queryKey: summaryQueryKey });
    },
    onError: (err: Error & { detail?: { error?: string } }) => {
      toast({
        title: "Could not retry",
        description: err.detail?.error ?? err.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (recordId: number) =>
      api(`/patients/${patientId}/records/${recordId}`, { method: "DELETE" }),
    onSuccess: (_d, recordId) => {
      toast({ title: "Record deleted", description: `Record #${recordId} was removed.` });
      queryClient.invalidateQueries({ queryKey: summaryQueryKey });
    },
    onError: (err: Error) => {
      toast({ title: "Could not delete", description: err.message, variant: "destructive" });
    },
  });

  if (patientLoading || isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-secondary rounded animate-pulse" />
        <div className="h-32 bg-secondary rounded animate-pulse" />
        <div className="h-64 bg-secondary rounded animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex items-center gap-2 text-destructive font-medium">
          <AlertCircle className="w-4 h-4" />
          Could not load your data summary
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  const erroredRecords = data.records.list.filter((r) => r.status === "error");

  // Verification spec (Fix 3a/3b) — group records by contributionStatus
  // so the user can scan "what's actually feeding my health picture" vs
  // "what's stuck or empty". We fall back to a synthesized status from
  // the raw record.status when the server hasn't backfilled
  // contributionStatus yet (older rows).
  const groupedRecords = (() => {
    const buckets: Record<string, typeof data.records.list> = {
      contributing: [],
      partial: [],
      not_contributing: [],
      processing: [],
      error: [],
    };
    for (const r of data.records.list) {
      const status = r.contributionStatus?.status
        ?? (r.status === "error" || r.status === "consent_blocked"
              ? "error"
              : r.status === "processing" || r.status === "pending"
                ? "processing"
                : "not_contributing");
      (buckets[status] ?? buckets.not_contributing).push(r);
    }
    return buckets;
  })();

  return (
    <div className="space-y-8" data-testid="my-data-page">
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
          <Database className="w-3.5 h-3.5" />
          Audit
        </div>
        <h1 className="font-heading text-2xl font-bold text-foreground">My Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything Plexara knows about you. Use this page to verify what was captured from your uploads, retry failed extractions, or delete records you no longer want.
        </p>
      </div>

      {/* ── Profile ────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-6">
        <SectionHeader icon={FileCheck} title="Profile" total="basics" />
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div className="flex items-baseline gap-3">
            <dt className="text-muted-foreground w-32">Name</dt>
            <dd className="font-medium text-foreground">{data.profile.name}</dd>
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="text-muted-foreground w-32">Date of birth</dt>
            <dd className="font-medium text-foreground">{formatDate(data.profile.dateOfBirth)}</dd>
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="text-muted-foreground w-32">Sex</dt>
            <dd className="font-medium text-foreground">{data.profile.sex ?? "—"}</dd>
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="text-muted-foreground w-32">Conditions</dt>
            <dd className="font-medium text-foreground">
              {data.profile.conditions.length === 0
                ? "None documented"
                : data.profile.conditions.map((c) => c.name).filter(Boolean).join(", ")}
            </dd>
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="text-muted-foreground w-32">Allergies</dt>
            <dd className="font-medium text-foreground">
              {data.profile.allergies.length === 0
                ? "None documented"
                : data.profile.allergies.map((a) => a.substance).filter(Boolean).join(", ")}
            </dd>
          </div>
        </dl>
      </section>

      {/* ── Records ──
          Verification spec (Fix 3a/3b) — grouped by contribution status
          so the user immediately sees which uploads are actually feeding
          their health intelligence vs which ones landed silently. Each
          group renders the same inline action set (Retry / Delete) so
          users can self-correct without leaving the page. */}
      <section className="rounded-lg border border-border bg-card p-6">
        <SectionHeader
          icon={FileText}
          title="Records"
          total={data.records.total}
          subtitle={`${groupedRecords.contributing.length} contributing · ${groupedRecords.partial.length} partial · ${groupedRecords.not_contributing.length} not contributing · ${groupedRecords.processing.length} processing · ${groupedRecords.error.length} error`}
        />
        {data.records.list.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No records uploaded yet.</p>
        ) : (
          <div className="space-y-6">
            <ContributionGroup
              kind="contributing"
              icon={TrendingUp}
              title="Contributing to your health picture"
              description="These records are actively feeding gauges, alerts, and reports."
              records={groupedRecords.contributing}
              tone="success"
              onRetry={(id) => retryMutation.mutate(id)}
              onDelete={(id, name) => {
                if (confirm(`Delete record "${name}"? This removes the file and all extracted biomarkers.`)) {
                  deleteMutation.mutate(id);
                }
              }}
              retryBusy={retryMutation.isPending}
              deleteBusy={deleteMutation.isPending}
            />
            <ContributionGroup
              kind="partial"
              icon={AlertCircle}
              title="Partially contributing"
              description="We extracted some data but confidence was low — review and consider retrying with a different document type."
              records={groupedRecords.partial}
              tone="warn"
              onRetry={(id) => retryMutation.mutate(id)}
              onDelete={(id, name) => {
                if (confirm(`Delete record "${name}"?`)) deleteMutation.mutate(id);
              }}
              retryBusy={retryMutation.isPending}
              deleteBusy={deleteMutation.isPending}
            />
            <ContributionGroup
              kind="not_contributing"
              icon={MinusCircle}
              title="Not contributing yet"
              description="These records were processed but no structured data made it through. Try again or pick a different type."
              records={groupedRecords.not_contributing}
              tone="muted"
              onRetry={(id) => retryMutation.mutate(id)}
              onDelete={(id, name) => {
                if (confirm(`Delete record "${name}"?`)) deleteMutation.mutate(id);
              }}
              retryBusy={retryMutation.isPending}
              deleteBusy={deleteMutation.isPending}
            />
            <ContributionGroup
              kind="processing"
              icon={Loader2}
              title="Still processing"
              description="The three lenses are still analysing — this page auto-refreshes."
              records={groupedRecords.processing}
              tone="info"
              onRetry={(id) => retryMutation.mutate(id)}
              onDelete={(id, name) => {
                if (confirm(`Delete record "${name}"?`)) deleteMutation.mutate(id);
              }}
              retryBusy={retryMutation.isPending}
              deleteBusy={deleteMutation.isPending}
              hideRetry
            />
            <ContributionGroup
              kind="error"
              icon={XCircle}
              title="Errors needing attention"
              description="These uploads failed to process. Retry or delete to clean up."
              records={groupedRecords.error}
              tone="error"
              onRetry={(id) => retryMutation.mutate(id)}
              onDelete={(id, name) => {
                if (confirm(`Delete record "${name}"?`)) deleteMutation.mutate(id);
              }}
              retryBusy={retryMutation.isPending}
              deleteBusy={deleteMutation.isPending}
            />
          </div>
        )}
      </section>

      {/* ── Failed extractions callout ─────────────────────────────────── */}
      {erroredRecords.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800 p-6">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-medium mb-3">
            <AlertCircle className="w-4 h-4" />
            {erroredRecords.length} extraction{erroredRecords.length === 1 ? "" : "s"} failed
          </div>
          <p className="text-sm text-amber-800/80 dark:text-amber-300/80 mb-4">
            The system could not extract data from {erroredRecords.length === 1 ? "this document" : "these documents"}. Click Retry above to try again, or Delete to remove.
          </p>
          <ul className="space-y-1 text-sm text-amber-900 dark:text-amber-200">
            {erroredRecords.map((r) => (
              <li key={r.id}>• {r.fileName} — uploaded {formatDate(r.uploadedAt)}</li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Biomarkers ─────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-6">
        <SectionHeader icon={FlaskConical} title="Biomarkers tracked" total={data.biomarkers.total} subtitle="Latest value per marker" />
        {data.biomarkers.list.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No biomarkers captured yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.biomarkers.list.map((b) => (
              <div key={b.name} className="text-sm py-1">
                <span className="font-medium text-foreground">{b.name}:</span>{" "}
                <span className="text-foreground">{b.latestValue || "—"}</span>{" "}
                <span className="text-xs text-muted-foreground">({formatDate(b.testDate)})</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Supplements ────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-6">
        <SectionHeader
          icon={Pill}
          title="Supplements"
          total={data.supplements.list.length}
          subtitle={`${data.supplements.active} active · ${data.supplements.inactive} inactive`}
        />
        {data.supplements.list.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No supplements on file. Upload a supplement-stack document or add them in Care Plan.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.supplements.list.map((s) => (
              <li key={s.id} className="flex items-baseline gap-2">
                <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${s.active ? "text-emerald-600" : "text-muted-foreground"}`} />
                <span className="font-medium text-foreground">{s.name}</span>
                {s.dosage && <span className="text-muted-foreground">{s.dosage}</span>}
                {s.frequency && <span className="text-muted-foreground">— {s.frequency}</span>}
                {!s.active && <span className="text-xs text-muted-foreground italic">(inactive)</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Medications ────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-6">
        <SectionHeader
          icon={Stethoscope}
          title="Medications"
          total={data.medications.list.length}
          subtitle={`${data.medications.active} active`}
        />
        {data.medications.list.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No medications on file.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.medications.list.map((m) => (
              <li key={m.id} className="flex items-baseline gap-2">
                <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${m.active ? "text-emerald-600" : "text-muted-foreground"}`} />
                <span className="font-medium text-foreground">{m.name}</span>
                {m.dosage && <span className="text-muted-foreground">{m.dosage}</span>}
                {m.drugClass && <span className="text-xs text-muted-foreground">[{m.drugClass}]</span>}
                {!m.active && <span className="text-xs text-muted-foreground italic">(inactive)</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Symptoms ───────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-6">
        <SectionHeader icon={Activity} title="Recent symptoms" total={data.symptoms.total} subtitle="20 most recent" />
        {data.symptoms.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No symptoms logged. Use the Journal to add them.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.symptoms.recent.map((s, i) => (
              <li key={`${s.name}-${s.loggedAt}-${i}`} className="flex items-baseline gap-2">
                <span className="font-medium text-foreground">{s.name}</span>
                <span className="text-muted-foreground">— severity {s.severity}/10</span>
                <span className="text-xs text-muted-foreground">({formatDate(s.loggedAt)})</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Evidence registry ──────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-6">
        <SectionHeader icon={Database} title="Evidence registry" total={data.evidence.total} subtitle="Cross-record evidence map" />
        {data.evidence.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No evidence entries yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.evidence.entries.slice(0, 12).map((e) => (
              <li key={e.recordId} className="border-l-2 border-primary/30 pl-3 py-0.5">
                <div className="font-medium text-foreground">
                  {e.documentType} <span className="text-xs text-muted-foreground font-normal">({formatDate(e.testDate ?? e.uploadDate)})</span>
                </div>
                {e.summary && <div className="text-muted-foreground text-xs mt-0.5">{e.summary}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="text-xs text-muted-foreground italic text-center pt-4">
        {data.interpretations.total} AI interpretation{data.interpretations.total === 1 ? "" : "s"} on file. This page auto-refreshes every 15 seconds.
      </div>
    </div>
  );
}
