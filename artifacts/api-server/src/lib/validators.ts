import { z } from "zod";

// Reusable primitives. Routes mount params via `:patientId/:recordId/...`
// and Express stringifies them — coerce to number with bounds so handlers
// can drop the `parseInt(...)` boilerplate.
export const idParam = z.coerce.number().int().positive();

export const patientIdParams = z.object({ patientId: idParam });

export function withPatientParams<T extends z.ZodRawShape>(extra: T) {
  return z.object({ patientId: idParam, ...extra });
}

// Common body shapes ---------------------------------------------------------

// Soft enum for note authorship — keep values lowercase to match existing
// data; "patient" is the default in handlers.
export const noteAuthorRole = z.enum(["patient", "clinician", "system"]);

export const createNoteBody = z.object({
  subjectType: z.string().min(1).max(64).optional().nullable(),
  subjectId: z.string().min(1).max(128).optional().nullable(),
  body: z.string().min(1).max(10_000),
  authorRole: noteAuthorRole.optional(),
});

export const updateNoteBody = z.object({
  body: z.string().min(1).max(10_000),
});

export const dismissAlertBody = z.object({
  resolutionType: z.enum(["dismissed", "acknowledged", "resolved"]).optional(),
  notes: z.string().max(2_000).optional(),
});

export const computeBiologicalAgeBody = z.object({
  recordId: z.coerce.number().int().positive().optional(),
});

export const consentBody = z.object({
  granted: z.boolean(),
});

export const dataResidencyBody = z.object({
  region: z.enum(["us", "eu", "uk", "au", "ca"]),
});

export const dataRequestBody = z.object({
  type: z.enum(["export", "delete", "rectify"]),
  details: z.string().max(2_000).optional().nullable(),
});

export const adminDataRequestUpdateBody = z.object({
  status: z.enum(["pending", "in_progress", "completed", "rejected"]),
  resolutionNotes: z.string().max(4_000).optional().nullable(),
});

export const annotationBody = z.object({
  type: z.string().min(1).max(64),
  geometry: z.unknown(),
  label: z.string().max(500).optional().nullable(),
  measurementValue: z.coerce.number().finite().optional().nullable(),
  measurementUnit: z.string().max(32).optional().nullable(),
  fileIndex: z.coerce.number().int().min(0).max(10_000).optional(),
});

export const safetyDismissBody = z.object({
  note: z.string().max(2_000).optional().nullable(),
});

export const disagreementResolveBody = z.object({
  note: z.string().max(2_000).optional().nullable(),
  resolution: z.string().max(64).optional(),
});

export const recordCreateBody = z.object({
  recordType: z.string().min(1).max(64),
  testDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional().nullable(),
});

export const chatBody = z.object({
  question: z.string().min(1).max(8_000),
  subjectType: z.string().max(64).optional().nullable(),
  subjectRef: z.string().max(128).optional().nullable(),
  conversationId: z.coerce.number().int().positive().optional().nullable(),
});

export const baselineCreateBody = z
  .object({
    notes: z.string().max(2_000).optional().nullable(),
  })
  .passthrough(); // baseline payload includes derived fields populated server-side

export const supplementCreateBody = z.object({
  name: z.string().min(1).max(255),
  dosage: z.string().max(255).optional().nullable(),
  frequency: z.string().max(255).optional().nullable(),
  startedAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional().nullable(),
  notes: z.string().max(2_000).optional().nullable(),
});

export const supplementUpdateBody = supplementCreateBody.partial();

export const supplementRecommendationStatusBody = z.object({
  status: z.enum(["pending", "accepted", "rejected", "deferred"]),
});

export const alertPrefsBody = z
  .object({
    channels: z.array(z.string()).optional(),
    severityThreshold: z.string().max(32).optional(),
  })
  .passthrough();

export const devLoginBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

// Share-link creation — bound the recipient/label fields so they can't be
// abused as data-exfiltration channels, and clamp expiresInDays at the
// schema layer rather than only in handler arithmetic.
export const shareLinkCreateBody = z.object({
  label: z.string().max(255).optional().nullable(),
  recipientName: z.string().max(255).optional().nullable(),
  expiresInDays: z.coerce.number().int().min(1).max(90).optional(),
});

// Protocol adoption mutations.
export const protocolAdoptBody = z.object({
  protocolId: z.coerce.number().int().positive(),
});

export const protocolAdoptionUpdateBody = z.object({
  status: z.enum(["active", "paused", "completed", "discontinued"]).optional(),
  notes: z.string().max(4_000).optional().nullable(),
  progressJson: z.unknown().optional(),
});
