import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@workspace/db";
import {
  patientsTable,
  chatConversationsTable,
  chatMessagesTable,
  interpretationsTable,
  biomarkerResultsTable,
  biomarkerReferenceTable,
  gaugesTable,
  predictionsTable,
  supplementsTable,
} from "@workspace/db";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { decryptJson } from "../lib/phi-crypto";
import { validate } from "../middlewares/validate";
import { chatBody } from "../lib/validators";
import { isProviderAllowed } from "../lib/consent";
import { z } from "zod";

const router = Router({ mergeParams: true });

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

async function getPatient(patientId: number, userId: string) {
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
  return patient;
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const conversations = await db
      .select()
      .from(chatConversationsTable)
      .where(eq(chatConversationsTable.patientId, patientId))
      .orderBy(desc(chatConversationsTable.updatedAt));
    res.json(conversations);
  } catch (err) {
    req.log.error({ err }, "Failed to load conversations");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:conversationId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const conversationId = parseInt((req.params.conversationId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const [conv] = await db.select().from(chatConversationsTable)
      .where(and(eq(chatConversationsTable.id, conversationId), eq(chatConversationsTable.patientId, patientId)));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
    const messages = await db.select().from(chatMessagesTable)
      .where(eq(chatMessagesTable.conversationId, conversationId))
      .orderBy(chatMessagesTable.createdAt);
    res.json({ conversation: conv, messages });
  } catch (err) {
    req.log.error({ err }, "Failed to load conversation");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireAuth, validate({ body: chatBody }), async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }

  // Chat enrichment sends biomarker history, predictions, and reconciled
  // interpretations (PHI) to Anthropic. Gate on the same consent flag the
  // interpretation/report pipelines use; fail closed if the account has not
  // granted Anthropic access.
  if (!(await isProviderAllowed(userId, "anthropic"))) {
    res.status(403).json({
      error: "Anthropic AI consent not granted — visit Consent & data control to enable AI chat.",
    });
    return;
  }

  const { question, subjectType, subjectRef, conversationId } = req.body as z.infer<typeof chatBody>;

  try {
    const [latest] = await db.select().from(interpretationsTable)
      .where(and(eq(interpretationsTable.patientId, patientId), isNotNull(interpretationsTable.reconciledOutput)))
      .orderBy(desc(interpretationsTable.createdAt))
      .limit(1);
    const biomarkers = await db.select().from(biomarkerResultsTable)
      .where(eq(biomarkerResultsTable.patientId, patientId))
      .orderBy(desc(biomarkerResultsTable.createdAt))
      .limit(50);
    const gauges = await db.select().from(gaugesTable).where(eq(gaugesTable.patientId, patientId));

    // ── Subject-specific enrichment ──────────────────────────────────────
    // When the user asks about a specific biomarker / gauge / supplement,
    // pull richer targeted data so the LLM can ground its answer in actual
    // history, reference ranges, and predicted trajectories rather than
    // only the recent-50-biomarker summary block.
    let subjectContext: Record<string, unknown> = {};

    if (subjectType === "biomarker" && subjectRef) {
      const history = await db.select().from(biomarkerResultsTable)
        .where(and(
          eq(biomarkerResultsTable.patientId, patientId),
          eq(biomarkerResultsTable.biomarkerName, subjectRef),
        ))
        .orderBy(biomarkerResultsTable.testDate);

      const [ref] = await db.select().from(biomarkerReferenceTable)
        .where(eq(biomarkerReferenceTable.biomarkerName, subjectRef));

      const [prediction] = await db.select().from(predictionsTable)
        .where(and(
          eq(predictionsTable.patientId, patientId),
          eq(predictionsTable.biomarkerName, subjectRef),
        ));

      subjectContext = {
        biomarkerHistory: history.map((h) => ({
          value: h.value, unit: h.unit, date: h.testDate,
          optimalLow: h.optimalRangeLow, optimalHigh: h.optimalRangeHigh,
        })),
        reference: ref ? {
          clinicalRangeLow: ref.clinicalRangeLow, clinicalRangeHigh: ref.clinicalRangeHigh,
          optimalRangeLow: ref.optimalRangeLow, optimalRangeHigh: ref.optimalRangeHigh,
          description: ref.description, clinicalSignificance: ref.clinicalSignificance,
        } : null,
        prediction: prediction ? {
          slopePerDay: prediction.slopePerDay,
          projection6mo: prediction.projection6mo,
          projection12mo: prediction.projection12mo,
          optimalCrossingDate: prediction.optimalCrossingDate,
        } : null,
      };
    }

    if (subjectType === "gauge" && subjectRef) {
      const [gauge] = await db.select().from(gaugesTable)
        .where(and(
          eq(gaugesTable.patientId, patientId),
          eq(gaugesTable.domain, subjectRef),
        ));
      subjectContext = { gauge, domainName: subjectRef };
    }

    if (subjectType === "supplement" && subjectRef) {
      // The supplements table uses (name, dosage, frequency, startedAt, active) —
      // surface the patient's current regimen so the LLM can reason about
      // dosing, timing and active vs discontinued items when answering.
      const supplements = await db.select().from(supplementsTable)
        .where(eq(supplementsTable.patientId, patientId));
      subjectContext = {
        supplements: supplements.map((s) => ({
          name: s.name, dosage: s.dosage, frequency: s.frequency,
          isActive: s.active, startedAt: s.startedAt,
        })),
      };
    }

    const contextBlock = JSON.stringify({
      reconciled: decryptJson(latest?.reconciledOutput) ?? null,
      gauges: gauges.map((g) => ({ domain: g.domain, value: g.currentValue, trend: g.trend, label: g.label })),
      recentBiomarkers: biomarkers.map((b) => ({
        name: b.biomarkerName,
        value: b.value,
        unit: b.unit,
        testDate: b.testDate,
        optimalLow: b.optimalRangeLow,
        optimalHigh: b.optimalRangeHigh,
      })),
      subjectType: subjectType ?? "general",
      subjectRef: subjectRef ?? null,
      // Include enriched subject-specific data when present. Cap at 40k chars
      // to leave headroom for the system prompt + chat history within the
      // model's context window.
      subjectDetail: Object.keys(subjectContext).length > 0 ? subjectContext : undefined,
    }, null, 2).slice(0, 40000);

    let activeConvId: number;
    if (conversationId) {
      const [conv] = await db.select().from(chatConversationsTable)
        .where(and(eq(chatConversationsTable.id, conversationId), eq(chatConversationsTable.patientId, patientId)));
      if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
      activeConvId = conv.id;
      await db.update(chatConversationsTable).set({ updatedAt: new Date() }).where(eq(chatConversationsTable.id, activeConvId));
    } else {
      const [conv] = await db.insert(chatConversationsTable).values({
        patientId,
        accountId: userId,
        subjectType: subjectType ?? "general",
        subjectRef: subjectRef ?? null,
        title: question.slice(0, 80),
      }).returning();
      activeConvId = conv.id;
    }

    await db.insert(chatMessagesTable).values({ conversationId: activeConvId, role: "user", content: question });

    const history = await db.select().from(chatMessagesTable)
      .where(eq(chatMessagesTable.conversationId, activeConvId))
      .orderBy(chatMessagesTable.createdAt);

    const messages = history.slice(-20).map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    }));

    const system = `You are a clinical reasoning assistant for a patient using Plexara, a personal health intelligence platform. You may receive an anonymised data payload describing the patient's most recent reconciled interpretation, gauge readings, and biomarker history. Use ONLY this data plus general medical knowledge.

Rules:
- Never claim to diagnose. You provide educational interpretation.
- Cite specific biomarker names and values when referenced.
- If asked about a specific finding (subjectType + subjectRef), focus on that. You may have detailed history, predictions, and reference data for it in the subjectDetail field — use ALL of it. Reference specific values and trends. If predictions show a concerning trajectory, mention it.
- When the subject is a biomarker, compare the patient's values to both clinical normal AND optimal ranges. Note the trajectory if available. Suggest what might improve the trajectory if relevant.
- Be concise (max 250 words). Use plain English unless the user asks for clinical detail.
- If data is insufficient, say so and suggest what additional record would help.
- Never invent values; if a biomarker isn't in the payload, say it is not available.

Formatting:
- Reply in flowing prose paragraphs. NO inline markdown decoration: no \`**bold**\`, no \`### headers\`.
- Use a short markdown bullet list ONLY if the answer is genuinely a list of discrete items (e.g. "three things to ask your doctor"). Otherwise stay in prose.
- The frontend renders your reply through a typographic component, so emphasis and structure should come from sentence craft, not from \`**\`/\`###\`.

Patient data payload:
${contextBlock}`;

    const completion = await anthropic.messages.create({
      model: process.env.LLM_CHAT_MODEL || process.env.LLM_RECONCILIATION_MODEL || "claude-sonnet-4-6",
      max_tokens: 800,
      system,
      messages,
    });
    const assistantText = completion.content[0]?.type === "text" ? completion.content[0].text : "(no response)";

    const [assistantMsg] = await db.insert(chatMessagesTable).values({
      conversationId: activeConvId,
      role: "assistant",
      content: assistantText,
    }).returning();

    res.json({ conversationId: activeConvId, message: assistantMsg });
  } catch (err) {
    req.log.error({ err }, "Chat failed");
    res.status(500).json({ error: "Failed to generate response" });
  }
});

router.delete("/:conversationId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt((req.params.patientId as string));
  const conversationId = parseInt((req.params.conversationId as string));
  const patient = await getPatient(patientId, userId);
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  try {
    const [conv] = await db.select().from(chatConversationsTable)
      .where(and(eq(chatConversationsTable.id, conversationId), eq(chatConversationsTable.patientId, patientId)));
    if (!conv) { res.status(204).send(); return; }
    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.conversationId, conversationId));
    await db.delete(chatConversationsTable).where(eq(chatConversationsTable.id, conversationId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete conversation");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
