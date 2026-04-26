import { Link } from "wouter";
import { ChevronLeft, AlertTriangle, Phone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Standalone medical disclaimer page. Linked from the footer and from the
 * one-time ConsentGate. Kept simple and short — the goal is for a worried
 * user to read this, understand the limits, and know exactly what to do
 * if they're scared by something they see in the app.
 */
export default function Disclaimer() {
  return (
    <div className="max-w-3xl mx-auto py-10 space-y-6">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Back to dashboard
      </Link>

      <div>
        <h1 className="text-3xl font-serif tracking-tight">Medical disclaimer</h1>
        <p className="text-sm text-muted-foreground mt-1">Effective: April 26, 2026 · Version 1.0</p>
      </div>

      <Card className="border-status-urgent/40 bg-status-urgent/5">
        <CardContent className="py-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-status-urgent shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-foreground">
                Plexara is not a doctor and does not give medical advice.
              </p>
              <p className="text-muted-foreground">
                Everything you see in this app — gauges, alerts, narratives, the comprehensive
                report, chat answers — is an AI-generated interpretation of the records you
                uploaded. AI can be wrong. Use this app to ask better questions of a real
                clinician, not as a substitute for one.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card><CardContent className="prose prose-sm dark:prose-invert max-w-none py-6 space-y-4">
        <h2>What Plexara is</h2>
        <p>
          A tool that takes the lab reports and imaging you upload, runs them through
          three independent AI models, and shows you the consensus and disagreements
          in plain English (or in clinician-style language if you toggle that mode).
        </p>

        <h2>What Plexara is not</h2>
        <ul>
          <li>It is not a medical device.</li>
          <li>It is not a regulated diagnostic tool.</li>
          <li>It does not replace your doctor.</li>
          <li>It cannot detect every condition, and it can be confidently wrong.</li>
          <li>It does not know about your symptoms, lifestyle, family history, or current
              prescriptions unless you tell it — and even then, it is still just an
              informational summary.</li>
        </ul>

        <h2>If you are worried about something you see</h2>
        <ol>
          <li>
            Take a screenshot or note the specific gauge, biomarker, or alert that
            concerned you.
          </li>
          <li>Contact your overseeing physician or general practitioner.</li>
          <li>
            For anything urgent — chest pain, sudden severe symptoms, signs of stroke,
            severe allergic reaction, suicidal thoughts — call your local emergency
            number immediately. Do not wait to discuss anything in this app first.
          </li>
        </ol>
      </CardContent></Card>

      <Card className="border-primary/30">
        <CardContent className="py-5">
          <div className="flex items-start gap-3">
            <Phone className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-foreground">Emergency numbers</p>
              <p className="text-muted-foreground">
                US / Canada: 911 · UK: 999 · EU: 112 · Australia: 000 ·
                International: see your local emergency services.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
