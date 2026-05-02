/**
 * Verification spec (Fix 3a) — derive a patient-facing contribution
 * status for an uploaded record.
 *
 * The "status" column on a record only tells you whether the pipeline
 * RAN. It cannot answer the question the user actually wants answered:
 * "is this file actively contributing to my health intelligence, or did
 * it land with a thud?". A record can be `complete` and yet have
 * extracted zero biomarkers / supplements / medications (e.g. a cropped
 * screenshot the OCR layer couldn't make sense of) — in which case the
 * file is on disk but it's not feeding any downstream gauge, alert,
 * lens, or report. Surfacing this distinction is the entire point of
 * the My Data audit page (Fix 3b) and the Dashboard completeness pill
 * (Fix 3c).
 *
 * Pure function — no I/O, safe to call from any route or worker.
 */

export type ContributionStatusKind =
  | "contributing"
  | "partial"
  | "not_contributing"
  | "processing"
  | "error";

export interface ContributionStatus {
  status: ContributionStatusKind;
  reason: string;
}

export interface ExtractionSummaryShape {
  biomarkerCount?: number;
  supplementCount?: number;
  medicationCount?: number;
  keyFindingsCount?: number;
  confidence?: number | null;
  detectedType?: string | null;
  userSelectedType?: string | null;
  typeMatch?: boolean;
  reclassified?: boolean;
}

export function getContributionStatus(
  recordStatus: string | null | undefined,
  extractionSummary: unknown,
): ContributionStatus {
  if (recordStatus === "error") {
    return { status: "error", reason: "Extraction failed" };
  }
  if (recordStatus === "consent_blocked") {
    return { status: "error", reason: "AI consent missing" };
  }
  if (recordStatus === "processing" || recordStatus === "pending") {
    return { status: "processing", reason: "Still processing" };
  }

  // Status === "complete" past this point — but a complete row can still
  // be "not contributing" if extraction yielded nothing.
  if (!extractionSummary || typeof extractionSummary !== "object") {
    return { status: "not_contributing", reason: "No data extracted" };
  }

  const summary = extractionSummary as ExtractionSummaryShape;
  const biomarker = summary.biomarkerCount ?? 0;
  const supplement = summary.supplementCount ?? 0;
  const medication = summary.medicationCount ?? 0;
  const keyFindings = summary.keyFindingsCount ?? 0;
  // keyFindings count for non-biomarker docs (imaging, dexa, cancer
  // screening) so an imaging report with 4 findings still counts as
  // contributing even if it has zero biomarker rows.
  const total = biomarker + supplement + medication + keyFindings;

  if (total === 0) {
    return {
      status: "not_contributing",
      reason: "Document processed but no structured data found",
    };
  }

  const confidence = typeof summary.confidence === "number" ? summary.confidence : null;
  if (confidence !== null && confidence < 50) {
    return {
      status: "partial",
      reason: `Low confidence extraction (${Math.round(confidence)}%)`,
    };
  }

  // Build a human-readable "what's contributing" string. Prefer the
  // dominant data type so the line reads naturally per record kind.
  const parts: string[] = [];
  if (biomarker > 0) parts.push(`${biomarker} biomarker${biomarker === 1 ? "" : "s"}`);
  if (supplement > 0) parts.push(`${supplement} supplement${supplement === 1 ? "" : "s"}`);
  if (medication > 0) parts.push(`${medication} medication${medication === 1 ? "" : "s"}`);
  if (parts.length === 0 && keyFindings > 0) {
    parts.push(`${keyFindings} key finding${keyFindings === 1 ? "" : "s"}`);
  }

  return {
    status: "contributing",
    reason: parts.length > 0 ? parts.join(" · ") : `${total} data points extracted`,
  };
}
