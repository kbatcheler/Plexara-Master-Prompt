import { db, consentRecordsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

export interface ConsentScopeDef {
  key: string;
  category: "ai" | "sharing" | "analytics" | "research";
  label: string;
  description: string;
  defaultGranted: boolean;
  required?: boolean;
}

export const CONSENT_SCOPES: ConsentScopeDef[] = [
  {
    key: "ai.anthropic.send_phi",
    category: "ai",
    label: "Anthropic (Claude) interpretation",
    description: "Allow de-identified health data to be sent to Anthropic's Claude API for the first interpretation lens.",
    defaultGranted: false,
  },
  {
    key: "ai.openai.send_phi",
    category: "ai",
    label: "OpenAI (GPT) interpretation",
    description: "Allow de-identified health data to be sent to OpenAI's GPT API for the second interpretation lens.",
    defaultGranted: false,
  },
  {
    key: "ai.gemini.send_phi",
    category: "ai",
    label: "Google (Gemini) interpretation",
    description: "Allow de-identified health data to be sent to Google's Gemini API for the third interpretation lens.",
    defaultGranted: false,
  },
  {
    key: "sharing.physician",
    category: "sharing",
    label: "Share links to clinicians",
    description: "Allow generation of read-only share links a clinician can open without an account.",
    defaultGranted: true,
  },
  {
    key: "analytics.aggregate",
    category: "analytics",
    label: "Aggregate analytics",
    description: "Allow your fully anonymous, aggregated metrics to inform population baselines.",
    defaultGranted: false,
  },
  {
    key: "research.deidentified",
    category: "research",
    label: "De-identified research participation",
    description: "Allow de-identified data to be used for IRB-approved research studies (you can revoke at any time).",
    defaultGranted: false,
  },
];

export async function getEffectiveConsents(accountId: string): Promise<Array<ConsentScopeDef & { granted: boolean; version: number; updatedAt: Date | null }>> {
  const records = await db
    .select()
    .from(consentRecordsTable)
    .where(eq(consentRecordsTable.accountId, accountId))
    .orderBy(desc(consentRecordsTable.grantedAt));

  // Latest record per scope wins.
  const latestByScope = new Map<string, typeof records[number]>();
  for (const r of records) {
    if (!latestByScope.has(r.scopeKey)) latestByScope.set(r.scopeKey, r);
  }

  return CONSENT_SCOPES.map((s) => {
    const r = latestByScope.get(s.key);
    if (!r) {
      return { ...s, granted: s.defaultGranted, version: 0, updatedAt: null };
    }
    return {
      ...s,
      granted: r.revokedAt ? false : r.granted,
      version: r.version,
      updatedAt: r.revokedAt ?? r.grantedAt,
    };
  });
}

export async function setConsent(accountId: string, scopeKey: string, granted: boolean): Promise<void> {
  const def = CONSENT_SCOPES.find((s) => s.key === scopeKey);
  if (!def) throw new Error(`Unknown consent scope: ${scopeKey}`);

  // Find latest version
  const [latest] = await db
    .select()
    .from(consentRecordsTable)
    .where(and(eq(consentRecordsTable.accountId, accountId), eq(consentRecordsTable.scopeKey, scopeKey)))
    .orderBy(desc(consentRecordsTable.version))
    .limit(1);

  const nextVersion = (latest?.version ?? 0) + 1;
  await db.insert(consentRecordsTable).values({
    accountId,
    scopeKey,
    granted,
    version: nextVersion,
    grantedAt: new Date(),
    revokedAt: granted ? null : new Date(),
  });
}

export async function isProviderAllowed(accountId: string, provider: "anthropic" | "openai" | "gemini"): Promise<boolean> {
  // Fail-closed: AI providers are off by default; only an explicit, currently-granted
  // consent record on the patient's account allows data transmission.
  const key = `ai.${provider}.send_phi`;
  const consents = await getEffectiveConsents(accountId);
  const c = consents.find((x) => x.key === key);
  return c ? c.granted : false;
}
