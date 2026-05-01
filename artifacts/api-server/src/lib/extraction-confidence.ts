// Enhancement E4 — Parse the optional `extractionConfidence` block that the
// extraction LLM appends to its JSON output (see EXTRACTION_CONFIDENCE_POSTSCRIPT
// in `./extraction.ts`). Mapping is tolerant: missing or malformed input yields
// the default "everything looked fine" payload so existing callers never break.

export type LowConfidenceItem = { name: string; reason: string };
export type ExtractionConfidence = {
  overall: number;
  lowConfidenceItems: LowConfidenceItem[];
};

const DEFAULT_CONFIDENCE: ExtractionConfidence = { overall: 100, lowConfidenceItems: [] };

export function parseExtractionConfidence(structured: unknown): ExtractionConfidence {
  if (!structured || typeof structured !== "object") return { ...DEFAULT_CONFIDENCE };
  const raw = (structured as Record<string, unknown>).extractionConfidence;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIDENCE };

  const obj = raw as Record<string, unknown>;
  const overallRaw = typeof obj.overall === "number" ? obj.overall : Number(obj.overall);
  const overall = Number.isFinite(overallRaw) ? Math.max(0, Math.min(100, Math.round(overallRaw))) : 100;

  const itemsRaw = Array.isArray(obj.lowConfidenceItems) ? obj.lowConfidenceItems : [];
  const lowConfidenceItems: LowConfidenceItem[] = [];
  for (const it of itemsRaw) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : null;
    const reason = typeof r.reason === "string" ? r.reason : null;
    if (name && reason) lowConfidenceItems.push({ name, reason });
  }
  return { overall, lowConfidenceItems };
}

// Map numeric overall confidence to the existing text bucket stored on
// `extracted_data.extraction_confidence`. Existing readers that still expect
// the legacy "high"/"medium"/"low" string keep working.
export function bucketConfidence(overall: number): "high" | "medium" | "low" {
  if (overall >= 80) return "high";
  if (overall >= 60) return "medium";
  return "low";
}
