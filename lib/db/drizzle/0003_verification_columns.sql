-- Verification spec (May 2026) — adds the three columns powering the
-- post-extraction summary, the auto-correct misclassification flow,
-- and the data-audit contribution status pipeline.
--
--   detected_type     — what the LLM thought the document was
--                       (independent of what the user picked at upload).
--   extraction_summary — non-PHI counts + key findings + confidence
--                        snapshot, surfaced in UploadZone, MyData and the
--                        RecordDetailModal without needing to decrypt
--                        structured_json.
--   reextracted       — recursion guard for Fix 2a's one-shot type
--                        correction; set BEFORE the second extraction
--                        so a crash mid-flow can never loop.
--
-- All three are nullable / default-false additive columns. No data
-- backfill is required: existing records will simply render without a
-- summary block until they are reanalyzed.
ALTER TABLE "records" ADD COLUMN "detected_type" text;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "extraction_summary" jsonb;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "reextracted" boolean DEFAULT false NOT NULL;
