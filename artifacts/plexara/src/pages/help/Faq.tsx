import { Wand2 } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { HelpSection } from "@/components/help/HelpSection";

export function Faq() {
  return (
    <HelpSection id="faq" title="Frequently asked questions" Icon={Wand2}>
      <Accordion type="single" collapsible className="w-full">
        <FaqItem q="Is Plexara a substitute for my physician?">
          No. Plexara is a wellness and self-tracking tool. It does not
          diagnose, prescribe, or replace clinical judgment. Bring its
          interpretations to your physician as a starting point for a richer
          conversation — not as a verdict.
        </FaqItem>
        <FaqItem q="What kinds of records can I upload?">
          PDF lab reports, photos of paper labs, imaging reports, genetic
          panels (PGS / 23andMe / AncestryDNA / MyHeritage exports), DICOM
          imaging studies, and structured wearable exports (Apple Health
          today; Oura, Garmin, Whoop on the roadmap). Plexara extracts
          biomarkers automatically; you review and confirm before anything
          is graphed.
        </FaqItem>
        <FaqItem q="Does the AI see my name or date of birth?">
          No. Identifiable fields are stripped before any prompt leaves
          Plexara's servers. The model receives age <em>band</em>, biological
          sex, and clinical context (height/weight/allergies/meds/conditions)
          — never a name, exact birthday, address, or contact detail.
        </FaqItem>
        <FaqItem q="What happens if I delete my account?">
          Every patient profile, record, interpretation, alert, supplement,
          conversation and share link tied to your account is irreversibly
          removed. You'll be signed out immediately. The action requires
          typing{" "}
          <code className="font-mono px-1 rounded bg-secondary">DELETE</code>{" "}
          to confirm.
        </FaqItem>
        <FaqItem q="Can I share my dashboard with a physician or family member?">
          Yes — from the share portal you can mint a read-only link with an
          expiry date. The recipient sees the data but cannot edit, download
          originals, or trigger new AI runs. For long-term shared access (a
          partner, an aging parent, a clinician you see regularly), use
          collaborator invitations from Sharing instead — it gives them
          their own login.
        </FaqItem>
        <FaqItem q="How are 'optimal' ranges decided?">
          Optimal ranges are drawn from peer-reviewed longevity, performance
          and preventive-medicine literature, then normalised by age and
          biological sex where the evidence supports it. The reference set
          is versioned — you can see which version produced any given
          interpretation in the audit log.
        </FaqItem>
        <FaqItem q="What does the Comprehensive Report contain?">
          A multi-page narrative synthesis of your entire record set: top
          findings across all three lenses, biomarker trend cards,
          body-system summaries, a Current Care Plan Assessment of your
          active supplements + medications, recommended next tests, and a
          glossary. Designed to be printed and brought to a physician visit.
        </FaqItem>
        <FaqItem q="What does Stack Intelligence actually check?">
          Your CURRENT supplement + medication stack against your latest
          biomarkers, your biomarker history, any pharmacogenomic findings
          on file and your structured medication list. It returns: per-item
          verdict (keep / adjust / drop), gaps you might want to fill,
          potential interactions, an optimal timing schedule, your daily pill
          burden and an estimated monthly cost.
        </FaqItem>
        <FaqItem q="What if I don't agree with an interpretation?">
          Trust your physician over any algorithm. You can flag a finding
          from the dashboard, add a personal note, or simply ignore it.
          Plexara never auto-acts on your data — every protocol or
          supplement change requires your explicit acceptance.
        </FaqItem>
        <FaqItem q="Why do my values look different here than on my lab printout?">
          Plexara standardises units across panels (e.g. cholesterol mg/dL ↔
          mmol/L) so trends are comparable. The original raw value is always
          preserved in the source record — open any record from{" "}
          <strong>/records</strong> to see the unconverted value.
        </FaqItem>
        <FaqItem q="Can Plexara be wrong?">
          Yes. AI lenses can hallucinate, OCR can mis-read, units can be
          misclassified, and reference ranges shift over time. That's why
          Plexara uses three lenses plus a reconciler, exposes confidence
          rings, surfaces lens disagreements explicitly, and never frames
          its output as advice. When in doubt, trust the panel printout and
          your physician.
        </FaqItem>
      </Accordion>
    </HelpSection>
  );
}

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  const id = `faq-${q.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)}`;
  return (
    <AccordionItem value={id}>
      <AccordionTrigger className="text-left">{q}</AccordionTrigger>
      <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}
