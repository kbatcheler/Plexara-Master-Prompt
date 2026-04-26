import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Loader2, AlertTriangle, CheckCircle2, Activity, RefreshCw } from "lucide-react";
import AINarrative from "@/components/AINarrative";

// ─── Types — kept loose so we don't drift if the backend evolves ────────────
interface ReconciledShape {
  agreements?: Array<{
    finding?: string;
    confidence?: string;
    allLensesAgree?: boolean;
  }>;
  disagreements?: Array<{
    finding?: string;
    lensAView?: string;
    lensBView?: string;
    lensCView?: string;
  }>;
  patientNarrative?: string;
  clinicalNarrative?: string;
  unifiedHealthScore?: number;
  topConcerns?: string[];
  topPositives?: string[];
  urgentFlags?: string[];
}

interface InterpretationShape {
  reconciled?: ReconciledShape;
  contextNote?: string;
  modelSignature?: string;
}

interface Props {
  interpretation: unknown;
  model: string | null;
  interpretedAt: string | null;
  onReinterpret: () => void;
  reinterpreting: boolean;
}

export function ImagingInterpretationPanel({
  interpretation,
  model,
  interpretedAt,
  onReinterpret,
  reinterpreting,
}: Props) {
  const interp = (interpretation || null) as InterpretationShape | null;
  const reconciled = interp?.reconciled;

  // ── Empty / not-yet-interpreted state ──
  if (!interp || !reconciled) {
    return (
      <Card data-testid="imaging-interpretation-panel">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            <CardTitle className="text-base">AI interpretation</CardTitle>
          </div>
          <Button
            size="sm"
            onClick={onReinterpret}
            disabled={reinterpreting}
            data-testid="interpret-now"
          >
            {reinterpreting ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Interpreting…
              </>
            ) : (
              <>
                <Brain className="w-3 h-3 mr-1" /> Interpret now
              </>
            )}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            No AI interpretation yet for this study. Click <em>Interpret now</em> to run the
            three-lens engine across the study's anonymised header metadata and your relevant
            biomarkers. Note: this is a header-level interpretation, not a radiologist read of
            the pixel data — see the patient narrative below once it runs.
          </div>
        </CardContent>
      </Card>
    );
  }

  const score =
    typeof reconciled.unifiedHealthScore === "number" ? reconciled.unifiedHealthScore : null;

  return (
    <Card data-testid="imaging-interpretation-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            <CardTitle className="text-base">AI interpretation</CardTitle>
            {score !== null && (
              <Badge variant="outline" className="font-mono">
                Confidence {score}/100
              </Badge>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {model && <span>Model: {model}</span>}
            {interpretedAt && (
              <span> · Generated {new Date(interpretedAt).toLocaleString()}</span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onReinterpret}
          disabled={reinterpreting}
          data-testid="reinterpret"
        >
          {reinterpreting ? (
            <>
              <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Working…
            </>
          ) : (
            <>
              <RefreshCw className="w-3 h-3 mr-1" /> Re-interpret
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {interp.contextNote && (
          <div className="text-[11px] text-muted-foreground italic border-l-2 border-border/50 pl-2">
            Context: {interp.contextNote}
          </div>
        )}

        {/* Urgent flags */}
        {reconciled.urgentFlags && reconciled.urgentFlags.length > 0 && (
          <div className="border border-rose-500/30 bg-rose-500/10 rounded-md p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-rose-300 mb-1">
              <AlertTriangle className="w-4 h-4" /> Urgent flags
            </div>
            <ul className="text-sm text-rose-200/90 list-disc list-inside space-y-1">
              {reconciled.urgentFlags.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Patient narrative */}
        {reconciled.patientNarrative && (
          <section>
            <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
              For you
            </div>
            <AINarrative text={reconciled.patientNarrative} variant="serif" />
          </section>
        )}

        {/* Clinical narrative */}
        {reconciled.clinicalNarrative && (
          <section>
            <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
              For your clinician
            </div>
            <AINarrative text={reconciled.clinicalNarrative} variant="clinical" />
          </section>
        )}

        {/* Top concerns / positives */}
        <div className="grid sm:grid-cols-2 gap-3">
          {reconciled.topConcerns && reconciled.topConcerns.length > 0 && (
            <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300 mb-1">
                <Activity className="w-3 h-3" /> Top concerns
              </div>
              <ul className="text-sm list-disc list-inside space-y-1 text-amber-100/90">
                {reconciled.topConcerns.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {reconciled.topPositives && reconciled.topPositives.length > 0 && (
            <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-md p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300 mb-1">
                <CheckCircle2 className="w-3 h-3" /> Top positives
              </div>
              <ul className="text-sm list-disc list-inside space-y-1 text-emerald-100/90">
                {reconciled.topPositives.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Agreements & disagreements (collapsible-ish) */}
        {reconciled.agreements && reconciled.agreements.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Where the three models agreed ({reconciled.agreements.length})
            </summary>
            <ul className="mt-2 space-y-1 list-disc list-inside text-foreground/80">
              {reconciled.agreements.map((a, i) => (
                <li key={i}>
                  {a.finding}
                  {a.confidence && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      {a.confidence}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
        {reconciled.disagreements && reconciled.disagreements.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Where the models disagreed ({reconciled.disagreements.length})
            </summary>
            <ul className="mt-2 space-y-2 text-foreground/80">
              {reconciled.disagreements.map((d, i) => (
                <li key={i} className="border-l-2 border-border/50 pl-2">
                  <div className="font-medium">{d.finding}</div>
                  {d.lensAView && (
                    <div className="text-xs text-muted-foreground">
                      Synthesist: {d.lensAView}
                    </div>
                  )}
                  {d.lensBView && (
                    <div className="text-xs text-muted-foreground">
                      Evidence: {d.lensBView}
                    </div>
                  )}
                  {d.lensCView && (
                    <div className="text-xs text-muted-foreground">
                      Contrarian: {d.lensCView}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
