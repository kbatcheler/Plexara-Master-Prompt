import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Sparkles, Image as ImageIcon } from "lucide-react";
import AINarrative from "@/components/AINarrative";

interface Props {
  summary: string;
  generatedAt: string | null;
  /** Enhancement E12 — when set, renders a "Share summary" link to the
   *  share-card PNG endpoint. Optional so existing call sites stay valid. */
  patientId?: number;
}

export function ExecutiveSummaryCard({ summary, generatedAt, patientId }: Props) {
  const when = generatedAt ? new Date(generatedAt) : null;
  const whenLabel = when
    ? when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <Card
      className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card"
      data-testid="executive-summary-card"
    >
      <CardContent className="p-6 sm:p-7 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="font-heading text-lg font-semibold tracking-tight">
                Your latest health summary
              </h3>
              {whenLabel && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Generated {whenLabel}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="text-[15px] leading-relaxed text-foreground/90">
          <AINarrative text={summary} variant="compact" />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href="/report"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            data-testid="executive-summary-read-full"
          >
            Read full report
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          {patientId !== undefined && (
            <a
              href={`/api/patients/${patientId}/share-card.png`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary hover:underline"
              data-testid="executive-summary-share-image"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              Share summary
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
