import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ConsentScope {
  key: string;
  category: string;
  label: string;
  description: string;
  granted: boolean;
  version: number;
  updatedAt: string | null;
}

interface DataResidency {
  region: string;
  setAt: string | null;
}

interface DataRequest {
  id: number;
  type: string;
  status: string;
  details: string | null;
  requestedAt: string;
  completedAt: string | null;
  resolutionNotes: string | null;
}

const REGION_LABELS: Record<string, string> = {
  "us-east": "United States — East",
  "us-west": "United States — West",
  "eu-west": "European Union — West (Frankfurt/Dublin)",
  "ap-southeast": "Asia-Pacific — Southeast (Singapore/Sydney)",
};

export default function Consents() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const consentsQ = useQuery<{ scopes: ConsentScope[] }>({ queryKey: ["consents"], queryFn: () => api("/me/consents") });
  const residencyQ = useQuery<DataResidency>({ queryKey: ["residency"], queryFn: () => api("/me/data-residency") });
  const requestsQ = useQuery<DataRequest[]>({ queryKey: ["data-requests"], queryFn: () => api("/me/data-requests") });

  const setConsentMut = useMutation({
    mutationFn: ({ key, granted }: { key: string; granted: boolean }) =>
      api(`/me/consents/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ granted }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consents"] }),
  });

  const setResidencyMut = useMutation({
    mutationFn: (region: string) => api("/me/data-residency", { method: "PUT", body: JSON.stringify({ region }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["residency"] }),
  });

  const [reqType, setReqType] = useState("export");
  const [reqDetails, setReqDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitDataRequest() {
    setSubmitting(true);
    try {
      await api("/me/data-requests", { method: "POST", body: JSON.stringify({ type: reqType, details: reqDetails || null }) });
      setReqDetails("");
      qc.invalidateQueries({ queryKey: ["data-requests"] });
      toast({ title: "Request submitted", description: "Our team will respond within 30 days." });
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function downloadBaa() {
    const res = await fetch("/api/me/baa-report", { credentials: "include" });
    const json = await res.json();
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plexara-compliance-report-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const scopesByCategory = (consentsQ.data?.scopes ?? []).reduce<Record<string, ConsentScope[]>>((acc, s) => {
    (acc[s.category] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-semibold tracking-tight flex items-center gap-3">
          <ShieldCheck className="w-7 h-7 text-primary" /> Consent & data control
        </h1>
        <p className="text-muted-foreground mt-1">Granular control over who sees your data and where it lives.</p>
      </div>

      {/* Consents */}
      <Card>
        <CardHeader>
          <CardTitle>AI provider consent</CardTitle>
          <CardDescription>Each interpretation lens sees only de-identified data. You decide which providers participate.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {Object.entries(scopesByCategory).map(([category, scopes]) => (
            <div key={category}>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">{category}</div>
              <div className="space-y-3">
                {scopes.map((s) => (
                  <div key={s.key} className="flex items-start justify-between gap-4 p-3 rounded-md bg-secondary/20 border border-border/40">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`c-${s.key}`} className="font-medium">{s.label}</Label>
                        {s.version > 0 && <Badge variant="outline" className="text-[10px]">v{s.version}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
                      {s.updatedAt && <p className="text-[10px] text-muted-foreground/70 mt-1">Last changed {new Date(s.updatedAt).toLocaleString()}</p>}
                    </div>
                    <Switch
                      id={`c-${s.key}`}
                      checked={s.granted}
                      data-testid={`consent-${s.key}`}
                      onCheckedChange={(g) => setConsentMut.mutate({ key: s.key, granted: g })}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Residency */}
      <Card>
        <CardHeader>
          <CardTitle>Data residency</CardTitle>
          <CardDescription>Choose the geographic region where your data is stored at rest.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Select value={residencyQ.data?.region ?? "us-east"} onValueChange={(v) => setResidencyMut.mutate(v)}>
              <SelectTrigger className="max-w-md" data-testid="residency-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(REGION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            {residencyQ.data?.setAt && <span className="text-xs text-muted-foreground">Set {new Date(residencyQ.data.setAt).toLocaleDateString()}</span>}
          </div>
        </CardContent>
      </Card>

      {/* BAA report */}
      <Card>
        <CardHeader>
          <CardTitle>Compliance posture report</CardTitle>
          <CardDescription>Downloadable JSON suitable for review by a clinician, BAA partner, or compliance auditor.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={downloadBaa} data-testid="download-baa">
            <Download className="w-4 h-4 mr-2" /> Download report
          </Button>
        </CardContent>
      </Card>

      {/* Data requests */}
      <Card>
        <CardHeader>
          <CardTitle>Submit a data request</CardTitle>
          <CardDescription>Export, access, correct, or delete your stored data. Resolved within 30 days.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={reqType} onValueChange={setReqType}>
              <SelectTrigger className="sm:max-w-[180px]" data-testid="request-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="export">Export</SelectItem>
                <SelectItem value="access">Access</SelectItem>
                <SelectItem value="correction">Correction</SelectItem>
                <SelectItem value="delete">Delete</SelectItem>
              </SelectContent>
            </Select>
            <Textarea placeholder="Optional details" value={reqDetails} onChange={(e) => setReqDetails(e.target.value)} rows={2} />
          </div>
          <Button onClick={submitDataRequest} disabled={submitting} data-testid="submit-request">
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Submit request
          </Button>

          {(requestsQ.data?.length ?? 0) > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Your requests</div>
              <ul className="divide-y divide-border/40 text-sm">
                {requestsQ.data!.map((r) => (
                  <li key={r.id} className="py-2 flex items-center justify-between">
                    <div>
                      <Badge variant="outline" className="mr-2">{r.type}</Badge>
                      <span className="text-muted-foreground">{r.status}</span>
                      {r.details && <span className="text-xs text-muted-foreground ml-2 italic">— {r.details}</span>}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(r.requestedAt).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
