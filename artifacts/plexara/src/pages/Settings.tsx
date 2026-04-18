import { useEffect, useState } from "react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "../hooks/use-toast";
import { useUser, useClerk } from "@clerk/react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Download, Trash2, Loader2 } from "lucide-react";

interface AlertPrefs {
  enableUrgent: boolean;
  enableWatch: boolean;
  enableInfo: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
}

export default function Settings() {
  const { patientId } = useCurrentPatient();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<AlertPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!patientId) return;
    api<AlertPrefs>(`/patients/${patientId}/alert-preferences`).then(setPrefs).catch(() => null);
  }, [patientId]);

  async function update(partial: Partial<AlertPrefs>) {
    if (!patientId || !prefs) return;
    const next = { ...prefs, ...partial };
    setPrefs(next);
    setSaving(true);
    try {
      await api(`/patients/${patientId}/alert-preferences`, { method: "PUT", body: JSON.stringify(partial) });
    } catch {
      toast({ title: "Could not save preferences", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/me/export", { credentials: "include" });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `plexara-export-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api("/me", { method: "DELETE" });
      toast({ title: "Account data deleted" });
      await signOut();
    } catch {
      toast({ title: "Could not delete account", variant: "destructive" });
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Preferences, data export, and account.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alert preferences</CardTitle>
          <CardDescription>Choose which severity levels generate alerts after each interpretation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!prefs && <p className="text-sm text-muted-foreground">Loading…</p>}
          {prefs && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base">Urgent findings</Label>
                  <p className="text-xs text-muted-foreground">Critical biomarker values requiring prompt action.</p>
                </div>
                <Switch checked={prefs.enableUrgent} onCheckedChange={(v) => update({ enableUrgent: v })} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base">Watch findings</Label>
                  <p className="text-xs text-muted-foreground">Out-of-optimal values worth monitoring.</p>
                </div>
                <Switch checked={prefs.enableWatch} onCheckedChange={(v) => update({ enableWatch: v })} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base">Informational notices</Label>
                  <p className="text-xs text-muted-foreground">Routine observations and contextual notes.</p>
                </div>
                <Switch checked={prefs.enableInfo} onCheckedChange={(v) => update({ enableInfo: v })} />
              </div>
              {saving && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Saving…</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data export</CardTitle>
          <CardDescription>Download a complete JSON archive of every record, interpretation, and audit entry under your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExport} disabled={exporting} variant="outline">
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Download my data
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Delete account</CardTitle>
          <CardDescription>Permanently remove all patients, records, interpretations, alerts, supplements, conversations, and share links associated with {user?.primaryEmailAddress?.emailAddress}.</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={deleting}>
                {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Delete all my data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete everything?</AlertDialogTitle>
                <AlertDialogDescription>
                  This irreversibly removes all data Plexara holds for your account. You will be signed out.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">Delete forever</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
