import {
  anthropic,
  LLM_MODELS,
  parseJSONFromLLM,
} from "./llm-client";
import { logger } from "./logger";

export function buildExtractionPrompt(recordType: string): string {
  const t = (recordType || "blood_panel").toLowerCase();
  if (t.includes("imaging") || t.includes("mri") || t.includes("scan") || t.includes("xray") || t.includes("ct") || t.includes("ultrasound")) {
    return `You are a medical imaging extraction specialist. Extract structured data from this imaging report. Anonymise patient name as [PATIENT], facility as [FACILITY], radiologist as [PHYSICIAN].

Return valid JSON only:
{
  "documentType": "imaging",
  "modality": "MRI|CT|XRAY|ULTRASOUND|PET|OTHER",
  "bodyRegion": "string",
  "studyDate": "YYYY-MM-DD or null",
  "technique": "string",
  "findings": [
    { "region": "string", "description": "string", "measurementMm": number or null, "severity": "normal|mild|moderate|severe|incidental", "confidence": "high|medium|low" }
  ],
  "impression": "string",
  "comparedTo": "string or null",
  "biomarkers": [],
  "extractionNotes": "string"
}`;
  }
  // Pharmacogenomics / pharmacokinetics reports (drug-gene interaction
  // profiles such as AttoDiagnostics, OneOme, Genomind, GenoPharm, etc.).
  // MUST be matched BEFORE the broader "genetic" branch — these documents
  // are structured around drug-gene pairs, not biomarkers, and the generic
  // genetics prompt would lose all the medication-interaction tables.
  if (t.includes("pharmacogen") || t.includes("pgx") || t.includes("pharmacokinetic") || t.includes("drug-gene") || t.includes("cyp")) {
    return `You are a pharmacogenomics extraction specialist. Extract ALL drug-gene interaction data from this report.

Return valid JSON only:
{
  "documentType": "pharmacogenomics",
  "phenotypeTable": [
    {
      "gene": "string (e.g. CYP2D6, CYP2C19, SLCO1B1, APOE, TPMT, DPYD)",
      "genotypeResult": "string (e.g. *1/*3, *1/*2, E3/E3)",
      "activityScore": number or null,
      "phenotype": "string (e.g. Intermediate Metabolizer, Normal Metabolizer, Poor Metabolizer)"
    }
  ],
  "medicationInteractions": [
    {
      "drugName": "string",
      "brandNames": ["string"],
      "gene": "string",
      "phenotype": "string",
      "severity": 1,
      "recommendation": "string (the CPIC/FDA/DPWG clinical recommendation)",
      "source": "string (e.g. CPIC A, FDA 1, DPWG, PharmGKB 2A)"
    }
  ],
  "seriousInteractions": [
    {
      "drugName": "string",
      "recommendation": "string",
      "reason": "string"
    }
  ],
  "laboratoryResults": [
    {
      "gene": "string",
      "rsid": "string",
      "result": "string"
    }
  ],
  "specimenDetails": {
    "barcode": "string or null",
    "type": "string or null",
    "collected": "string date or null",
    "generated": "string date or null"
  },
  "biomarkers": [],
  "extractionNotes": "string"
}

CRITICAL INSTRUCTIONS:
- This is a pharmacogenomics report, NOT a standard blood panel. Do NOT look for biomarker values.
- Focus on extracting the Phenotype Table, Medication Summary, and individual drug-gene interactions.
- Severity: 1 = mild, 2 = moderate, 3 = serious. For severity 3, extract the full avoid/alternative recommendation. For severity 2, extract the dosing adjustment recommendation.
- Extract ALL laboratory results (gene, rsID, result) from the Laboratory Report section.
- The document may be 30-50 pages. Process ALL pages — do not stop at page 10 or 20.
- Anonymise: replace patient name with [PATIENT], DOB with [DOB], facility with [FACILITY].
- Return ONLY valid JSON. No markdown, no preamble.`;
  }
  if (t.includes("genetic") || t.includes("dna") || t.includes("epigen") || t.includes("methylation")) {
    return `You are a genetics/epigenomics extraction specialist. Extract structured data from this report. Do not include patient name.

Return valid JSON only:
{
  "documentType": "genetics",
  "panel": "string",
  "testDate": "YYYY-MM-DD or null",
  "variants": [
    { "gene": "string", "variant": "string", "zygosity": "homozygous|heterozygous|hemizygous|null", "clinicalSignificance": "benign|likely_benign|uncertain|likely_pathogenic|pathogenic", "phenotypeAssociations": ["string"] }
  ],
  "riskScores": [
    { "condition": "string", "score": number or null, "interpretation": "string" }
  ],
  "methylationAge": number or null,
  "biomarkers": [],
  "extractionNotes": "string"
}`;
  }
  if (t.includes("wearable") || t.includes("fitbit") || t.includes("oura") || t.includes("garmin") || t.includes("apple_health") || t.includes("whoop")) {
    return `You are a wearable data extraction specialist. Extract aggregated metrics from this wearable export. Anonymise device as [DEVICE].

Return valid JSON only:
{
  "documentType": "wearable",
  "device": "[DEVICE]",
  "rangeStart": "YYYY-MM-DD or null",
  "rangeEnd": "YYYY-MM-DD or null",
  "metrics": [
    { "name": "resting_heart_rate|hrv|vo2max|sleep_score|deep_sleep_min|rem_sleep_min|steps|active_minutes|spo2|skin_temp", "average": number or null, "unit": "string", "trend": "improving|stable|declining" }
  ],
  "biomarkers": [],
  "extractionNotes": "string"
}`;
  }
  return `You are a medical document extraction specialist. Extract ALL data points from this blood panel into structured JSON. Anonymise lab name as [LAB], physician as [PHYSICIAN], patient name as [PATIENT].

Return valid JSON only:
{
  "documentType": "blood_panel",
  "testDate": "YYYY-MM-DD or null",
  "drawTime": "HH:MM in 24h format, or null if absent. Look for 'Collection Time', 'Drawn at', 'Specimen Collected', 'Time Collected'.",
  "labName": "[LAB]",
  "biomarkers": [
    {
      "name": "string",
      "value": number or null,
      "unit": "string",
      "labRefLow": number or null,
      "labRefHigh": number or null,
      "category": "CBC|Metabolic|Lipid|Thyroid|Hormonal|Inflammatory|Vitamins|Metabolic Health|Liver|Kidney|Cardiac|Other",
      "methodology": "string or null — assay technique reported on the report (e.g. 'LC-MS/MS', 'immunoassay', 'ELISA', 'HPLC', 'spectrophotometry', 'electrochemiluminescence'). Look near the biomarker name, in a Methodology/Method/Assay column, or in panel footnotes. Critical for testosterone, vitamin D, cortisol, thyroid panels.",
      "flagged": boolean,
      "confidence": "high|medium|low"
    }
  ],
  "otherFindings": {},
  "extractionNotes": "string"
}`;
}

export async function extractFromDocument(base64File: string, mimeType: string, recordType: string = "blood_panel"): Promise<Record<string, unknown>> {
  const extractionPrompt = buildExtractionPrompt(recordType);

  try {
    const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
    type ImageType = typeof imageTypes[number];

    // Pharmacogenomics reports can run 30-50 pages of dense drug-gene
    // tables, so extraction needs more output tokens than a typical blood
    // panel and a longer wall-clock budget for large PDFs. The threshold
    // below uses base64-encoded length (≈ 1.37× raw bytes) to estimate
    // when to switch to the extended timeout.
    const LARGE_DOC_BASE64_THRESHOLD = Math.floor(2 * 1024 * 1024 * 1.37); // ~2 MB raw
    const isLargeDocument = base64File.length > LARGE_DOC_BASE64_THRESHOLD;
    const extractionTimeout = isLargeDocument ? 120_000 : 60_000;
    const extractionMaxTokens = 16384;

    if (imageTypes.includes(mimeType as ImageType)) {
      const message = await anthropic.messages.create(
        {
          model: LLM_MODELS.extraction,
          max_tokens: extractionMaxTokens,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mimeType as ImageType,
                    data: base64File,
                  },
                },
                { type: "text", text: extractionPrompt },
              ],
            },
          ],
        },
        { timeout: extractionTimeout },
      );
      const text = message.content[0].type === "text" ? message.content[0].text : "";
      return parseJSONFromLLM(text) as Record<string, unknown>;
    } else if (mimeType === "application/pdf") {
      // Anthropic native PDF support — model receives both visual and text layers.
      const message = await anthropic.messages.create(
        {
          model: LLM_MODELS.extraction,
          max_tokens: extractionMaxTokens,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: base64File,
                  },
                },
                { type: "text", text: extractionPrompt },
              ],
            },
          ],
        },
        { timeout: extractionTimeout },
      );
      const text = message.content[0]?.type === "text" ? message.content[0].text : "";
      return parseJSONFromLLM(text) as Record<string, unknown>;
    } else if (
      mimeType.startsWith("text/") ||
      mimeType === "application/json" ||
      mimeType === "application/csv" ||
      mimeType === "application/xml"
    ) {
      // Plain text / structured exports (e.g. wearable CSV/JSON, lab text dumps).
      let decoded = "";
      try {
        decoded = Buffer.from(base64File, "base64").toString("utf-8");
      } catch {
        decoded = "";
      }
      const truncated = decoded.length > 60000 ? decoded.slice(0, 60000) + "\n…[truncated]" : decoded;
      const message = await anthropic.messages.create({
        model: LLM_MODELS.extraction,
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: `${extractionPrompt}\n\nThe document content (${mimeType}) is provided below verbatim. Extract from this text only — do not invent values.\n\n----- DOCUMENT START -----\n${truncated}\n----- DOCUMENT END -----`,
          },
        ],
      });
      const text = message.content[0]?.type === "text" ? message.content[0].text : "";
      return parseJSONFromLLM(text) as Record<string, unknown>;
    } else {
      logger.warn({ mimeType }, "Unsupported document MIME type for extraction");
      return {
        extractionError: true,
        note: `Unsupported file type: ${mimeType}. Supported formats: JPG, PNG, WebP, GIF, PDF, plain text, JSON, CSV, XML.`,
      };
    }
  } catch (err) {
    logger.error({ err }, "Failed to extract from document");
    return { extractionError: true, note: "Extraction failed" };
  }
}
