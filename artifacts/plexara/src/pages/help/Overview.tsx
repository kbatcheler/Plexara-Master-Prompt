import { Sparkles, Telescope, Layers, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HelpSection, HelpSubsection } from "@/components/help/HelpSection";
import { ClinicalDetail } from "@/components/help/ClinicalDetail";

export function Overview() {
  return (
    <HelpSection
      id="overview"
      title="What Plexara is"
      Icon={Sparkles}
      description="A privacy-first health intelligence platform that turns the scattered paper trail of modern medicine into one calm, longitudinal view of how your body is actually changing."
    >
      <p>
        Modern healthcare generates a lot of paper: lab panels, imaging
        reports, genetic results, wearable summaries, prescriptions,
        consultation notes. Each one gives a single snapshot from a single
        vantage point, and they almost never speak to each other. Plexara's
        job is to read all of them, line them up against your own history,
        and give you back the answers your records were already capable of
        producing — only nobody had the time to assemble them.
      </p>
      <p>
        You upload your records (PDFs, photos of paper labs, DICOM imaging,
        genetic exports, wearable summaries). Plexara extracts the data,
        de-identifies it before any AI sees it, standardises units, plots the
        trends, and runs a layered interpretation pipeline. The output is
        designed to be brought into a conversation with your physician — not
        to replace one.
      </p>

      <HelpSubsection id="overview-three-lenses" title="The three-lens AI pipeline">
        <p>
          Every interpretation is reviewed through three independent vantage
          points before it reaches your screen. This is deliberate: no single
          model — and no single clinician — sees everything. The disagreements
          between lenses are often more informative than the agreements.
        </p>
        <div className="grid sm:grid-cols-3 gap-3 mt-3">
          <LensCard
            n={1}
            title="Clinical Synthesist"
            engine="Claude"
            body="Reads the way an experienced internist would. Synthesises across panels, looks for the most parsimonious explanation, and frames findings in the language of conventional medicine."
          />
          <LensCard
            n={2}
            title="Evidence Checker"
            engine="GPT"
            body="Cross-checks each claim against the published literature on biomarker-disease associations and intervention evidence. Flags weak claims and prefers ranges supported by longevity / preventive-medicine research."
          />
          <LensCard
            n={3}
            title="Contrarian Analyst"
            engine="Gemini"
            body="Actively looks for what the other two might be missing: alternative explanations, low-prevalence conditions consistent with the pattern, and benign explanations for findings that look concerning in isolation."
          />
        </div>
        <p className="text-sm text-muted-foreground mt-3">
          A fourth pass — the <strong>Reconciler</strong> — produces the
          single narrative you actually read. When the three lenses agree, the
          reconciler condenses; when they disagree, it surfaces the
          disagreement explicitly rather than picking a winner silently.
        </p>
        <ClinicalDetail>
          <p>
            Each lens runs against a PII-stripped clinical context block
            (age band, biological sex, anthropometrics, allergies,
            medications, conditions) plus the standardised biomarker payload.
            Lens output is structured JSON (per-finding domain, severity,
            confidence, citations). Lenses run in parallel; the
            reconciliation prompt receives all three and produces the final
            <code className="font-mono mx-1 rounded bg-secondary px-1">DomainGaugeUpdate</code>{" "}
            set plus the reconciled narrative. If a lens degrades (timeout,
            JSON failure), the reconciler is told which lens dropped and
            adjusts confidence accordingly.
          </p>
        </ClinicalDetail>
      </HelpSubsection>

      <HelpSubsection id="overview-domains-snapshot" title="The 8 health domains, at a glance">
        <p>
          Plexara organises every biomarker, every finding and every gauge
          into one of eight body-system domains. The grouping mirrors how
          clinicians actually think (cardiovascular risk, metabolic risk,
          immune status…) rather than how labs print their results.
        </p>
        <div className="grid sm:grid-cols-2 gap-2 mt-3">
          {DOMAINS.map((d) => (
            <div
              key={d.label}
              className="flex items-start gap-2 rounded-md border border-border/60 bg-card p-3"
            >
              <Badge variant="outline" className="text-[10px] mt-0.5 shrink-0">
                {d.label}
              </Badge>
              <span className="text-xs text-muted-foreground leading-snug">
                {d.gist}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Each domain has its own gauge on the dashboard and its own deep
          section in this guide — see{" "}
          <a href="#health-domains" className="text-primary underline">
            the 8 health domains
          </a>{" "}
          below.
        </p>
      </HelpSubsection>

      <HelpSubsection id="overview-design-principles" title="Design principles">
        <Principle
          Icon={Telescope}
          title="Show the disagreement"
          body="When evidence conflicts, Plexara shows you the conflict. We never collapse competing interpretations into a single confident-sounding sentence."
        />
        <Principle
          Icon={Layers}
          title="Optimal vs reference"
          body="A value can be 'normal' for the lab and 'suboptimal' for longevity. We show both ranges side by side and let you decide what to act on (in conversation with your physician)."
        />
        <Principle
          Icon={ShieldCheck}
          title="Privacy by construction"
          body="Identifying fields are encrypted at rest and stripped before any prompt leaves Plexara. The AI sees age band + clinical context, never your name or exact date of birth."
        />
      </HelpSubsection>
    </HelpSection>
  );
}

const DOMAINS: Array<{ label: string; gist: string }> = [
  { label: "Cardiovascular", gist: "Heart and vascular risk: lipids, ApoB, Lp(a), troponin, omega-3 index." },
  { label: "Metabolic", gist: "Glucose handling, kidney filtration, electrolytes, HbA1c, HOMA-IR." },
  { label: "Inflammatory", gist: "Systemic inflammation: hs-CRP, ESR, homocysteine, ferritin." },
  { label: "Hormonal", gist: "Thyroid (TSH/FT3/FT4) and sex/adrenal hormones (testosterone, estradiol, DHEA-S, cortisol, IGF-1)." },
  { label: "Liver/Kidney", gist: "Hepatic enzymes (ALT/AST/GGT) and renal markers (cystatin C, microalbumin)." },
  { label: "Haematological", gist: "Red-cell mass and platelets: RBC, hemoglobin, hematocrit, MCV, RDW." },
  { label: "Immune", gist: "White-cell lineages: WBC, neutrophils, lymphocytes, monocytes, eosinophils." },
  { label: "Nutritional", gist: "Vitamins and minerals: D, B12, folate, iron panel, magnesium, zinc, selenium." },
];

function LensCard({
  n,
  title,
  engine,
  body,
}: {
  n: number;
  title: string;
  engine: string;
  body: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <Badge variant="secondary" className="w-fit text-[10px] uppercase tracking-wider">
            Lens {n}
          </Badge>
          <span className="text-[10px] text-muted-foreground">{engine}</span>
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground leading-relaxed">
        {body}
      </CardContent>
    </Card>
  );
}

function Principle({
  Icon,
  title,
  body,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 mt-2">
      <Icon className="h-4 w-4 text-primary mt-1 shrink-0" aria-hidden />
      <div>
        <div className="text-sm font-medium">{title}</div>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
