import { useEffect, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useActivePatient } from "../context/ActivePatientContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Activity, Loader2, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";

interface InviteDetails {
  id: number;
  invitedEmail: string;
  role: string | null;
  status: string;
  expiresAt: string;
  patientDisplayName: string;
}

export default function AcceptInvite() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const [, setLocation] = useLocation();
  const { isSignedIn, isLoaded } = useUser();
  const { setActivePatientId } = useActivePatient();
  const queryClient = useQueryClient();

  const [details, setDetails] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{ patientId: number; displayName: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<InviteDetails>(`/invitations/${token}`)
      .then((d) => { if (!cancelled) setDetails(d); })
      .catch((err: Error & { status?: number }) => {
        if (cancelled) return;
        if (err.status === 404) setLoadError("This invitation link is invalid or no longer exists.");
        else setLoadError("We couldn't load this invitation. Please try again.");
      });
    return () => { cancelled = true; };
  }, [token]);

  const accept = async () => {
    setAccepting(true);
    setAcceptError(null);
    try {
      const result = await api<{ patientId: number; patientDisplayName: string }>(
        `/invitations/${token}/accept`,
        { method: "POST" },
      );
      setAccepted({ patientId: result.patientId, displayName: result.patientDisplayName });
      setActivePatientId(result.patientId);
      queryClient.invalidateQueries({ queryKey: ["/patients"] });
      queryClient.invalidateQueries();
    } catch (err) {
      const e = err as Error & { status?: number; detail?: { error?: string } };
      if (e.status === 410) setAcceptError("This invitation has expired or been revoked.");
      else if (e.status === 409) setAcceptError("You already have access to this patient.");
      else setAcceptError(e.detail?.error ?? "We couldn't accept this invitation. Please try again.");
    } finally {
      setAccepting(false);
    }
  };

  // Once accepted, give the user a moment to see confirmation, then route
  // them to the dashboard with the new patient already active.
  useEffect(() => {
    if (!accepted) return;
    const t = window.setTimeout(() => setLocation("/dashboard"), 1500);
    return () => window.clearTimeout(t);
  }, [accepted, setLocation]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <Activity className="w-5 h-5 text-primary" />
          <span className="font-semibold tracking-tight">Plexara</span>
        </div>

        <Card data-testid="accept-invite-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              You've been invited
            </CardTitle>
            <CardDescription>
              Someone wants to share a Plexara health profile with you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadError && (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle>Invitation unavailable</AlertTitle>
                <AlertDescription>{loadError}</AlertDescription>
              </Alert>
            )}

            {!loadError && !details && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading invitation…
              </div>
            )}

            {details && details.status !== "pending" && !accepted && (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle className="capitalize">Invitation {details.status}</AlertTitle>
                <AlertDescription>
                  This link can no longer be used. Please ask the person who invited you to
                  send a new one.
                </AlertDescription>
              </Alert>
            )}

            {details && details.status === "pending" && !accepted && (
              <>
                <div className="rounded-lg border border-border bg-card/50 p-4 space-y-2">
                  <p className="text-sm">
                    <span className="text-muted-foreground">Patient: </span>
                    <span className="font-medium" data-testid="invite-patient-name">
                      {details.patientDisplayName}
                    </span>
                  </p>
                  {details.role && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Your relationship: </span>
                      <span className="font-medium">{details.role}</span>
                    </p>
                  )}
                  <p className="text-sm">
                    <span className="text-muted-foreground">Invited: </span>
                    <span className="font-medium">{details.invitedEmail}</span>
                  </p>
                </div>

                <Alert>
                  <ShieldCheck className="w-4 h-4" />
                  <AlertTitle>What this means</AlertTitle>
                  <AlertDescription>
                    Accepting gives you full read &amp; write access to this person's
                    Plexara records, gauges, narrative, and reports. You won't be able to
                    invite other people. The owner can revoke your access at any time.
                  </AlertDescription>
                </Alert>

                {!isLoaded ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Checking your sign-in…
                  </div>
                ) : !isSignedIn ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Sign in (or create a free account) to accept. We'll bring you back
                      here.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild data-testid="invite-signin">
                        <Link href={`/sign-in?redirect_url=${encodeURIComponent(`/invitations/${token}`)}`}>
                          Sign in
                        </Link>
                      </Button>
                      <Button asChild variant="outline" data-testid="invite-signup">
                        <Link href={`/sign-up?redirect_url=${encodeURIComponent(`/invitations/${token}`)}`}>
                          Create account
                        </Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {acceptError && (
                      <Alert variant="destructive">
                        <AlertTriangle className="w-4 h-4" />
                        <AlertDescription>{acceptError}</AlertDescription>
                      </Alert>
                    )}
                    <Button
                      type="button"
                      onClick={accept}
                      disabled={accepting}
                      className="w-full"
                      data-testid="invite-accept"
                    >
                      {accepting ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Accepting…</>
                      ) : (
                        <>Accept invitation</>
                      )}
                    </Button>
                  </div>
                )}
              </>
            )}

            {accepted && (
              <Alert className="border-emerald-500/40 bg-emerald-500/5" data-testid="accept-success">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <AlertTitle>You're in</AlertTitle>
                <AlertDescription>
                  You now have access to {accepted.displayName}. Taking you to the
                  dashboard…
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
