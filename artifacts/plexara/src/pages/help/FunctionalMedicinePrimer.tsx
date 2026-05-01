import { BookOpen, Target, Network, TrendingUp, Microscope } from "lucide-react";
import { HelpSection, HelpSubsection } from "@/components/help/HelpSection";
import { ClinicalDetail } from "@/components/help/ClinicalDetail";

export function FunctionalMedicinePrimer() {
  return (
    <HelpSection
      id="functional-medicine"
      title="Functional medicine, in plain English"
      Icon={BookOpen}
      description="A 10-minute primer on the model of medicine Plexara is built around — and how it differs from the medicine you usually see."
    >
      <HelpSubsection id="fm-what-it-is" title="What functional medicine actually means">
        <p>
          Functional medicine is a way of practising medicine that focuses on{" "}
          <strong>why</strong> a body system has stopped working well — not
          only on the disease label that follows when it has stopped working
          long enough. Instead of treating each abnormal lab result as a
          standalone problem, functional medicine asks how that result fits
          into the rest of the picture: which other systems are upstream,
          which lifestyle inputs are driving it, and what the trend over time
          says about where it is heading.
        </p>
        <p>
          Conventional medicine is excellent at acute care and at treating
          named diseases. It is, by design, less interested in the long
          stretch where a person feels "off" but does not yet have a
          diagnosis. Functional medicine lives in exactly that stretch — and
          that is where most of Plexara's value sits.
        </p>
        <p className="text-sm text-muted-foreground italic">
          Plexara is not a substitute for either approach. It is a translator
          and an organiser — it helps you bring richer questions to your
          conventional physician, with the data already laid out.
        </p>
      </HelpSubsection>

      <HelpSubsection id="fm-five-pillars" title="The five pillars">
        <Pillar
          Icon={Target}
          title="1. Root cause over symptom"
          body="When fatigue, brain fog or weight gain show up, the question is not 'what drug suppresses the symptom?' but 'which system upstream — thyroid, mitochondria, glucose handling, sleep, gut absorption — is the most likely driver?' Plexara helps by surfacing patterns across panels rather than only flagging individual values."
        />
        <Pillar
          Icon={Network}
          title="2. Systems thinking"
          body="The body is a network, not a list of organs. A low ferritin can manifest as a hair-loss complaint, a low-energy complaint, a restless-legs complaint or a poor-recovery complaint, depending on what else is going on. Plexara's domain gauges and pattern detection are organised around this idea: a finding in one domain almost always implies a question in another."
        />
        <Pillar
          Icon={TrendingUp}
          title="3. Trends matter more than single values"
          body="A single 'normal' lab result tells you very little. A value that has drifted from your personal baseline — even within the conventional reference range — tells you a great deal. Plexara stores every value forever and computes per-biomarker trend lines so the question moves from 'is this number bad?' to 'is this number changing?'."
        />
        <Pillar
          Icon={Microscope}
          title="4. Optimal vs reference ranges"
          body="Lab reference ranges are statistical: the central 95% of the lab's reference population. They are not 'healthy' ranges — they are 'common' ranges. Functional medicine uses tighter optimal ranges drawn from longevity, performance and preventive-medicine research. Plexara shows both."
        />
        <Pillar
          Icon={Target}
          title="5. Lifestyle is a first-class intervention"
          body="Sleep, training, diet, light exposure, cold/heat, stress and social connection are not soft adjuncts to 'real' medicine — for most chronic-disease risk they are the highest-leverage levers. Plexara surfaces lifestyle considerations alongside medication and supplement options in every protocol."
        />
      </HelpSubsection>

      <HelpSubsection id="fm-reference-vs-optimal" title="Reference range vs optimal range — worked example">
        <p>
          Take TSH (the master thyroid signal). A typical lab reference range
          is roughly <strong>0.4 – 4.5 mIU/L</strong>. A TSH of 4.2 is
          therefore "normal" — your physician will almost certainly not
          mention it.
        </p>
        <p>
          Most preventive-medicine references put the <em>optimal</em> range
          for symptom-free, energetic adults at{" "}
          <strong>~0.5 – 2.5 mIU/L</strong>. A TSH that has drifted from 1.1
          (three years ago) to 4.2 (today) is technically still "normal" — and
          is also a 4× change in your master thyroid signal. Plexara will:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Show the value in the yellow "watch" band on the gauge.</li>
          <li>Surface the trend on the Hormonal domain card.</li>
          <li>
            Suggest companion biomarkers that will sharpen the picture (Free
            T3, Free T4, Reverse T3, TPO antibodies).
          </li>
          <li>
            Note any common drivers (iodine status, selenium, ferritin, sleep
            debt, prolonged calorie deficit).
          </li>
        </ul>
        <ClinicalDetail>
          <p>
            The optimal-range thresholds are versioned in the seeded
            reference table and re-evaluated whenever the underlying
            biomarker reference set is updated. Each gauge interpretation
            records which reference-set version produced it (visible in the
            audit log), so you can always reproduce why a finding was
            classified the way it was.
          </p>
        </ClinicalDetail>
      </HelpSubsection>

      <HelpSubsection id="fm-patterns" title="Thinking in patterns, not in single values">
        <p>
          Functional medicine relies heavily on biomarker <em>patterns</em>:
          combinations of values that, taken together, point to a specific
          upstream driver. A few worth knowing:
        </p>
        <PatternRow
          name="Insulin-resistance pattern"
          markers="Fasting glucose 90-99, HbA1c 5.5-5.7, triglycerides ≥ 100, HDL ≤ 50, ALT slightly elevated, low SHBG"
          meaning="Glucose tolerance is degrading even though no individual marker is 'diabetic'. High-leverage interventions: resistance training, protein at every meal, time-restricted eating, sleep debt repair."
        />
        <PatternRow
          name="Functional iron deficiency pattern"
          markers="Ferritin 30-50, low transferrin saturation, MCV trending lower, RDW trending higher, hemoglobin still normal"
          meaning="Iron stores are eroding before anaemia shows up. Common in athletes, menstruating women, plant-based diets, chronic NSAID/PPI use."
        />
        <PatternRow
          name="Subclinical hypothyroidism pattern"
          markers="TSH 2.5-4.5, FT4 lower-half of range, FT3 lower-half of range, possibly elevated TPO antibodies"
          meaning="Thyroid output is slipping before it shows up as overt hypothyroidism. Worth tracking quarterly with same-time-of-day draws."
        />
        <PatternRow
          name="Chronic low-grade inflammation pattern"
          markers="hs-CRP 1.0-3.0, ferritin elevated for sex, fibrinogen elevated, neutrophil:lymphocyte ratio drifting up"
          meaning="A persistent low-grade inflammatory state — common drivers include visceral adiposity, periodontal disease, sleep deprivation, and gut dysbiosis."
        />
        <p className="text-sm text-muted-foreground mt-3">
          Plexara's pattern detector runs over your entire panel set and
          surfaces matches in the Intelligence Summary card on the dashboard
          and in the body of every comprehensive report.
        </p>
      </HelpSubsection>

      <HelpSubsection id="fm-using-plexara" title="How to use Plexara through this lens">
        <ol className="list-decimal pl-6 space-y-2">
          <li>
            <strong>Build the baseline.</strong> Upload every lab panel you
            can find — even old ones. Plexara is designed for longitudinal
            thinking, and ten-year baselines are far more valuable than a
            single recent panel.
          </li>
          <li>
            <strong>Fill in the Health Profile.</strong> Demographics, sex,
            menstrual status, allergies, medications and lifestyle history
            change how every lens interprets the same number. The profile
            data is part of every interpretation.
          </li>
          <li>
            <strong>Watch the gauges and the trends, not just the values.</strong>{" "}
            Yellow gauges and suboptimal trends are where functional medicine
            does its most useful work — long before anything turns red.
          </li>
          <li>
            <strong>Run a Comprehensive Report quarterly.</strong> The report
            stitches everything together — lenses, patterns, drug-depletion
            alerts, longitudinal change, recommended next tests, and a
            current-care-plan assessment. Bring it to your physician visit.
          </li>
          <li>
            <strong>Use Stack Intelligence after any change.</strong>{" "}
            Whenever you change a supplement, dose, or medication, re-run
            stack analysis. It checks the new combination against your
            biomarkers, genetics and medications for redundancies, gaps and
            interactions.
          </li>
        </ol>
      </HelpSubsection>
    </HelpSection>
  );
}

function Pillar({
  Icon,
  title,
  body,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 mt-3">
      <Icon className="h-4 w-4 text-primary mt-1 shrink-0" aria-hidden />
      <div>
        <div className="text-sm font-medium">{title}</div>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function PatternRow({
  name,
  markers,
  meaning,
}: {
  name: string;
  markers: string;
  meaning: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card p-3 mt-2">
      <div className="text-sm font-semibold">{name}</div>
      <div className="text-xs text-muted-foreground mt-1">
        <span className="font-medium text-foreground/80">Markers: </span>
        {markers}
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        <span className="font-medium text-foreground/80">Meaning: </span>
        {meaning}
      </div>
    </div>
  );
}
