import { Card, CardContent } from "@/components/ui/card";
import { Upload, Brain, BarChart3, MessageSquare } from "lucide-react";

const STEPS = [
  {
    icon: Upload,
    title: "Upload your records",
    body: "Drag in blood panels, DEXA scans, imaging reports, genetics, wearables — anything in your health folder. PDF, images, lab portals.",
  },
  {
    icon: Brain,
    title: "Three AI lenses analyse",
    body: "A clinical synthesist, an evidence checker, and a contrarian analyst each interpret your results independently — then reconcile.",
  },
  {
    icon: BarChart3,
    title: "See your eight system gauges",
    body: "Cardiometabolic, inflammation, hormones, micronutrients, and four others — each scored 0-100 with trend and confidence.",
  },
  {
    icon: MessageSquare,
    title: "Ask questions, plan next steps",
    body: "Use chat to dig into any biomarker. Get supplement recommendations, follow-up testing suggestions, and a shareable summary.",
  },
];

export function WelcomeFirstUpload() {
  return (
    <Card className="border-primary/20" data-testid="welcome-first-upload">
      <CardContent className="p-6 sm:p-8 space-y-6">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Welcome to Plexara
          </h2>
          <p className="text-muted-foreground mt-2 leading-relaxed max-w-2xl">
            Your personal health intelligence platform. Upload your first record above to begin —
            here&apos;s what happens next:
          </p>
        </div>

        <ol className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="flex gap-3 p-4 rounded-xl bg-muted/30 border border-border/40"
                data-testid={`welcome-step-${i + 1}`}
              >
                <div className="shrink-0 w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                      Step {i + 1}
                    </span>
                  </div>
                  <h3 className="font-medium text-sm mt-0.5">{step.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {step.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        <p className="text-xs text-muted-foreground border-t border-border/60 pt-4">
          Plexara protects your data with end-to-end encryption. Records are de-identified before
          AI analysis. You stay in control of consent at every step.
        </p>
      </CardContent>
    </Card>
  );
}
