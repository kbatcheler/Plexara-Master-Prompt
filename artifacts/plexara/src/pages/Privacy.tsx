import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Privacy Policy. Same caveat as Terms — review with counsel familiar with
 * health-data law in your operating jurisdictions before launch.
 */
export default function Privacy() {
  return (
    <div className="max-w-3xl mx-auto py-10 space-y-6">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Back to dashboard
      </Link>

      <div>
        <h1 className="text-3xl font-serif tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mt-1">Effective: April 26, 2026 · Version 1.0</p>
      </div>

      <Card><CardContent className="prose prose-sm dark:prose-invert max-w-none py-6 space-y-4">
        <h2>What we collect</h2>
        <p>Plexara stores only what is needed to interpret your health and let you share it:</p>
        <ul>
          <li>Account identifier from our authentication provider (Clerk).</li>
          <li>Health profile you enter: name, date of birth, biological sex, ethnicity (optional), height, weight, allergies, medications, conditions, prior medical history, emergency contact, overseeing physician.</li>
          <li>Health records you upload: PDF / image documents and DICOM imaging files.</li>
          <li>Biomarker values and AI-generated interpretations derived from your records.</li>
          <li>Chat conversations you have with the AI assistant.</li>
          <li>Share-link access logs (hashed IP + user agent) so you can see who has opened your shared report.</li>
        </ul>

        <h2>How we use it</h2>
        <p>
          Your data is used to: render your dashboard and reports, generate AI interpretations,
          let you share specific information with people you choose, and let you export or delete
          your account at any time. We do not sell your data and we do not use it to train
          third-party AI models.
        </p>

        <h2>How we protect it</h2>
        <ul>
          <li><strong>Encryption at rest.</strong> Sensitive narrative text is encrypted in our database with a key separate from the database itself.</li>
          <li><strong>PII stripping.</strong> Before any AI interpretation runs, your name, date of birth, address, and other identifiers are stripped out. The AI providers only see anonymised values and ranges.</li>
          <li><strong>Hashed share tokens.</strong> Share-link bearer tokens are stored only as SHA-256 hashes, so even a database leak cannot be replayed against the public share endpoint.</li>
          <li><strong>Provider opt-ins.</strong> You can disable any of the three AI providers from the Consents page; that provider will simply be skipped on future interpretations.</li>
        </ul>

        <h2>Third parties</h2>
        <ul>
          <li><strong>Clerk</strong> — account authentication.</li>
          <li><strong>Anthropic, OpenAI, Google (Gemini)</strong> — anonymised text only, for AI interpretation. Subject to their terms.</li>
          <li><strong>PostgreSQL hosting</strong> — encrypted database storage.</li>
          <li><strong>Object storage</strong> — for uploaded files.</li>
        </ul>
        <p>
          We do not share your data with anyone else, and we do not embed advertising or
          analytics trackers that reach across other websites.
        </p>

        <h2>Your rights</h2>
        <ul>
          <li><strong>Access.</strong> View everything Plexara holds about you on the dashboard, records, and report pages.</li>
          <li><strong>Export.</strong> Download a copy of all your data from Settings.</li>
          <li><strong>Delete.</strong> Permanently delete your account and all attached data from Settings.</li>
          <li><strong>Withdraw consent.</strong> Disable individual AI providers from Consents at any time.</li>
        </ul>

        <h2>Retention</h2>
        <p>
          Your data is retained for as long as your account is active. Deleting your
          account removes all attached records, biomarkers, interpretations, conversations,
          imaging, share links, and audit entries within 30 days.
        </p>

        <h2>Children</h2>
        <p>
          Plexara is not intended for users under 18. A parent or legal guardian may
          create an account on behalf of a minor and is solely responsible for that data.
        </p>

        <h2>Contact</h2>
        <p>
          To exercise any of the rights above, or to raise a privacy concern, contact
          the operator of this Plexara instance — see the Help page for the email
          address.
        </p>
      </CardContent></Card>
    </div>
  );
}
