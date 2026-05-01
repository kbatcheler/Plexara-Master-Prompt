import fs from "fs";
import * as XLSX from "xlsx";
import { anthropic, LLM_MODELS, withLLMRetry, parseJSONFromLLM } from "./llm-client";
import { isProviderAllowed } from "./consent";
import { logger } from "./logger";

export type ParsedSupplement = {
  name: string;
  dosage?: string | null;
  frequency?: string | null;
};

const PROMPT = `You are extracting a list of dietary supplements from a user-provided document
(text, spreadsheet contents, OCR'd PDF, or photo of a list).

Return STRICT JSON of the form:
{
  "items": [
    { "name": "Vitamin D3", "dosage": "5000 IU", "frequency": "daily" },
    { "name": "Omega-3 Fish Oil", "dosage": "2 g", "frequency": "twice daily" }
  ]
}

Rules:
- "name" is required and must be the canonical supplement name (e.g. "Vitamin D3", "Magnesium Glycinate", "Omega-3 Fish Oil"). Strip brand names unless that's all you can see.
- "dosage" is the strength + unit only (e.g. "5000 IU", "500 mg", "2 g"). Omit if unknown.
- "frequency" describes when/how often (e.g. "daily", "twice daily", "with breakfast", "3x/week"). Omit if unknown.
- Skip prescription medications, foods, blank rows, headings, totals, or anything that is not a dietary supplement / vitamin / mineral / herb.
- De-duplicate near-identical entries.
- If you cannot find any supplements, return { "items": [] }.
- Output JSON ONLY — no prose, no markdown fences.`;

/**
 * Read a non-image, non-PDF file as plain text suitable for the LLM. Handles
 * the common "I have my supplement list in a spreadsheet/CSV/text file" cases.
 *
 * Returns trimmed text. Throws on unsupported types — the caller decides
 * whether to fall through to the vision path (PDF / image).
 */
export function extractTextFromFile(filePath: string, mimeType: string): string {
  if (mimeType === "text/plain" || mimeType === "text/csv" || mimeType === "application/json") {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.trim();
  }
  if (
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.oasis.opendocument.spreadsheet"
  ) {
    const wb = XLSX.readFile(filePath, { cellDates: true });
    const lines: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      if (csv.trim().length > 0) {
        lines.push(`# Sheet: ${sheetName}`);
        lines.push(csv.trim());
      }
    }
    return lines.join("\n").trim();
  }
  throw new Error(`Unsupported text-extraction MIME type: ${mimeType}`);
}

/**
 * LLM call to convert raw extracted text into a structured supplement list.
 * Requires Anthropic consent for the patient's account; throws otherwise so
 * the route can return a clear error.
 */
export async function parseSupplementsFromText(
  text: string,
  accountId: string,
): Promise<ParsedSupplement[]> {
  if (!(await isProviderAllowed(accountId, "anthropic"))) {
    throw new Error("Anthropic provider consent required to parse uploaded supplement list");
  }
  if (text.trim().length === 0) return [];

  // Truncate to keep context bounded — supplement lists are tiny by nature.
  const truncated = text.slice(0, 24_000);

  const message = await withLLMRetry("supplements-import-text", () =>
    anthropic.messages.create({
      model: LLM_MODELS.utility,
      max_tokens: 2000,
      system: PROMPT,
      messages: [
        {
          role: "user",
          content: `Document contents:\n\n${truncated}`,
        },
      ],
    }),
  );

  const part = message.content[0];
  const responseText = part && part.type === "text" ? part.text : "";
  return normaliseItems(parseJSONFromLLM(responseText));
}

/**
 * LLM vision call for PDFs / images of supplement lists. Same consent gate
 * and same JSON contract as the text path.
 */
export async function parseSupplementsFromImage(
  base64: string,
  mimeType: string,
  accountId: string,
): Promise<ParsedSupplement[]> {
  if (!(await isProviderAllowed(accountId, "anthropic"))) {
    throw new Error("Anthropic provider consent required to parse uploaded supplement list");
  }

  // Anthropic's image content blocks use these media types directly.
  const allowedImageTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ]);
  const isPdf = mimeType === "application/pdf";
  const isImage = allowedImageTypes.has(mimeType);
  if (!isPdf && !isImage) {
    throw new Error(`Unsupported vision MIME type: ${mimeType}`);
  }

  const sourceBlock = isPdf
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
    : {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: base64,
        },
      };

  const message = await withLLMRetry("supplements-import-vision", () =>
    anthropic.messages.create({
      model: LLM_MODELS.utility,
      max_tokens: 2000,
      system: PROMPT,
      messages: [
        {
          role: "user",
          content: [
            sourceBlock,
            { type: "text" as const, text: "Extract the supplement list from the document above." },
          ],
        },
      ],
    }),
  );

  const part = message.content[0];
  const responseText = part && part.type === "text" ? part.text : "";
  return normaliseItems(parseJSONFromLLM(responseText));
}

function normaliseItems(parsed: unknown): ParsedSupplement[] {
  if (!parsed || typeof parsed !== "object") return [];
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: ParsedSupplement[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const dosage = typeof r.dosage === "string" && r.dosage.trim().length > 0 ? r.dosage.trim() : null;
    const frequency =
      typeof r.frequency === "string" && r.frequency.trim().length > 0 ? r.frequency.trim() : null;
    out.push({ name, dosage, frequency });
    if (out.length >= 100) break; // hard cap — defence against runaway LLM output
  }
  logger.info({ component: "supplements-import", count: out.length }, "Parsed supplement list");
  return out;
}
