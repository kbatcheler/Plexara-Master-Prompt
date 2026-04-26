import { useState } from "react";
import { Link } from "wouter";
import { useClerk } from "@clerk/react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { useListPatients } from "@workspace/api-client-react";
import { api } from "../lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, AlertTriangle, ScrollText } from "lucide-react";

// Keep this in lockstep with `PLATFORM_CONSENT_VERSION` on the server. When
// the legal/disclaimer bundle changes materially, bump both. The gate then
// re-prompts every existing patient on next login because their stored
// version no longer matches.
const PLATFORM_CONSENT_VERSION = "1.0";

interface ConsentGateProps {
  children: React.ReactNode;
}

/**
 * Full-screen blocker that prevents the rest of the app from rendering until
 * the current patient has accepted the latest legal + medical disclaimer
 * bundle. Sits inside ProtectedRoute, AFTER OnboardingGate (we need a
 * patient to record consent against).
 */
export function ConsentGate({ children }: ConsentGateProps) {
  const { patient, isLoading } = useCurrentPatient();
  const { refetch } = useListPatients();
  const { signOut } = useClerk();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (isLoading || !patient) return <>{children}</>;

  const accepted =
    !!patient.platformConsentAcceptedAt &&
    patient.platformConsentVersion === PLATFORM_CONSENT_VERSION;

  if (accepted) return <>{children}</>;

  // The patient hasn't consented (new account) or has consented to an older
  // version (the legal bundle has been updated). Block all routes until they
  // explicitly accept the current version.
  const handleAccept = async () => {
    if (!agreed || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      await api(`/patients/${patient.id}/consent`, {
        method: "POST",
        body: JSON.stringify({ version: PLATFORM_CONSENT_VERSION }),
      });
      // Re-fetch the patient list so the gate sees the new
      // platformConsentAcceptedAt value and unblocks.
      await refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not record your acceptance. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const isUpdate = !!patient.platformConsentAcceptedAt;

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex items-center justify-center p-4 md:p-8">
        <Card className="max-w-2xl w-full" data-testid="consent-gate">
          <CardContent className="py-8 px-6 md:px-10 space-y-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-6 h-6 text-primary shrink-0 mt-1" />
              <div>
                <h1 className="text-2xl font-serif tracking-tight">
                  {isUpdate ? "We've updated our terms" : "Welcome to Plexara"}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {isUpdate
                    ? "Please review and accept the updated documents to continue."
                    : "Before you upload anything, please read and accept the following."}
                </p>
              </div>
            </div>

            <div className="border border-status-urgent/30 bg-status-urgent/5 rounded-lg p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-status-urgent shrink-0 mt-0.5" />
                <div className="space-y-1.5 text-sm">
                  <p className="font-semibold text-foreground">Plexara is not medical advice</p>
                  <p className="text-muted-foreground leading-relaxed">
                    The interpretations you'll see are AI-generated summaries of records you upload.
                    They can be wrong, incomplete, or out of date. Always discuss what you see
                    with a qualified clinician before making any health decision. In an emergency,
                    call your local emergency number — do not consult Plexara first.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ScrollText className="w-4 h-4 text-muted-foreground" />
                What you're agreeing to
              </div>
              <ul className="text-sm text-muted-foreground space-y-1.5 ml-6 list-disc">
                {/* Plain anchor with target="_blank" rather than wouter <Link>
                    so the user can read the docs in a new tab without losing
                    their place in the consent flow. The target pages render
                    standalone (they're outside ProtectedRoute). */}
                <li>
                  Our{" "}
                  <a href="/terms" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">Terms of Service</a>
                  {" "}— how the platform works and what we both agree to.
                </li>
                <li>
                  Our{" "}
                  <a href="/privacy" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
                  {" "}— what we collect, how it's protected, and your rights.
                </li>
                <li>
                  Our{" "}
                  <a href="/disclaimer" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">Medical Disclaimer</a>
                  {" "}— Plexara is informational only and does not replace your doctor.
                </li>
              </ul>
            </div>

            <label className="flex items-start gap-3 p-4 rounded-lg border border-border bg-secondary/30 cursor-pointer hover:bg-secondary/50">
              <Checkbox
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
                className="mt-0.5"
                data-testid="consent-checkbox"
              />
              <span className="text-sm leading-relaxed">
                I have read and accept the Terms of Service, Privacy Policy, and Medical
                Disclaimer above. I understand that Plexara is informational only and is
                not a substitute for medical advice from a qualified clinician.
              </span>
            </label>

            {err && (
              <p className="text-sm text-status-urgent" data-testid="consent-error">{err}</p>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => signOut({ redirectUrl: "/sign-in" })}
                className="text-muted-foreground"
                data-testid="consent-signout"
              >
                Sign out instead
              </Button>
              <Button
                onClick={handleAccept}
                disabled={!agreed || submitting}
                size="lg"
                data-testid="consent-accept"
              >
                {submitting ? "Saving…" : "Accept and continue"}
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground text-center">
              Version {PLATFORM_CONSENT_VERSION} · Recorded with timestamp on acceptance
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
