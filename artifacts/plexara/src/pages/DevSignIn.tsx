import { useState } from "react";
import { useLocation } from "wouter";
import { api } from "../lib/api";
import { setDevSignedIn } from "../lib/dev-auth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Loader2, KeyRound } from "lucide-react";

export default function DevSignIn() {
  const [, setLocation] = useLocation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function login() {
    setBusy(true); setErr(null);
    try {
      await api<{ ok: true }>("/dev-auth/login", { method: "POST", body: JSON.stringify({}) });
      setDevSignedIn(true);
      setLocation("/dashboard");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary" /> Dev test login</CardTitle>
          <CardDescription>
            One-click sign-in as the development test user (<code className="text-xs">dev_test_user_001</code>). Bypasses Clerk while OAuth issues are resolved. This page is disabled in production.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={login} disabled={busy} className="w-full" data-testid="dev-login-btn">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Sign in as test user
          </Button>
          {err && <p className="text-sm text-destructive">Login failed: {err}</p>}
          <p className="text-[11px] text-muted-foreground">
            All your patient data, uploads, and interpretations under this user persist between sessions until you sign out.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
