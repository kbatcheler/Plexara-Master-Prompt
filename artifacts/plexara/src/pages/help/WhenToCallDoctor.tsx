import { AlertTriangle } from "lucide-react";
import { HelpSection } from "@/components/help/HelpSection";

export function WhenToCallDoctor() {
  return (
    <HelpSection
      id="when-to-call"
      title="When to call your doctor"
      Icon={AlertTriangle}
      description="Plexara is informational. The following situations warrant prompt clinical contact, regardless of what any dashboard shows."
    >
      <ul className="list-disc pl-6 space-y-2">
        <li>Chest pain, shortness of breath, or sudden severe headache.</li>
        <li>
          Symptoms of stroke (face droop, arm weakness, speech difficulty).
        </li>
        <li>
          Any biomarker flagged{" "}
          <strong className="text-destructive">red / urgent</strong> on your
          dashboard.
        </li>
        <li>
          Sudden unexplained weight loss, persistent fever, or new severe
          pain.
        </li>
        <li>
          Concerns that have been building over time — even when individual
          numbers look fine.
        </li>
        <li>
          Any new neurologic symptom: vision change, weakness, persistent
          headache, confusion.
        </li>
        <li>
          Pregnancy or planning pregnancy and any medication / supplement
          decision.
        </li>
      </ul>
      <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <strong className="text-destructive">If this is an emergency,</strong>{" "}
        call your local emergency number (911 in the US, 999 in the UK, 112
        in most of the EU) — do not wait to read another report.
      </div>
    </HelpSection>
  );
}
