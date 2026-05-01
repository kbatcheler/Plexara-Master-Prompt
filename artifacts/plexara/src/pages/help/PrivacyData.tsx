import { ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { HelpSection, HelpSubsection } from "@/components/help/HelpSection";
import { ClinicalDetail } from "@/components/help/ClinicalDetail";

export function PrivacyData() {
  return (
    <HelpSection
      id="privacy-data"
      title="How your data is protected"
      Icon={ShieldCheck}
      description="Privacy is a structural property of Plexara, not a setting. Here is what that actually means."
    >
      <HelpSubsection id="privacy-encryption" title="End-to-end encryption at rest">
        <p>
          Personally identifying fields (your name, exact date of birth,
          physician contacts, emergency contacts, address, insurance and
          pharmacy details) are encrypted before they touch the database
          using a master key held only by the application. Even an actor
          with read access to the database file cannot recover those fields
          without the master key.
        </p>
        <ClinicalDetail>
          <p>
            Encryption uses authenticated symmetric encryption (AEAD) with
            per-record initialisation vectors. The master key is sourced
            from <code className="font-mono px-1 rounded bg-secondary">PHI_MASTER_KEY</code>{" "}
            in production and is never written to logs.
          </p>
        </ClinicalDetail>
      </HelpSubsection>

      <HelpSubsection id="privacy-pii-stripping" title="De-identification before AI">
        <p>
          When Plexara generates an interpretation, the AI lenses only ever
          see a clinical context block — your age band, biological sex,
          height/weight, allergies, medications and conditions — alongside
          the de-identified biomarker payload. Names, exact dates of birth,
          physician details, addresses, insurance numbers and emergency
          contacts are <em>never</em> sent to any model.
        </p>
        <ClinicalDetail>
          <p>
            The PII-stripping function is recursive and pattern-based: it
            walks every nested field of every payload before it leaves
            Plexara, redacts known sensitive patterns (names, DOB, MRNs,
            phone, email, addresses), and converts any raw date of birth to
            an age band. The function is unit-tested on every build and the
            outbound payload is logged (without PII) at debug level so we
            can audit it.
          </p>
        </ClinicalDetail>
      </HelpSubsection>

      <HelpSubsection id="privacy-audit" title="Audit log">
        <p>
          Every read, write, share, and AI call writes an entry to an
          append-only audit trail you can inspect from{" "}
          <Link href="/audit" className="text-primary underline">
            Audit
          </Link>
          . The audit log is append-only by design — Plexara cannot edit or
          delete entries.
        </p>
      </HelpSubsection>

      <HelpSubsection id="privacy-export-delete" title="Export and deletion">
        <p>
          From{" "}
          <Link href="/settings" className="text-primary underline">
            Settings
          </Link>
          , you can:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            <strong>Download a complete JSON archive</strong> of every
            record, interpretation, alert, supplement, and conversation.
          </li>
          <li>
            <strong>Permanently purge your account.</strong> Deletion
            cascades through every record, interpretation, alert, supplement,
            chat conversation and share link. The action requires typing{" "}
            <code className="font-mono px-1 rounded bg-secondary">DELETE</code>{" "}
            to confirm and signs you out immediately.
          </li>
        </ul>
      </HelpSubsection>

      <HelpSubsection id="privacy-sharing" title="What recipients of your share links see">
        <p>
          Share-portal links and collaborator invites are read-only. The
          recipient sees the dashboard view of your data but cannot:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Download original uploaded files.</li>
          <li>Trigger new AI runs.</li>
          <li>Edit your records, supplements or care plan.</li>
          <li>See the audit log of other parties who have accessed your data.</li>
        </ul>
        <p className="text-sm text-muted-foreground mt-2">
          Revoke any link or collaborator at any time from{" "}
          <Link href="/share-portal" className="text-primary underline">
            Share Portal
          </Link>{" "}
          or{" "}
          <Link href="/sharing" className="text-primary underline">
            Sharing
          </Link>
          .
        </p>
      </HelpSubsection>
    </HelpSection>
  );
}
