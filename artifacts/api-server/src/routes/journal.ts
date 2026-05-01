import { Router } from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@workspace/db";
import {
  patientsTable,
  chatConversationsTable,
  chatMessagesTable,
  supplementsTable,
  medicationsTable,
  symptomsTable,
} from "@workspace/db";
import { eq, and, desc, ilike, sql } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { validate } from "../middlewares/validate";
import { journalMessageBody } from "../lib/validators";
import { isProviderAllowed } from "../lib/consent";
import { HttpError } from "../middlewares/errorHandler";
import { z } from "zod";

/**
 * Plexara Health Journal — conversational intake.
 *
 * The Journal is a chat interface that doubles as a structured-data
 * extractor. Every assistant turn includes a `<extraction>...</extraction>`
 * JSON block; the SSE stream strips that block from the visible response
 * (so the patient sees clean prose) while the server parses it after the
 * stream completes and applies the changes to the existing structured
 * tables: `supplementsTable`, `medicationsTable`, `symptomsTable`, and
 * the `conditions` / `allergies` JSONB columns on `patientsTable`.
 *
 * No new tables — Journal data flows directly into the same surfaces the
 * lens pipeline, drug-biomarker rules engine, and symptom-correlation
 * engine already read from. Conversations are stored in the existing
 * `chat_conversations` / `chat_messages` tables, namespaced via
 * `subjectType = "journal"` so they don't leak into the Ask sidebar.
 */

const router = Router({ mergeParams: true });

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const JOURNAL_SUBJECT_TYPE = "journal";
const EXTRACTION_OPEN = "<extraction>";
const EXTRACTION_CLOSE = "</extraction>";

const JOURNAL_SYSTEM_PROMPT = `You are a health intake specialist for Plexara, a functional medicine health intelligence platform. Your role is to listen to the patient and capture everything they tell you about their health.

You have two jobs in every response:

JOB 1 — CONVERSATIONAL RESPONSE
Respond naturally, like a thoughtful doctor taking a patient history. Acknowledge what they've said, ask clarifying follow-ups when details are missing, and provide brief context when relevant. Be warm but efficient.

Examples of good follow-ups:
- "You mentioned magnesium — do you know which form? Glycinate, citrate, oxide? The form affects how well it's absorbed."
- "5000 IU of vitamin D3 — do you take it with K2? And do you take it with a meal containing fat?"
- "You've been feeling tired after meals — how long has this been going on? Does it happen with all meals or specific types of food?"
- "Crestor 10mg — how long have you been on it? Any muscle pain or fatigue since starting?"

Don't over-explain. Don't lecture. Listen, capture, clarify.

JOB 2 — STRUCTURED DATA EXTRACTION
After your conversational response, output a JSON block wrapped in <extraction> tags containing any structured data you can extract from what the patient said. Only include items you're confident about — ask for clarification rather than guessing.

<extraction>
{
  "supplements": [
    { "action": "add", "name": "Vitamin D3", "dosage": "5000 IU", "frequency": "daily", "form": "softgel", "timing": "with breakfast", "notes": null }
  ],
  "medications": [
    { "action": "add", "name": "Rosuvastatin", "brandName": "Crestor", "dosage": "10mg", "frequency": "daily", "drugClass": "statin", "notes": null }
  ],
  "symptoms": [
    { "action": "log", "name": "Post-meal fatigue", "category": "energy", "severity": 6, "duration": "3 months", "notes": "Worse after carb-heavy meals" }
  ],
  "conditions": [
    { "action": "add", "name": "Hypercholesterolaemia", "status": "active", "since": "2020" }
  ],
  "allergies": [
    { "action": "add", "substance": "Penicillin", "reaction": "Rash", "severity": "moderate" }
  ],
  "lifestyle": { "exercise": "...", "sleep": "...", "stress": "...", "diet": "..." },
  "goals": ["Optimise energy", "Longevity"],
  "notes": ["Father had heart attack at 62 — family history"]
}
</extraction>

RULES:
- Only extract data the patient explicitly stated. Never infer or assume.
- If the patient lists multiple supplements in one message, extract ALL of them.
- If a detail is ambiguous (form, dose, frequency), ask in your response rather than guessing.
- For medications, always try to identify the drug class (statin, PPI, SSRI, etc.) as this drives the intelligence layer.
- For symptoms, estimate a severity (1-10) based on how the patient describes it. Ask if unsure.
- If the patient corrects something previously captured, use action: "update" with the corrected data.
- If the patient says they stopped something, use action: "remove".
- The <extraction> block must be valid JSON. If nothing was extractable from this message, output an empty object: <extraction>{}</extraction>
- Include <extraction> in EVERY response, even if empty.

CONVERSATION STARTERS (if this is the first message and the patient hasn't said much):
Help them get going: "Tell me about your current supplements and medications, any symptoms you're experiencing, and what your health goals are. You can share as much or as little as you like — I'll capture everything and ask follow-ups where I need more detail."

Formatting:
- Reply in flowing prose paragraphs. NO inline markdown decoration: no \`**bold**\`, no \`### headers\`. Use a short markdown bullet list ONLY if the answer is genuinely a list of discrete items.`;

async function getPatient(patientId: number, userId: string) {
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return patient;
}

// ── Extraction shape ────────────────────────────────────────────────────
// Tolerant: every field optional so a stray malformed object from the LLM
// can't crash the per-action loops. We coerce per-action below.
type ExtractionAction = {
  supplements?: Array<{
    action?: string; name?: string; dosage?: string | null; frequency?: string | null;
    form?: string | null; timing?: string | null; notes?: string | null;
  }>;
  medications?: Array<{
    action?: string; name?: string; brandName?: string | null;
    dosage?: string | null; frequency?: string | null; drugClass?: string | null; notes?: string | null;
  }>;
  symptoms?: Array<{
    action?: string; name?: string; category?: string | null;
    severity?: number | null; duration?: string | null; notes?: string | null;
  }>;
  conditions?: Array<{
    action?: string; name?: string; status?: string | null; since?: string | null;
  }>;
  allergies?: Array<{
    action?: string; substance?: string; reaction?: string | null; severity?: string | null;
  }>;
  lifestyle?: { exercise?: string; sleep?: string; stress?: string; diet?: string };
  goals?: string[];
  notes?: string[];
};

/**
 * Pull the JSON object between <extraction>...</extraction>. Returns null
 * if the block is missing or unparseable — callers must treat both as
 * "nothing to apply" rather than crash, since malformed extractions
 * shouldn't break the chat experience.
 */
function parseExtractionBlock(fullText: string): ExtractionAction | null {
  const startIdx = fullText.indexOf(EXTRACTION_OPEN);
  if (startIdx === -1) return null;
  const afterOpen = startIdx + EXTRACTION_OPEN.length;
  const endIdx = fullText.indexOf(EXTRACTION_CLOSE, afterOpen);
  const raw = (endIdx === -1 ? fullText.slice(afterOpen) : fullText.slice(afterOpen, endIdx)).trim();
  if (!raw || raw === "{}") return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ExtractionAction;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Strip the <extraction>...</extraction> block from the visible assistant
 * text. This is what we persist to chat_messages so the next-turn context
 * doesn't include the JSON, and it's what the legacy JSON branch returns.
 */
function stripExtraction(text: string): string {
  const startIdx = text.indexOf(EXTRACTION_OPEN);
  if (startIdx === -1) return text;
  const endIdx = text.indexOf(EXTRACTION_CLOSE, startIdx);
  const tail = endIdx === -1 ? "" : text.slice(endIdx + EXTRACTION_CLOSE.length);
  return (text.slice(0, startIdx) + tail).trim();
}

/**
 * Apply the extracted actions to the structured tables. Each action is
 * wrapped in its own try/catch so one malformed entry doesn't poison the
 * whole batch — the patient still gets credit for the items that landed.
 *
 * Schema deltas vs the spec doc:
 *   - supplementsTable uses `name` (no `substanceName`) and `active`
 *     (no `isActive`); there is no `form` column → folded into notes.
 *   - medicationsTable uses `name` (no `drugName`/`brandName`); when both
 *     generic and brand are given we render "Generic (Brand)".
 *   - lifestyle has no dedicated column on patientsTable → captured-only.
 *   - goals & free-form notes → captured-only (no schema slot today).
 */
async function executeJournalActions(
  patientId: number,
  actions: ExtractionAction,
  log: { error: (obj: object, msg: string) => void },
): Promise<{ captured: string[] }> {
  const captured: string[] = [];
  const todayIso = new Date().toISOString().split("T")[0];

  // ── Supplements ─────────────────────────────────────────────────────
  for (const s of actions.supplements ?? []) {
    if (!s || typeof s.name !== "string" || !s.name.trim()) continue;
    const name = s.name.trim();
    const action = (s.action ?? "add").toLowerCase();
    try {
      if (action === "add" || action === "update") {
        // Fold form + timing into notes — no dedicated columns exist.
        const noteParts = [
          s.form ? `form: ${s.form}` : null,
          s.timing ? `timing: ${s.timing}` : null,
          s.notes ?? null,
        ].filter(Boolean) as string[];
        await db.insert(supplementsTable).values({
          patientId,
          name,
          dosage: s.dosage ?? null,
          frequency: s.frequency ?? null,
          notes: noteParts.length ? noteParts.join("; ") : null,
          active: true,
        });
        captured.push(`Added supplement: ${name}${s.dosage ? ` ${s.dosage}` : ""}`);
      } else if (action === "remove" || action === "stop") {
        await db
          .update(supplementsTable)
          .set({ active: false })
          .where(and(eq(supplementsTable.patientId, patientId), ilike(supplementsTable.name, `%${name}%`)));
        captured.push(`Stopped supplement: ${name}`);
      }
    } catch (err) {
      log.error({ err, name }, "Journal: supplement action failed");
    }
  }

  // ── Medications ─────────────────────────────────────────────────────
  for (const m of actions.medications ?? []) {
    if (!m || typeof m.name !== "string" || !m.name.trim()) continue;
    const generic = m.name.trim();
    const brand = m.brandName?.trim();
    // Combine generic + brand into the single `name` column.
    const displayName = brand && brand.toLowerCase() !== generic.toLowerCase()
      ? `${generic} (${brand})`
      : generic;
    const action = (m.action ?? "add").toLowerCase();
    try {
      if (action === "add" || action === "update") {
        await db.insert(medicationsTable).values({
          patientId,
          name: displayName,
          drugClass: m.drugClass ?? null,
          dosage: m.dosage ?? null,
          frequency: m.frequency ?? null,
          notes: m.notes ?? null,
          active: true,
        });
        captured.push(`Added medication: ${displayName}${m.dosage ? ` ${m.dosage}` : ""}`);
      } else if (action === "remove" || action === "stop") {
        await db
          .update(medicationsTable)
          .set({ active: false, endedAt: todayIso })
          .where(and(eq(medicationsTable.patientId, patientId), ilike(medicationsTable.name, `%${generic}%`)));
        captured.push(`Stopped medication: ${displayName}`);
      }
    } catch (err) {
      log.error({ err, name: displayName }, "Journal: medication action failed");
    }
  }

  // ── Symptoms ────────────────────────────────────────────────────────
  for (const sx of actions.symptoms ?? []) {
    if (!sx || typeof sx.name !== "string" || !sx.name.trim()) continue;
    const name = sx.name.trim();
    const action = (sx.action ?? "log").toLowerCase();
    try {
      if (action === "log" || action === "add") {
        const sevRaw = typeof sx.severity === "number" ? sx.severity : 5;
        const severity = Math.max(1, Math.min(10, Math.round(sevRaw)));
        const noteParts = [
          sx.duration ? `duration: ${sx.duration}` : null,
          sx.notes ?? null,
        ].filter(Boolean) as string[];
        await db.insert(symptomsTable).values({
          patientId,
          name,
          category: sx.category ?? "other",
          severity,
          loggedAt: todayIso,
          notes: noteParts.length ? noteParts.join("; ") : null,
        });
        captured.push(`Logged symptom: ${name} (severity ${severity})`);
      }
    } catch (err) {
      log.error({ err, name }, "Journal: symptom action failed");
    }
  }

  // ── Conditions (JSONB array on patientsTable) ───────────────────────
  const newConditions = (actions.conditions ?? [])
    .filter((c) => c && typeof c.name === "string" && c.name.trim())
    .filter((c) => (c.action ?? "add").toLowerCase() === "add")
    .map((c) => ({
      name: c.name!.trim(),
      status: c.status ?? "active",
      ...(c.since ? { since: c.since } : {}),
    }));
  if (newConditions.length > 0) {
    try {
      // Atomic JSONB append — `COALESCE(conditions, '[]') || $newJson::jsonb`
      // — to eliminate the lost-update window that a read-modify-write would
      // open if a second journal/import call landed concurrently for the
      // same patient. PostgreSQL evaluates the concat inside the row update,
      // so the outcome is correct regardless of interleaving.
      const newJson = JSON.stringify(newConditions);
      await db
        .update(patientsTable)
        .set({
          conditions: sql`COALESCE(${patientsTable.conditions}, '[]'::jsonb) || ${newJson}::jsonb`,
        })
        .where(eq(patientsTable.id, patientId));
      for (const c of newConditions) captured.push(`Added condition: ${c.name}`);
    } catch (err) {
      log.error({ err }, "Journal: conditions update failed");
    }
  }

  // ── Allergies (JSONB array on patientsTable) ────────────────────────
  const newAllergies = (actions.allergies ?? [])
    .filter((a) => a && typeof a.substance === "string" && a.substance.trim())
    .filter((a) => (a.action ?? "add").toLowerCase() === "add")
    .map((a) => ({
      substance: a.substance!.trim(),
      ...(a.reaction ? { reaction: a.reaction } : {}),
      ...(a.severity ? { severity: a.severity } : {}),
    }));
  if (newAllergies.length > 0) {
    try {
      // Same atomic-append pattern as conditions above; see comment there.
      const newJson = JSON.stringify(newAllergies);
      await db
        .update(patientsTable)
        .set({
          allergies: sql`COALESCE(${patientsTable.allergies}, '[]'::jsonb) || ${newJson}::jsonb`,
        })
        .where(eq(patientsTable.id, patientId));
      for (const a of newAllergies) captured.push(`Added allergy: ${a.substance}`);
    } catch (err) {
      log.error({ err }, "Journal: allergies update failed");
    }
  }

  // ── Lifestyle / goals / notes — no schema slot today, captured only ─
  if (actions.lifestyle && typeof actions.lifestyle === "object") {
    const fields = ["exercise", "sleep", "stress", "diet"] as const;
    const present = fields.filter((f) => typeof actions.lifestyle?.[f] === "string");
    if (present.length > 0) captured.push(`Noted lifestyle: ${present.join(", ")}`);
  }
  if (Array.isArray(actions.goals) && actions.goals.length > 0) {
    captured.push(`Noted goals: ${actions.goals.filter((g) => typeof g === "string").join(", ")}`);
  }
  for (const n of actions.notes ?? []) {
    if (typeof n === "string" && n.trim()) captured.push(`Note: ${n.trim()}`);
  }

  return { captured };
}

// ── Routes ──────────────────────────────────────────────────────────────

router.get("/conversations", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const conversations = await db
      .select()
      .from(chatConversationsTable)
      .where(and(
        eq(chatConversationsTable.patientId, patientId),
        eq(chatConversationsTable.subjectType, JOURNAL_SUBJECT_TYPE),
      ))
      .orderBy(desc(chatConversationsTable.updatedAt));
    res.json(conversations);
  } catch (err) {
    req.log.error({ err }, "Failed to load journal conversations");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/conversations/:conversationId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const conversationId = parseInt(req.params.conversationId as string);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const [conv] = await db.select().from(chatConversationsTable)
      .where(and(
        eq(chatConversationsTable.id, conversationId),
        eq(chatConversationsTable.patientId, patientId),
        eq(chatConversationsTable.subjectType, JOURNAL_SUBJECT_TYPE),
      ));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
    const messages = await db.select().from(chatMessagesTable)
      .where(eq(chatMessagesTable.conversationId, conversationId))
      .orderBy(chatMessagesTable.createdAt);
    res.json({ conversation: conv, messages });
  } catch (err) {
    req.log.error({ err }, "Failed to load journal conversation");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/message",
  requireAuth,
  validate({ body: journalMessageBody }),
  async (req, res): Promise<void> => {
    const { userId } = req as AuthenticatedRequest;
    const patientId = parseInt(req.params.patientId as string);
    const patient = await getPatient(patientId, userId);
    if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }

    // Same consent gate as the chat surface — Anthropic is the LLM that
    // sees the patient's free-text health intake. Fail closed if not granted.
    if (!(await isProviderAllowed(userId, "anthropic"))) {
      res.status(403).json({
        error: "Anthropic AI consent not granted — visit Consent & data control to enable the Journal.",
      });
      return;
    }

    const { message, conversationId } = req.body as z.infer<typeof journalMessageBody>;

    try {
      // Resolve / create the conversation. Journal threads live in the
      // shared chat_conversations table but are namespaced via
      // subjectType="journal" so they don't appear in the Ask sidebar.
      let activeConvId: number;
      if (conversationId) {
        const [conv] = await db.select().from(chatConversationsTable)
          .where(and(
            eq(chatConversationsTable.id, conversationId),
            eq(chatConversationsTable.patientId, patientId),
            eq(chatConversationsTable.subjectType, JOURNAL_SUBJECT_TYPE),
          ));
        if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
        activeConvId = conv.id;
        await db.update(chatConversationsTable)
          .set({ updatedAt: new Date() })
          .where(eq(chatConversationsTable.id, activeConvId));
      } else {
        const [conv] = await db.insert(chatConversationsTable).values({
          patientId,
          accountId: userId,
          subjectType: JOURNAL_SUBJECT_TYPE,
          subjectRef: null,
          title: message.slice(0, 80),
        }).returning();
        activeConvId = conv.id;
      }

      await db.insert(chatMessagesTable).values({
        conversationId: activeConvId,
        role: "user",
        content: message,
      });

      const history = await db.select().from(chatMessagesTable)
        .where(eq(chatMessagesTable.conversationId, activeConvId))
        .orderBy(chatMessagesTable.createdAt);

      const messages = history.slice(-20).map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));

      const model = process.env.LLM_CHAT_MODEL || process.env.LLM_RECONCILIATION_MODEL || "claude-sonnet-4-6";
      const acceptsSse = (req.headers.accept || "").includes("text/event-stream");

      if (acceptsSse) {
        // ── SSE streaming branch ───────────────────────────────────────
        // Mirrors the chat.ts event format exactly so the frontend SSE
        // parser can be reused with minimal divergence.
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();

        let aborted = false;
        const writeEvent = (payload: unknown) => {
          if (aborted || res.writableEnded) return;
          try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* socket closed */ }
        };
        const heartbeat = setInterval(() => {
          if (aborted || res.writableEnded) return;
          try { res.write(`: ping\n\n`); } catch { /* socket closed */ }
        }, 15_000);
        const stopHeartbeat = () => clearInterval(heartbeat);

        writeEvent({ type: "start", conversationId: activeConvId });

        // Streaming-strip state: we accumulate `assistantText` for
        // post-stream extraction, but emit deltas only for the prefix
        // that comes BEFORE `<extraction>`. `emitCursor` tracks how far
        // we've already streamed; once we see the open tag we stop.
        let assistantText = "";
        let emitCursor = 0;
        let suppressed = false;
        const SAFE_TAIL = EXTRACTION_OPEN.length; // hold back enough to detect a tag spanning chunks

        req.on("close", () => { aborted = true; stopHeartbeat(); });

        try {
          const stream = anthropic.messages.stream({
            model,
            max_tokens: 1500,
            system: JOURNAL_SYSTEM_PROMPT,
            messages,
          });

          for await (const event of stream) {
            if (aborted) break;
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              assistantText += event.delta.text;
              if (suppressed) continue;
              const tagIdx = assistantText.indexOf(EXTRACTION_OPEN, emitCursor);
              if (tagIdx !== -1) {
                if (tagIdx > emitCursor) {
                  writeEvent({ type: "delta", text: assistantText.slice(emitCursor, tagIdx) });
                }
                emitCursor = assistantText.length;
                suppressed = true;
              } else {
                // Hold back the last SAFE_TAIL characters so a tag split
                // across chunks doesn't slip through unstripped.
                const safeEnd = Math.max(emitCursor, assistantText.length - SAFE_TAIL);
                if (safeEnd > emitCursor) {
                  writeEvent({ type: "delta", text: assistantText.slice(emitCursor, safeEnd) });
                  emitCursor = safeEnd;
                }
              }
            }
          }
        } catch (streamErr) {
          req.log.error({ err: streamErr }, "Journal stream failed");
          writeEvent({ type: "error", error: "stream_failed" });
        } finally {
          stopHeartbeat();
        }

        // If the stream finished without ever seeing <extraction>, emit
        // any remaining held-back tail.
        if (!suppressed && emitCursor < assistantText.length) {
          writeEvent({ type: "delta", text: assistantText.slice(emitCursor) });
          emitCursor = assistantText.length;
        }

        // Persist the cleaned visible text (without the JSON block).
        const visibleText = stripExtraction(assistantText);
        let assistantMsg: typeof chatMessagesTable.$inferSelect | undefined;
        if (visibleText.length > 0) {
          const [row] = await db.insert(chatMessagesTable).values({
            conversationId: activeConvId,
            role: "assistant",
            content: visibleText,
          }).returning();
          assistantMsg = row;
        }

        // Parse + apply the extraction. Errors here must NOT leak through
        // the SSE stream as a fatal — we still want the patient's message
        // and visible reply persisted even if extraction blows up.
        let captured: string[] = [];
        try {
          const parsed = parseExtractionBlock(assistantText);
          if (parsed) {
            const result = await executeJournalActions(patientId, parsed, req.log);
            captured = result.captured;
          }
        } catch (extractErr) {
          req.log.error({ err: extractErr }, "Journal: extraction apply failed");
        }

        if (!aborted) {
          writeEvent({
            type: "done",
            conversationId: activeConvId,
            message: assistantMsg ?? null,
            captured,
          });
          res.end();
        }
        return;
      }

      // ── Legacy JSON branch ────────────────────────────────────────────
      const completion = await anthropic.messages.create({
        model,
        max_tokens: 1500,
        system: JOURNAL_SYSTEM_PROMPT,
        messages,
      });
      const fullText = completion.content[0]?.type === "text" ? completion.content[0].text : "";
      const visibleText = stripExtraction(fullText);

      const [assistantMsg] = await db.insert(chatMessagesTable).values({
        conversationId: activeConvId,
        role: "assistant",
        content: visibleText.length > 0 ? visibleText : "(no response)",
      }).returning();

      let captured: string[] = [];
      try {
        const parsed = parseExtractionBlock(fullText);
        if (parsed) {
          const result = await executeJournalActions(patientId, parsed, req.log);
          captured = result.captured;
        }
      } catch (extractErr) {
        req.log.error({ err: extractErr }, "Journal: extraction apply failed (json branch)");
      }

      res.json({ conversationId: activeConvId, message: assistantMsg, captured });
    } catch (err) {
      req.log.error({ err }, "Journal message failed");
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate response" });
      } else {
        try { res.end(); } catch { /* already closed */ }
      }
    }
  },
);

router.delete("/conversations/:conversationId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const conversationId = parseInt(req.params.conversationId as string);
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const [conv] = await db.select().from(chatConversationsTable)
      .where(and(
        eq(chatConversationsTable.id, conversationId),
        eq(chatConversationsTable.patientId, patientId),
        eq(chatConversationsTable.subjectType, JOURNAL_SUBJECT_TYPE),
      ));
    if (!conv) { res.status(204).send(); return; }
    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.conversationId, conversationId));
    await db.delete(chatConversationsTable).where(eq(chatConversationsTable.id, conversationId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete journal conversation");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Bulk-import via paste / photo / file ───────────────────────────────
// `POST /import-list` accepts a single `file` (text, PDF, or image) up to
// 10 MB. Mirrors `lib/supplements-import.ts`'s vision pattern, but uses
// the Journal extraction prompt so supplements + medications + symptoms
// can all land from a single photo of a patient's regimen list.
//
// Pipeline:
//   1. Multer captures the file in memory (no disk path → no cleanup).
//   2. Consent gate (Anthropic).
//   3. Vision call for image/pdf, text call for text/csv/plain.
//   4. Same `<extraction>` parsing + `executeJournalActions` flow as chat.
//   5. Returns `{ captured: string[] }` so the UI can render confirmation.
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB cap
    files: 1,
    fields: 5,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "text/plain",
      "text/csv",
    ]);
    if (allowed.has(file.mimetype)) cb(null, true);
    // HttpError (not a bare Error) so the central errorHandler returns a
    // proper 400 instead of the generic 500 path. Mirrors records-upload.ts.
    else cb(new HttpError(400, `File type not allowed: ${file.mimetype}. Accepted: PDF, JPEG, PNG, WebP, GIF, TXT, CSV`));
  },
});

const IMPORT_INSTRUCTIONS = `The following is a patient-provided list of supplements, medications, and possibly symptoms or conditions. Extract every item you can identify and return ONLY the <extraction> JSON block in the format defined in your system prompt. You may include a one-sentence acknowledgement before the block (e.g. "Captured 12 items from your list."), but the bulk of the response must be the JSON.`;

router.post(
  "/import-list",
  requireAuth,
  importUpload.single("file"),
  async (req, res): Promise<void> => {
    const { userId } = req as AuthenticatedRequest;
    const patientId = parseInt(req.params.patientId as string);
    const patient = await getPatient(patientId, userId);
    if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded. Send a single 'file' field." });
      return;
    }
    if (!(await isProviderAllowed(userId, "anthropic"))) {
      res.status(403).json({
        error: "Anthropic AI consent not granted — visit Consent & data control to enable list import.",
      });
      return;
    }

    const mimeType = req.file.mimetype;
    const buf = req.file.buffer;
    const isPdf = mimeType === "application/pdf";
    const isImage = mimeType.startsWith("image/");
    const isText = mimeType === "text/plain" || mimeType === "text/csv";

    try {
      const model = process.env.LLM_CHAT_MODEL || process.env.LLM_RECONCILIATION_MODEL || "claude-sonnet-4-6";

      let userContent:
        | string
        | Array<
            | { type: "text"; text: string }
            | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string } }
            | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
          >;

      if (isText) {
        // Cap textual payloads so we don't blow past the model's context
        // window on a runaway file. 40k chars is plenty for any realistic
        // supplement / medication list.
        const text = buf.toString("utf8").slice(0, 40_000);
        userContent = `${IMPORT_INSTRUCTIONS}\n\nList contents:\n\n${text}`;
      } else if (isPdf) {
        userContent = [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
          { type: "text", text: IMPORT_INSTRUCTIONS },
        ];
      } else if (isImage) {
        const media = mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
        userContent = [
          { type: "image", source: { type: "base64", media_type: media, data: buf.toString("base64") } },
          { type: "text", text: IMPORT_INSTRUCTIONS },
        ];
      } else {
        res.status(400).json({ error: `Unsupported MIME type: ${mimeType}` });
        return;
      }

      const completion = await anthropic.messages.create({
        model,
        max_tokens: 3000,
        system: JOURNAL_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      });

      const fullText = completion.content[0]?.type === "text" ? completion.content[0].text : "";
      const parsed = parseExtractionBlock(fullText);
      if (!parsed) {
        res.status(422).json({
          error: "Could not extract any items from the uploaded file. Try a clearer photo or paste the list as text.",
          captured: [],
        });
        return;
      }

      const { captured } = await executeJournalActions(patientId, parsed, req.log);
      res.json({ captured, summary: stripExtraction(fullText) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to parse uploaded list";
      req.log.error({ err, mimeType }, "Journal: import-list failed");
      res.status(500).json({ error: msg });
    }
  },
);

export default router;
