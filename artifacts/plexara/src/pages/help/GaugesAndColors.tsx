import { Gauge } from "lucide-react";
import { HelpSection } from "@/components/help/HelpSection";
import { ClinicalDetail } from "@/components/help/ClinicalDetail";

export function GaugesAndColors() {
  return (
    <HelpSection
      id="gauges-colors"
      title="What the gauges and colours mean"
      Icon={Gauge}
      description="Plexara turns your records into eight three-quarter-arc gauges (one per domain) plus a unified score. Here is exactly how to read them."
    >
      <p>
        Each gauge has three things to read:
      </p>
      <ol className="list-decimal pl-6 space-y-1">
        <li>
          <strong>The number</strong> — a 0-100 score for that domain, where
          higher is more optimal.
        </li>
        <li>
          <strong>The colour band</strong> — a fast at-a-glance signal (see
          colour key below).
        </li>
        <li>
          <strong>The trend arrow</strong> — direction of change since your
          previous interpretation. A small dot indicates no meaningful change.
        </li>
      </ol>
      <p>
        Around the gauge you may also see a thin <em>confidence ring</em>.
        That ring fills as the lenses agree more strongly with each other.
        A partially filled ring means the lenses disagreed and the
        reconciler resolved it with reduced confidence — worth opening the
        finding to see why.
      </p>

      <div className="mt-4 space-y-3">
        <Swatch
          colour="bg-emerald-500"
          label="Green — Optimal"
          body="Within both the conventional and optimal range. No action required; keep doing what produced this number."
        />
        <Swatch
          colour="bg-amber-500"
          label="Yellow — Watch"
          body="Within the conventional reference range but outside the tighter optimal band, or trending in a direction worth noticing. Worth a conversation, not an emergency."
        />
        <Swatch
          colour="bg-orange-500"
          label="Orange — Concern"
          body="Out of the conventional range or showing a meaningful longitudinal shift. Bring it up at your next physician visit."
        />
        <Swatch
          colour="bg-red-500"
          label="Red — Urgent"
          body="Critical value warranting prompt clinical attention. Plexara will not diagnose — it will tell you to call your doctor today."
        />
      </div>

      <ClinicalDetail>
        <p>
          Domain scores are computed by the reconciler from the per-finding
          severity and confidence emitted by the three lenses. The mapping is
          deliberately conservative: any single critical finding can cap a
          domain in the orange band even when other markers are green. The
          unified health score is a weighted blend across domains; weights
          are tuned so cardiovascular and metabolic findings don't get
          diluted by a strong nutritional score.
        </p>
      </ClinicalDetail>
    </HelpSection>
  );
}

function Swatch({
  colour,
  label,
  body,
}: {
  colour: string;
  label: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`mt-1 inline-block h-3 w-3 rounded-full shrink-0 ${colour}`}
        aria-hidden
      />
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
