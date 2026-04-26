import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListPatients } from "@workspace/api-client-react";
import { useActivePatient } from "../context/ActivePatientContext";
import { api } from "../lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Copy, Check, Mail, Trash2, Users, Clock, ShieldCheck } from "lucide-react";

interface Invitation {
  id: number;
  invitedEmail: string;
  role: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  inviteUrl?: string;
}

interface Collaborator {
  id: number;
  accountId: string;
  role: string | null;
  joinedAt: string;
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(value).catch(() => {});
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }}
      data-testid="copy-invite-link"
    >
      {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export default function Sharing() {
  const { data: patients } = useListPatients();
  const { activePatientId } = useActivePatient();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const patientId = activePatientId;
  const activePatient = patients?.find((p) => p.id === patientId);
  const isOwner = activePatient?.relation !== "collaborator";

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [latestInviteUrl, setLatestInviteUrl] = useState<string | null>(null);

  const invitesQuery = useQuery<Invitation[]>({
    queryKey: ["invitations", patientId],
    queryFn: () => api<Invitation[]>(`/patients/${patientId}/invitations`),
    enabled: !!patientId && !!isOwner,
  });
  const collabsQuery = useQuery<Collaborator[]>({
    queryKey: ["collaborators", patientId],
    queryFn: () => api<Collaborator[]>(`/patients/${patientId}/collaborators`),
    enabled: !!patientId && !!isOwner,
  });

  const createInvite = useMutation({
    mutationFn: (body: { invitedEmail: string; role?: string | null }) =>
      api<Invitation>(`/patients/${patientId}/invitations`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (invite) => {
      setLatestInviteUrl(invite.inviteUrl ?? null);
      setEmail("");
      setRole("");
      queryClient.invalidateQueries({ queryKey: ["invitations", patientId] });
      toast({ title: "Invitation created", description: "Copy the link below and send it." });
    },
    onError: () => {
      toast({ title: "Could not create invitation", variant: "destructive" });
    },
  });

  const revokeInvite = useMutation({
    mutationFn: (id: number) =>
      api<void>(`/patients/${patientId}/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations", patientId] });
      toast({ title: "Invitation revoked" });
    },
  });

  const removeCollab = useMutation({
    mutationFn: (id: number) =>
      api<void>(`/patients/${patientId}/collaborators/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collaborators", patientId] });
      toast({ title: "Collaborator removed" });
    },
  });

  if (!patientId) {
    return (
      <div className="max-w-3xl">
        <p className="text-sm text-muted-foreground">Select a patient first.</p>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="max-w-3xl space-y-6" data-testid="sharing-page">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Friend access</h1>
          <p className="text-sm text-muted-foreground mt-1">
            You're viewing {activePatient?.displayName} as a guest collaborator. Only the
            account owner can invite or remove people.
          </p>
        </header>
        <Alert>
          <ShieldCheck className="w-4 h-4" />
          <AlertTitle>Read &amp; write access</AlertTitle>
          <AlertDescription>
            You can do everything the owner can — upload records, view interpretations, manage
            protocols — except inviting other people. The owner can revoke your access at any
            time.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const pending = (invitesQuery.data ?? []).filter((i) => i.status === "pending");
  const past = (invitesQuery.data ?? []).filter((i) => i.status !== "pending");

  return (
    <div className="max-w-3xl space-y-8" data-testid="sharing-page">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Friend access</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Invite someone you trust to view and help manage {activePatient?.displayName}'s
          health profile. They'll have the same access you do, except they can't invite or
          remove others.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="w-4 h-4" /> Invite someone
          </CardTitle>
          <CardDescription>
            We'll generate a private one-time link. You decide how to send it (text, email,
            in person). Links expire after 14 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-[1fr_180px_auto] items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!email) return;
              createInvite.mutate({ invitedEmail: email, role: role || null });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Their email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="friend@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="invite-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Their relationship</Label>
              <Input
                id="invite-role"
                placeholder="Spouse, parent…"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                data-testid="invite-role"
              />
            </div>
            <Button type="submit" disabled={createInvite.isPending} data-testid="invite-submit">
              {createInvite.isPending ? "Creating…" : "Create link"}
            </Button>
          </form>

          {latestInviteUrl && (
            <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3" data-testid="latest-invite-block">
              <p className="text-sm font-medium">Send them this link</p>
              <div className="flex items-center gap-2 rounded-md bg-background border border-border px-3 py-2">
                <code className="text-xs flex-1 truncate" data-testid="latest-invite-url">{latestInviteUrl}</code>
                <CopyButton value={latestInviteUrl} />
              </div>
              <p className="text-xs text-muted-foreground">
                This is the only time we'll show this link. Copy it now — you can always
                revoke it below if it's leaked.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="w-4 h-4" /> Pending invitations
          </CardTitle>
          <CardDescription>Links you've created that haven't been accepted yet.</CardDescription>
        </CardHeader>
        <CardContent>
          {invitesQuery.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!invitesQuery.isLoading && pending.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="no-pending-invites">
              No pending invitations.
            </p>
          )}
          <ul className="space-y-2">
            {pending.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                data-testid={`pending-invite-${inv.id}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{inv.invitedEmail}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.role ? `${inv.role} · ` : ""}Expires {formatDate(inv.expiresAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => revokeInvite.mutate(inv.id)}
                  className="text-destructive hover:text-destructive"
                  data-testid={`revoke-invite-${inv.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Revoke
                </Button>
              </li>
            ))}
          </ul>

          {past.length > 0 && (
            <>
              <Separator className="my-4" />
              <p className="text-xs font-medium text-muted-foreground mb-2">History</p>
              <ul className="space-y-1.5">
                {past.slice(0, 8).map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="truncate">{inv.invitedEmail}</span>
                    <Badge variant="outline" className="capitalize">{inv.status}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="w-4 h-4" /> Active collaborators
          </CardTitle>
          <CardDescription>People who have accepted access.</CardDescription>
        </CardHeader>
        <CardContent>
          {collabsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!collabsQuery.isLoading && (collabsQuery.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="no-collaborators">
              Nobody yet. Invitations appear here once accepted.
            </p>
          )}
          <ul className="space-y-2">
            {(collabsQuery.data ?? []).map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                data-testid={`collab-${c.id}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{c.accountId}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.role ? `${c.role} · ` : ""}Joined {formatDate(c.joinedAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCollab.mutate(c.id)}
                  className="text-destructive hover:text-destructive"
                  data-testid={`remove-collab-${c.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
