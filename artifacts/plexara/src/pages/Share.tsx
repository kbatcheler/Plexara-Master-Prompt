import { useEffect, useState } from "react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Copy, Loader2, Share2, ShieldOff, Eye } from "lucide-react";
import { useToast } from "../hooks/use-toast";

interface ShareLink {
  id: number;
  token: string;
  label: string | null;
  recipientName: string | null;
  permissions: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

interface AccessLog {
  id: number;
  shareLinkId: number;
  accessedAt: string;
  ipHash: string | null;
  userAgent: string | null;
  action: string;
}

export default function Share() {
  const { patientId } = useCurrentPatient();
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [recipient, setRecipient] = useState("");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(14);
  const [creating, setCreating] = useState(false);
  const [accessByLink, setAccessByLink] = useState<Record<number, AccessLog[]>>({});
  const { toast } = useToast();

  async function load() {
    if (!patientId) return;
    try {
      const list = await api<ShareLink[]>(`/patients/${patientId}/share-links`);
      setLinks(list);
    } catch {
      setLinks([]);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [patientId]);

  async function create() {
    if (!patientId) return;
    setCreating(true);
    try {
      await api(`/patients/${patientId}/share-links`, {
        method: "POST",
        body: JSON.stringify({ label, recipientName: recipient, expiresInDays: days }),
      });
      setRecipient(""); setLabel(""); setDays(14);
      toast({ title: "Share link created" });
      await load();
    } catch {
      toast({ title: "Could not create link", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: number) {
    if (!patientId) return;
    try {
      await api(`/patients/${patientId}/share-links/${id}`, { method: "DELETE" });
      await load();
    } catch {
      toast({ title: "Revoke failed", variant: "destructive" });
    }
  }

  async function viewAccess(id: number) {
    if (!patientId) return;
    try {
      const log = await api<AccessLog[]>(`/patients/${patientId}/share-links/${id}/access`);
      setAccessByLink((prev) => ({ ...prev, [id]: log }));
    } catch {
      toast({ title: "Could not load access log", variant: "destructive" });
    }
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/share/${token}`;
    void navigator.clipboard.writeText(url);
    toast({ title: "Link copied to clipboard" });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-semibold tracking-tight">Physician collaboration</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate time-limited links so a clinician can view your interpretation, gauges, and recent biomarkers — no sign-up required.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New share link</CardTitle>
          <CardDescription>The recipient can open the link until it expires or you revoke it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Recipient name</Label>
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Dr. Patel" />
            </div>
            <div>
              <Label className="text-xs">Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Cardiology consult" />
            </div>
            <div>
              <Label className="text-xs">Expires in (days)</Label>
              <Input type="number" min={1} max={90} value={days} onChange={(e) => setDays(parseInt(e.target.value) || 14)} />
            </div>
          </div>
          <Button onClick={create} disabled={creating}>
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Share2 className="w-4 h-4 mr-2" />}
            Create link
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active and past links</CardTitle>
        </CardHeader>
        <CardContent>
          {links === null && <Loader2 className="w-4 h-4 animate-spin" />}
          {links && links.length === 0 && <p className="text-sm text-muted-foreground">No share links yet.</p>}
          {links && links.length > 0 && (
            <div className="space-y-3">
              {links.map((l) => {
                const expired = new Date(l.expiresAt) < new Date();
                const status = l.revokedAt ? "revoked" : expired ? "expired" : "active";
                return (
                  <div key={l.id} className="rounded-md border border-border/40 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{l.label || "Untitled"}</span>
                          <Badge variant={status === "active" ? "default" : "outline"} className="text-[10px] capitalize">{status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {l.recipientName || "Anyone with the link"} • expires {new Date(l.expiresAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => copyLink(l.token)} title="Copy link">
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => viewAccess(l.id)} title="View access log">
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {status === "active" && (
                          <Button size="sm" variant="ghost" onClick={() => revoke(l.id)} title="Revoke">
                            <ShieldOff className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {accessByLink[l.id] && (
                      <div className="text-xs text-muted-foreground border-t border-border/30 pt-2">
                        {accessByLink[l.id].length === 0 ? "No accesses yet." : (
                          <ul className="space-y-1">
                            {accessByLink[l.id].slice(0, 5).map((a) => (
                              <li key={a.id} className="font-mono">
                                {new Date(a.accessedAt).toLocaleString()} · {a.action}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
