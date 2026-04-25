import { useEffect, useState } from "react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, BookOpenCheck, Check, AlertCircle } from "lucide-react";
import { useToast } from "../hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ProtocolComponent { type: string; name: string; dosage?: string; frequency?: string; notes?: string }
interface Protocol {
  id: number;
  slug: string;
  name: string;
  category: string;
  description: string;
  evidenceLevel: string;
  durationWeeks: number | null;
  requiresPhysician: boolean;
  componentsJson: ProtocolComponent[];
  citations: string[] | null;
  retestBiomarkers: string[] | null;
  retestIntervalWeeks: number | null;
}
interface EligibilityEntry {
  protocol: Protocol;
  matches: Array<{ rule: { biomarker: string; comparator: string; value?: number; low?: number; high?: number }; met: boolean; observed: number | null; reason: string }>;
  eligible: boolean;
  alreadyAdopted: boolean;
}
interface Adoption {
  id: number;
  protocolId: number;
  status: string;
  startedAt: string;
  endedAt: string | null;
  nextRetestAt: string | null;
  protocol: Protocol | null;
}

function evidenceTone(level: string): string {
  const l = level.toLowerCase();
  if (l === "strong" || l === "high") return "border-status-optimal/40 text-status-optimal bg-status-optimal/5";
  if (l === "moderate" || l === "medium") return "border-status-normal/40 text-status-normal bg-status-normal/5";
  return "border-border text-muted-foreground bg-secondary/40";
}

function ProtocolCard({ p, eligible, alreadyAdopted, onAdopt, adopting }: { p: Protocol; eligible?: boolean; alreadyAdopted?: boolean; onAdopt?: () => void; adopting?: boolean }) {
  return (
    <Card className={`transition-shadow hover:shadow-md ${eligible ? "border-l-4 border-l-primary" : ""}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-lg font-heading font-semibold">{p.name}</CardTitle>
            <CardDescription className="font-serif leading-relaxed mt-1">{p.description}</CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{p.category}</Badge>
            <Badge variant="outline" className={`text-[10px] uppercase tracking-wide capitalize ${evidenceTone(p.evidenceLevel)}`}>{p.evidenceLevel} evidence</Badge>
            {p.requiresPhysician && <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-status-watch/40 text-status-watch bg-status-watch/5">Physician-guided</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2">Components</p>
          <ul className="text-sm space-y-1.5">
            {p.componentsJson.map((c, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-muted-foreground capitalize w-24 shrink-0 text-xs pt-0.5">{c.type}</span>
                <span className="leading-relaxed"><strong className="font-medium">{c.name}</strong>{c.dosage ? <span className="text-muted-foreground"> — {c.dosage}</span> : ""}{c.frequency ? <span className="text-muted-foreground">, {c.frequency}</span> : ""}{c.notes ? <span className="text-muted-foreground italic"> ({c.notes})</span> : ""}</span>
              </li>
            ))}
          </ul>
        </div>
        {p.retestBiomarkers && p.retestIntervalWeeks && (
          <p className="text-xs text-muted-foreground">Retest {p.retestBiomarkers.join(", ")} after {p.retestIntervalWeeks} weeks.</p>
        )}
        {p.citations && p.citations.length > 0 && (
          <p className="text-[11px] text-muted-foreground italic border-l-2 border-border pl-3">{p.citations.join(" · ")}</p>
        )}
        {onAdopt && (
          <div className="flex items-center gap-2 pt-2">
            {alreadyAdopted ? (
              <Badge variant="secondary" className="text-xs"><Check className="w-3 h-3 mr-1" />Already adopted</Badge>
            ) : (
              <Button size="sm" onClick={onAdopt} disabled={adopting}>
                {adopting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                Adopt protocol
              </Button>
            )}
            {eligible !== undefined && !alreadyAdopted && (
              eligible
                ? <span className="text-xs text-status-optimal flex items-center gap-1 font-medium"><Check className="w-3 h-3" />Matches your data</span>
                : <span className="text-xs text-muted-foreground flex items-center gap-1"><AlertCircle className="w-3 h-3" />No matching biomarker yet</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Protocols() {
  const { patientId } = useCurrentPatient();
  const [eligibility, setEligibility] = useState<EligibilityEntry[] | null>(null);
  const [adoptions, setAdoptions] = useState<Adoption[] | null>(null);
  const [allProtocols, setAllProtocols] = useState<Protocol[] | null>(null);
  const [adoptingId, setAdoptingId] = useState<number | null>(null);
  const { toast } = useToast();

  async function load() {
    api<Protocol[]>("/protocols").then(setAllProtocols).catch(() => setAllProtocols([]));
    if (!patientId) return;
    api<EligibilityEntry[]>(`/patients/${patientId}/protocols/eligibility`).then(setEligibility).catch(() => setEligibility([]));
    api<Adoption[]>(`/patients/${patientId}/protocols/adoptions`).then(setAdoptions).catch(() => setAdoptions([]));
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [patientId]);

  async function adopt(protocolId: number) {
    if (!patientId) return;
    setAdoptingId(protocolId);
    try {
      await api(`/patients/${patientId}/protocols/adoptions`, { method: "POST", body: JSON.stringify({ protocolId }) });
      toast({ title: "Protocol adopted", description: "Supplements added to your stack." });
      await load();
    } catch {
      toast({ title: "Could not adopt protocol", variant: "destructive" });
    } finally {
      setAdoptingId(null);
    }
  }

  async function updateAdoption(id: number, status: string) {
    if (!patientId) return;
    try {
      await api(`/patients/${patientId}/protocols/adoptions/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  }

  const recommended = eligibility?.filter((e) => e.eligible) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-semibold tracking-tight">Protocol library</h1>
        <p className="text-sm text-muted-foreground mt-1">Evidence-based intervention bundles. Adoption adds the supplement components to your stack.</p>
      </div>

      <Tabs defaultValue="recommended">
        <TabsList>
          <TabsTrigger value="recommended">For you ({recommended.length})</TabsTrigger>
          <TabsTrigger value="active">Active ({adoptions?.filter((a) => a.status === "active").length ?? 0})</TabsTrigger>
          <TabsTrigger value="library">All protocols</TabsTrigger>
        </TabsList>

        <TabsContent value="recommended" className="space-y-4 mt-4">
          {!eligibility && <Loader2 className="w-4 h-4 animate-spin" />}
          {eligibility && recommended.length === 0 && (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              <BookOpenCheck className="w-8 h-8 mx-auto mb-2 opacity-50" />
              No protocol matches your current biomarkers. Upload more records or check the full library.
            </CardContent></Card>
          )}
          {recommended.map((e) => (
            <ProtocolCard key={e.protocol.id} p={e.protocol} eligible={e.eligible} alreadyAdopted={e.alreadyAdopted} onAdopt={() => adopt(e.protocol.id)} adopting={adoptingId === e.protocol.id} />
          ))}
        </TabsContent>

        <TabsContent value="active" className="space-y-4 mt-4">
          {!adoptions && <Loader2 className="w-4 h-4 animate-spin" />}
          {adoptions && adoptions.filter((a) => a.status === "active").length === 0 && (
            <p className="text-sm text-muted-foreground">No active protocols.</p>
          )}
          {adoptions?.filter((a) => a.status === "active").map((a) => (
            <Card key={a.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{a.protocol?.name ?? "Protocol"}</CardTitle>
                    <CardDescription>
                      Started {new Date(a.startedAt).toLocaleDateString()}
                      {a.nextRetestAt && <> · retest by {new Date(a.nextRetestAt).toLocaleDateString()}</>}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => updateAdoption(a.id, "completed")}>Mark completed</Button>
                    <Button size="sm" variant="ghost" onClick={() => updateAdoption(a.id, "discontinued")}>Discontinue</Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="library" className="space-y-4 mt-4">
          {!allProtocols && <Loader2 className="w-4 h-4 animate-spin" />}
          {allProtocols?.map((p) => (
            <ProtocolCard
              key={p.id}
              p={p}
              alreadyAdopted={adoptions?.some((a) => a.protocolId === p.id && a.status === "active")}
              onAdopt={() => adopt(p.id)}
              adopting={adoptingId === p.id}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
