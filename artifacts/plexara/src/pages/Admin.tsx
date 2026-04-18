import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Loader2 } from "lucide-react";

interface AdminUser { account_id: string; patient_count: number; record_count: number; last_record_at: string | null }
interface AuditEntry { id: number; patientId: number; actionType: string; llmProvider: string | null; dataSentHash: string | null; createdAt: string; timestamp: string }
interface DataRequest { id: number; accountId: string; type: string; status: string; details: string | null; requestedAt: string; resolutionNotes: string | null }
interface Profile { isAdmin: boolean }

export default function Admin() {
  const profileQ = useQuery<Profile>({ queryKey: ["profile"], queryFn: () => api("/me/profile") });

  if (profileQ.isLoading) {
    return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Checking access…</div>;
  }
  if (!profileQ.data?.isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-12 text-center">
        <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">Admin access required</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Your account is not in the admin allowlist. To grant admin access, add your Clerk user ID to the
          <code className="mx-1 px-1 bg-secondary/40 rounded">PLEXARA_ADMIN_USER_IDS</code> environment variable
          (comma-separated).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-semibold tracking-tight flex items-center gap-3">
          <Shield className="w-7 h-7 text-primary" /> Admin console
        </h1>
        <p className="text-muted-foreground mt-1">Internal operator tools for compliance and oversight.</p>
      </div>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          <TabsTrigger value="requests">Data requests</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditTab /></TabsContent>
        <TabsContent value="requests" className="mt-4"><RequestsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function UsersTab() {
  const q = useQuery<AdminUser[]>({ queryKey: ["admin-users"], queryFn: () => api("/admin/users") });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">All accounts</CardTitle></CardHeader>
      <CardContent>
        {q.isLoading ? "Loading…" : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground uppercase">
              <tr><th className="text-left py-2">Account</th><th className="text-right">Patients</th><th className="text-right">Records</th><th className="text-right">Last upload</th></tr>
            </thead>
            <tbody>
              {q.data?.map((u) => (
                <tr key={u.account_id} className="border-t border-border/30">
                  <td className="py-2 font-mono text-xs">{u.account_id}</td>
                  <td className="text-right">{u.patient_count}</td>
                  <td className="text-right">{u.record_count}</td>
                  <td className="text-right text-muted-foreground">{u.last_record_at ? new Date(u.last_record_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function AuditTab() {
  const q = useQuery<AuditEntry[]>({ queryKey: ["admin-audit"], queryFn: () => api("/admin/audit") });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Recent audit events (last 500)</CardTitle></CardHeader>
      <CardContent>
        {q.isLoading ? "Loading…" : (
          <ul className="divide-y divide-border/40 text-sm">
            {q.data?.map((a) => (
              <li key={a.id} className="py-2 flex items-center justify-between">
                <div>
                  <Badge variant="outline" className="mr-2">{a.actionType}</Badge>
                  {a.llmProvider && <span className="text-xs text-muted-foreground mr-2">{a.llmProvider}</span>}
                  <span className="text-xs text-muted-foreground">patient #{a.patientId}</span>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(a.createdAt || a.timestamp).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RequestsTab() {
  const qc = useQueryClient();
  const q = useQuery<DataRequest[]>({ queryKey: ["admin-requests"], queryFn: () => api("/admin/data-requests") });
  const [notes, setNotes] = useState<Record<number, string>>({});
  const updateMut = useMutation({
    mutationFn: ({ id, status, resolutionNotes }: { id: number; status: string; resolutionNotes?: string }) =>
      api(`/admin/data-requests/${id}`, { method: "PATCH", body: JSON.stringify({ status, resolutionNotes }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-requests"] }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Data requests</CardTitle></CardHeader>
      <CardContent>
        {q.isLoading ? "Loading…" : (q.data?.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground">No requests.</div>
        ) : (
          <ul className="divide-y divide-border/40">
            {q.data!.map((r) => (
              <li key={r.id} className="py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{r.type}</Badge>
                    <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge>
                    <span className="text-xs text-muted-foreground font-mono">{r.accountId.slice(0, 16)}…</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(r.requestedAt).toLocaleString()}</span>
                </div>
                {r.details && <div className="text-xs text-muted-foreground italic">{r.details}</div>}
                <div className="flex gap-2 items-center">
                  <input
                    placeholder="Resolution notes"
                    className="text-xs flex-1 bg-secondary/30 border border-border/40 rounded px-2 py-1"
                    value={notes[r.id] ?? r.resolutionNotes ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  />
                  <Select onValueChange={(status) => updateMut.mutate({ id: r.id, status, resolutionNotes: notes[r.id] })}>
                    <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Set status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="denied">Denied</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
