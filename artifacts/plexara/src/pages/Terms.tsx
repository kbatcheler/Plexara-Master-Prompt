import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Plexara Terms of Service. This is reasonable starter content for a V1
 * launch but is NOT a substitute for legal review by a qualified attorney
 * familiar with health-data regulations in your jurisdiction
 * (HIPAA in the US, GDPR + the EHDS in the EU, the UK GDPR + DPA 2018,
 * Australian Privacy Act, etc). Replace before any commercial launch.
 */
export default function Terms() {
  return (
    <div className="max-w-3xl mx-auto py-10 space-y-6">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Back to dashboard
      </Link>

      <div>
        <h1 className="text-3xl font-serif tracking-tight">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mt-1">Effective: April 26, 2026 · Version 1.0</p>
      </div>

      <Card><CardContent className="prose prose-sm dark:prose-invert max-w-none py-6 space-y-4">
        <h2>1. About Plexara</h2>
        <p>
          Plexara is a privacy-first health intelligence platform that helps you understand
          your own health records using AI-generated interpretations from multiple independent
          large language models. By creating an account or continuing to use the service,
          you accept these Terms of Service.
        </p>

        <h2>2. Not medical advice</h2>
        <p>
          Plexara is an informational tool. It is not a medical device, it is not a
          substitute for a qualified clinician, and it does not diagnose, treat, cure,
          or prevent any disease. Always consult a licensed healthcare professional before
          making any decision about your health, medication, or treatment.
        </p>
        <p>
          The AI interpretations may be wrong, incomplete, or out of date. You are solely
          responsible for any action you take based on what you see in Plexara.
        </p>

        <h2>3. Eligibility</h2>
        <p>
          You must be at least 18 years old, or the legal guardian of the person whose
          health data you are uploading. You may not use Plexara to upload data about
          another adult without their explicit, documented consent.
        </p>

        <h2>4. Accounts and security</h2>
        <p>
          You are responsible for maintaining the security of your sign-in credentials.
          If you suspect unauthorised access to your account, revoke any active share
          links from the report page and contact us immediately.
        </p>

        <h2>5. Sharing</h2>
        <p>
          When you generate a share link or invite a friend or clinician, you are
          deliberately authorising that person to view the health information attached
          to that link or invitation. You can revoke access at any time. Plexara is
          not responsible for what an authorised recipient does with the information
          after they have viewed it.
        </p>

        <h2>6. Acceptable use</h2>
        <p>
          You agree not to: upload health data that is not yours or that you are not
          authorised to upload; attempt to reverse-engineer the AI models or scrape
          the service; abuse, harass, or impersonate other users; use the service
          for any unlawful purpose.
        </p>

        <h2>7. Service changes and availability</h2>
        <p>
          We may add, remove, or change features at any time, and we may suspend the
          service for maintenance. We will give reasonable notice of material changes
          to these Terms or to the medical disclaimer; continued use after the change
          constitutes acceptance.
        </p>

        <h2>8. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Plexara is provided "as is" without
          warranties of any kind, and our total liability to you for any claim arising
          out of your use of the service is limited to the amount you have paid us in
          the twelve months preceding the claim, or USD 100, whichever is greater.
        </p>

        <h2>9. Termination</h2>
        <p>
          You may delete your account and export your data at any time from the
          Settings page. We may terminate accounts that violate these Terms.
        </p>

        <h2>10. Governing law</h2>
        <p>
          These Terms are governed by the laws of the jurisdiction in which Plexara
          is operated. Disputes will be resolved in the courts of that jurisdiction
          unless mandatory consumer-protection law in your country provides otherwise.
        </p>

        <h2>11. Contact</h2>
        <p>
          Questions about these Terms? Reach the operator of this Plexara instance
          at the contact address listed on the Help page.
        </p>
      </CardContent></Card>
    </div>
  );
}
