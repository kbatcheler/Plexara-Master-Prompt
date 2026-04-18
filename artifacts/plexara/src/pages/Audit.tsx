import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface AuditEntry {
  id: number;
  patientId: number | null;
  actionType: string;
  llmProvider: string | null;
  dataSentHash: string | null;
  timestamp: string;
}

export default function Audit() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    api<AuditEntry[]>("/me/audit").then(setEntries).catch(() => setEntries([]));
  }, []);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every action that touched your data — uploads, AI interpretations, deletions, and shares.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Up to the last 200 events.</CardDescription>
        </CardHeader>
        <CardContent>
          {entries === null && <Loader2 className="w-4 h-4 animate-spin" />}
          {entries && entries.length === 0 && (
            <p className="text-sm text-muted-foreground">No audit events yet. Activity appears as soon as you upload a record or run an interpretation.</p>
          )}
          {entries && entries.length > 0 && (
            <div className="space-y-2">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-4 py-2 border-b border-border/40 last:border-0">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{e.actionType}</span>
                      {e.llmProvider && <Badge variant="outline" className="text-[10px]">{e.llmProvider}</Badge>}
                    </div>
                    {e.dataSentHash && (
                      <span className="text-xs text-muted-foreground font-mono mt-0.5">
                        sha256: {e.dataSentHash.slice(0, 16)}…
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(e.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
