import { CheckCircle2, AlertTriangle, FileSearch, Sparkles } from "lucide-react";

/**
 * Verification spec — shared "what did Plexara actually capture?" block.
 *
 * Renders the post-extraction summary stored on `records.extractionSummary`
 * (Fix 1a). Used by both UploadZone (Fix 1b) and RecordDetailModal
 * (Fix 1c) so the two surfaces stay visually + semantically aligned, and
 * the reclassification banner (Fix 2b) lives in exactly one place.
 *
 * Pure presentational — no data fetching. Caller passes the summary
 * object straight off the record. We render gracefully on partial /
 * unknown shapes so a stale snapshot never crashes the dashboard.
 */

export interface ExtractionSummary {
  biomarkerCount?: number;
  supplementCount?: number;
  medicationCount?: number;
  keyFindingsCount?: number;
  keyFindings?: string[];
  confidence?: number | null;
  detectedType?: string | null;
  userSelectedType?: string | null;
  typeMatch?: boolean;
  reclassified?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  blood_panel: "Blood Panel",
  mri_report: "MRI Report",
  scan_report: "CT / Scan Report",
  ultrasound: "Ultrasound",
  genetic_test: "Genetic Test",
  pharmacogenomics: "Pharmacogenomics",
  epigenomics: "Epigenomics",
  wearable_data: "Wearable Data",
  pathology_report: "Pathology Report",
  dexa_scan: "DEXA Scan",
  cancer_screening: "Cancer Screening",
  specialized_panel: "Specialized Panel",
  organic_acid_test: "Organic Acid Test",
  fatty_acid_profile: "Fatty Acid Profile",
  imaging: "Imaging Report",
  supplement_stack: "Supplement Stack",
  clinical_letter: "Clinical Letter",
  other: "Other",
};

function labelFor(type: string | null | undefined): string {
  if (!type) return "Unknown";
  return TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

export function ExtractionSummaryBlock({
  summary,
  variant = "modal",
}: {
  summary: ExtractionSummary | null | undefined;
  /**
   * "modal" — full-width with header, used inside RecordDetailModal.
   * "inline" — compact, used inside UploadZone entry rows.
   */
  variant?: "modal" | "inline";
}) {
  if (!summary) return null;

  const biomarker = summary.biomarkerCount ?? 0;
  const supplement = summary.supplementCount ?? 0;
  const medication = summary.medicationCount ?? 0;
  const keyFindingsCount = summary.keyFindingsCount ?? 0;
  const totalDataPoints = biomarker + supplement + medication + keyFindingsCount;
  const empty = totalDataPoints === 0;

  const confidence =
    typeof summary.confidence === "number" && Number.isFinite(summary.confidence)
      ? Math.round(summary.confidence)
      : null;

  const reclassified = summary.reclassified === true;
  const typeMismatch =
    !reclassified &&
    summary.typeMatch === false &&
    !!summary.userSelectedType &&
    !!summary.detectedType;

  const compact = variant === "inline";
  const containerCls = compact
    ? "rounded-lg border border-border bg-secondary/30 p-3 space-y-2"
    : "rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4";

  return (
    <div className={containerCls} data-testid="extraction-summary-block">
      {/* Header row — only on the modal variant; the inline version */}
      {/* lives inside an entry row that already has its own header. */}
      {!compact && (
        <div className="flex items-center gap-2">
          <FileSearch className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">
            Extraction summary
          </h4>
          {confidence !== null && (
            <span
              className={`ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full ${
                confidence >= 80
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                  : confidence >= 50
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                    : "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"
              }`}
              data-testid="extraction-confidence-badge"
            >
              {confidence}% confidence
            </span>
          )}
        </div>
      )}

      {/* Reclassification / mismatch banner (Fix 2b) */}
      {reclassified && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800 px-3 py-2 text-xs"
          data-testid="extraction-reclassified-banner"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="text-amber-900 dark:text-amber-200 leading-relaxed">
            You uploaded this as{" "}
            <span className="font-medium">{labelFor(summary.userSelectedType)}</span>{" "}
            but the document looked like{" "}
            <span className="font-medium">{labelFor(summary.detectedType)}</span>.
            We re-ran the analysis with the right template — the data below
            reflects the corrected reading.
          </div>
        </div>
      )}
      {typeMismatch && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800 px-3 py-2 text-xs"
          data-testid="extraction-typemismatch-banner"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="text-amber-900 dark:text-amber-200 leading-relaxed">
            You picked <span className="font-medium">{labelFor(summary.userSelectedType)}</span>,
            but this document looks more like{" "}
            <span className="font-medium">{labelFor(summary.detectedType)}</span>.
            If the extraction below looks wrong, retry with the corrected
            type.
          </div>
        </div>
      )}

      {/* Empty-extraction warning */}
      {empty ? (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
          <span>
            We processed the file but couldn't pull any structured data
            from it. This usually means the scan was hard to read, the
            layout was unfamiliar, or the document didn't actually
            contain the kind of data we expected.
          </span>
        </div>
      ) : (
        <>
          <div className={`grid ${compact ? "grid-cols-4 gap-2" : "grid-cols-2 sm:grid-cols-4 gap-3"} text-center`}>
            <Stat label="Biomarkers" value={biomarker} compact={compact} />
            <Stat label="Supplements" value={supplement} compact={compact} />
            <Stat label="Medications" value={medication} compact={compact} />
            <Stat label="Findings" value={keyFindingsCount} compact={compact} />
          </div>
          {Array.isArray(summary.keyFindings) && summary.keyFindings.length > 0 && (
            <div className={compact ? "" : "pt-2 border-t border-border/40"}>
              <p className={`text-[11px] uppercase tracking-wider text-muted-foreground font-medium ${compact ? "mb-1" : "mb-2"}`}>
                Key findings
              </p>
              <ul className="space-y-1 text-xs text-foreground/90">
                {summary.keyFindings
                  .filter((f): f is string => typeof f === "string")
                  .slice(0, compact ? 3 : 5)
                  .map((f, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                      <span className="leading-relaxed">{f}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Inline variant repeats confidence at the bottom because it */}
      {/* doesn't have a header to host the badge in. */}
      {compact && confidence !== null && (
        <p className="text-[10px] text-muted-foreground">
          {confidence}% extraction confidence ·{" "}
          {labelFor(summary.detectedType ?? summary.userSelectedType)}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, compact }: { label: string; value: number; compact: boolean }) {
  return (
    <div className={compact ? "" : "rounded-md bg-card px-2 py-2"}>
      <div className={`font-mono font-semibold tabular-nums ${compact ? "text-sm" : "text-lg"} text-foreground`}>
        {value}
      </div>
      <div className={`uppercase tracking-wider text-muted-foreground ${compact ? "text-[9px]" : "text-[10px]"}`}>
        {label}
      </div>
    </div>
  );
}

export { TYPE_LABELS, labelFor as labelForType };
