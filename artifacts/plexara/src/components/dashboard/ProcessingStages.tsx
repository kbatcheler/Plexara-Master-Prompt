import { CheckCircle2, Loader2, Circle } from "lucide-react";

export interface ProgressStages {
  extracted: boolean;
  lensA: boolean;
  lensB: boolean;
  lensC: boolean;
  reconciled: boolean;
}

interface Props {
  stages: ProgressStages;
  status: "uploading" | "pending" | "processing" | "complete" | "error" | "consent_blocked";
}

interface Stage {
  key: keyof ProgressStages | "uploading" | "stripPii" | "report";
  label: string;
}

/**
 * Visual checklist of the upload-→-report pipeline. Each stage maps to
 * one of the booleans the `/records/:id/progress` endpoint already
 * exposes, plus two derived stages (Strip PII rolls up with extracted,
 * Generate report rolls up with reconciled — the user doesn't see those
 * as separate API events but they're real steps).
 */
const STAGES: Stage[] = [
  { key: "uploading", label: "Upload received" },
  { key: "extracted", label: "Extract structured data" },
  { key: "stripPii", label: "Remove identifiers" },
  { key: "lensA", label: "Lens A · Clinical Synthesist" },
  { key: "lensB", label: "Lens B · Evidence Checker" },
  { key: "lensC", label: "Lens C · Contrarian Analyst" },
  { key: "reconciled", label: "Reconcile findings" },
  { key: "report", label: "Update dashboard" },
];

function isStageDone(stage: Stage, stages: ProgressStages, status: Props["status"]): boolean {
  if (status === "complete") return true;
  if (status === "error" || status === "consent_blocked") return false;
  switch (stage.key) {
    case "uploading":
      return true; // we wouldn't be polling otherwise
    case "stripPii":
      // Strip-PII immediately follows extraction in the pipeline; collapse
      // them visually so the checklist doesn't stall on a stage the API
      // doesn't separately report.
      return stages.extracted;
    case "extracted":
    case "lensA":
    case "lensB":
    case "lensC":
    case "reconciled":
      return stages[stage.key];
    case "report":
      return false; // only true at status==="complete"
    default:
      return false;
  }
}

function isStageActive(stage: Stage, stages: ProgressStages, status: Props["status"]): boolean {
  if (status === "complete" || status === "error" || status === "consent_blocked") return false;
  // Active = the first stage that isn't yet done.
  for (const s of STAGES) {
    if (!isStageDone(s, stages, status)) return s.key === stage.key;
  }
  return false;
}

export function ProcessingStages({ stages, status }: Props) {
  return (
    <ol className="mt-2 space-y-1.5" data-testid="processing-stages">
      {STAGES.map((stage) => {
        const done = isStageDone(stage, stages, status);
        const active = isStageActive(stage, stages, status);
        return (
          <li
            key={stage.key}
            className="flex items-center gap-2 text-[12px]"
            data-stage={stage.key}
            data-state={done ? "done" : active ? "active" : "pending"}
          >
            <span className="shrink-0 w-3.5 h-3.5 flex items-center justify-center">
              {done ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              ) : active ? (
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
              ) : (
                <Circle className="w-3.5 h-3.5 text-muted-foreground/40" />
              )}
            </span>
            <span
              className={
                done
                  ? "text-muted-foreground line-through decoration-muted-foreground/30"
                  : active
                    ? "text-foreground font-medium"
                    : "text-muted-foreground/60"
              }
            >
              {stage.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
