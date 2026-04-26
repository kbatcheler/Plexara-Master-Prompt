import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  Eye,
  Lock,
  Mail,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Telescope,
  Wand2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

export default function Help() {
  return (
    <div className="max-w-4xl space-y-10" data-testid="help-page">
      <header>
        <h1 className="text-3xl font-heading font-bold tracking-tight">Help &amp; FAQ</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          A short guide to how Plexara reads your records, what the colours and
          numbers mean, and how to keep your data safe. Plexara is a{" "}
          <strong>wellness intelligence tool</strong>, not a medical device — when
          something feels urgent, talk to your physician.
        </p>
      </header>

      <Section
        title="What is Plexara?"
        Icon={Sparkles}
      >
        <p>
          Plexara is a privacy-first health intelligence platform that turns the
          scattered paper trail of modern medicine — labs, imaging reports,
          genetic panels, wearable summaries — into a single, calm, longitudinal
          view of how your body is actually changing.
        </p>
        <p className="mt-3">
          You upload your records. Plexara extracts and de-identifies them,
          standardises the units, plots the trends, and generates layered
          interpretation through a <strong>three-lens AI pipeline</strong>. You
          stay in control of every share, every export, and every deletion.
        </p>
      </Section>

      <Section
        title="The three lenses, explained"
        Icon={Telescope}
        description="Every interpretation Plexara produces is reviewed through three independent vantage points before it reaches your screen."
      >
        <div className="grid sm:grid-cols-3 gap-4">
          <LensCard
            n={1}
            title="Conventional"
            body="Standard reference ranges your physician's lab uses. Flags values that are clinically out-of-range and worth raising at your next visit."
          />
          <LensCard
            n={2}
            title="Optimal"
            body="Tighter, evidence-based 'feel-best' ranges drawn from longevity and performance literature. Highlights values that are technically normal but trending suboptimal."
          />
          <LensCard
            n={3}
            title="Longitudinal"
            body="Compares your current values against your own baseline over time. Surfaces meaningful drift — directional change of ≥10% or threshold crossings — even when single readings look fine."
          />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          When all three lenses agree, you can be confident in the signal. When
          they disagree, Plexara shows you the disagreement instead of papering
          over it.
        </p>
      </Section>

      <Section
        title="What each gauge colour means"
        Icon={Activity}
      >
        <div className="space-y-3">
          <Swatch
            colour="bg-green-500"
            label="Green — Optimal"
            body="Within both the conventional and optimal range. No action required; keep the routine that produced this number."
          />
          <Swatch
            colour="bg-yellow-500"
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
            body="Critical value that warrants prompt clinical attention. Plexara will not diagnose — it will tell you to call your doctor today."
          />
        </div>
      </Section>

      <Section
        title="How your data is protected"
        Icon={ShieldCheck}
      >
        <ul className="space-y-3 list-disc list-inside marker:text-primary/60">
          <li>
            <strong>End-to-end encryption at rest.</strong> Personally
            identifying fields (names, dates of birth, physician contacts,
            emergency contacts) are encrypted before they hit the database.
          </li>
          <li>
            <strong>De-identification before AI.</strong> When Plexara generates
            an interpretation, the AI only ever sees a clinical context block —
            age band, biological sex, height/weight, allergies, medications,
            conditions. Names, exact dates of birth, physician details, and
            emergency contacts are <em>never</em> sent to any model.
          </li>
          <li>
            <strong>Audit log.</strong> Every read, write, share, and AI call is
            written to an append-only audit trail you can inspect from{" "}
            <Link href="/audit" className="text-primary underline">
              Audit
            </Link>
            .
          </li>
          <li>
            <strong>One-click export and deletion.</strong> Download a complete
            JSON archive or permanently purge your account from{" "}
            <Link href="/settings" className="text-primary underline">
              Settings
            </Link>
            . Deletion cascades through every record, interpretation, alert, and
            share link.
          </li>
        </ul>
      </Section>

      <Section
        title="When to call your doctor"
        Icon={AlertTriangle}
        description="Plexara is informational. The following situations warrant prompt clinical contact, regardless of what any dashboard shows."
      >
        <ul className="space-y-2 list-disc list-inside marker:text-destructive/70">
          <li>Chest pain, shortness of breath, or sudden severe headache.</li>
          <li>Symptoms of stroke (face droop, arm weakness, speech difficulty).</li>
          <li>Any biomarker flagged <strong className="text-destructive">red / urgent</strong> on your dashboard.</li>
          <li>Sudden unexplained weight loss, persistent fever, or new severe pain.</li>
          <li>Concerns that have been building over time — even when individual numbers look fine.</li>
        </ul>
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <strong className="text-destructive">If this is an emergency,</strong>{" "}
          call your local emergency number (911 in the US, 999 in the UK, 112 in
          most of the EU) — do not wait to read another report.
        </div>
      </Section>

      <Section
        title="Frequently asked questions"
        Icon={Wand2}
      >
        <Accordion type="single" collapsible className="w-full">
          <Faq q="Is Plexara a substitute for my physician?">
            No. Plexara is a wellness and self-tracking tool. It does not
            diagnose, prescribe, or replace clinical judgment. Bring its
            interpretations to your physician as a starting point for a richer
            conversation — not as a verdict.
          </Faq>
          <Faq q="What kinds of records can I upload?">
            PDF lab reports, imaging reports, genetic panels (PGS / 23andMe /
            AncestryDNA exports), DICOM imaging studies, and structured wearable
            exports (Apple Health, Oura, Garmin). Plexara extracts biomarkers
            automatically; you review and confirm before anything is graphed.
          </Faq>
          <Faq q="Does AI see my name or date of birth?">
            No. Identifiable fields are stripped before any prompt leaves
            Plexara's servers. The model receives age <em>band</em>, biological
            sex, and clinical context (height/weight/allergies/meds/conditions)
            — never a name, exact birthday, address, or contact detail.
          </Faq>
          <Faq q="What happens if I delete my account?">
            Every patient profile, record, interpretation, alert, supplement,
            conversation, and share link tied to your account is irreversibly
            removed. You'll be signed out immediately. The action requires
            typing <code className="font-mono px-1 rounded bg-secondary">DELETE</code>{" "}
            to confirm.
          </Faq>
          <Faq q="Can I share my dashboard with a physician or family member?">
            Yes — from the share portal you can mint a read-only link with an
            expiry date. The recipient sees the data but cannot edit, download
            originals, or trigger new AI runs. Revoke any link at any time.
          </Faq>
          <Faq q="How are 'optimal' ranges decided?">
            Optimal ranges are drawn from peer-reviewed longevity, performance,
            and preventive-medicine literature, then normalised by age and
            biological sex where evidence supports it. The reference set is
            versioned — you can see which version produced any given
            interpretation in the audit log.
          </Faq>
          <Faq q="What does the Comprehensive Report contain?">
            A multi-page narrative synthesis of your entire record set: top
            findings across all three lenses, biomarker trend cards, body-system
            summaries, suggested clinical conversations, and a glossary. It is
            designed to be printed and brought to a physician visit.
          </Faq>
          <Faq q="What if I don't agree with an interpretation?">
            Trust your physician over any algorithm. You can flag a finding
            from the dashboard, add a personal note, or simply ignore it.
            Plexara never auto-acts on your data — every protocol or supplement
            change requires your explicit acceptance.
          </Faq>
        </Accordion>
      </Section>

      <Section title="Contact" Icon={Mail}>
        <div className="grid sm:grid-cols-2 gap-4">
          <ContactCard
            Icon={Mail}
            label="General questions"
            value="hello@plexara.health"
            href="mailto:hello@plexara.health"
          />
          <ContactCard
            Icon={Lock}
            label="Privacy &amp; data requests"
            value="privacy@plexara.health"
            href="mailto:privacy@plexara.health"
          />
          <ContactCard
            Icon={Eye}
            label="Security disclosures"
            value="security@plexara.health"
            href="mailto:security@plexara.health"
          />
          <ContactCard
            Icon={PhoneCall}
            label="Medical emergency"
            value="Call your local emergency number"
            href={undefined}
          />
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Plexara responds to non-urgent inquiries within two business days.
          See our{" "}
          <Link href="/terms" className="underline">Terms</Link>,{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>, and{" "}
          <Link href="/disclaimer" className="underline">Medical Disclaimer</Link>.
        </p>
      </Section>
    </div>
  );
}

/* ── small subcomponents ─────────────────────────────────────────────── */

function Section({
  title,
  Icon,
  description,
  children,
}: {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-primary" aria-hidden />
        <h2 className="text-xl font-heading font-semibold">{title}</h2>
      </div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function LensCard({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Badge variant="secondary" className="w-fit text-[10px] uppercase tracking-wider">
          Lens {n}
        </Badge>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{body}</CardContent>
    </Card>
  );
}

function Swatch({ colour, label, body }: { colour: string; label: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`mt-1 inline-block w-3 h-3 rounded-full shrink-0 ${colour}`}
        aria-hidden
      />
      <div>
        <div className="font-medium text-sm">{label}</div>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  const id = `faq-${q.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)}`;
  return (
    <AccordionItem value={id}>
      <AccordionTrigger className="text-left">{q}</AccordionTrigger>
      <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

function ContactCard({
  Icon,
  label,
  value,
  href,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  href: string | undefined;
}) {
  const inner = (
    <Card className="h-full hover:border-primary/40 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" aria-hidden />
          <CardDescription className="text-xs uppercase tracking-wider">
            {label}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="text-sm font-medium">{value}</CardContent>
    </Card>
  );
  return href ? (
    <a href={href} className="block no-underline">
      {inner}
    </a>
  ) : (
    inner
  );
}
