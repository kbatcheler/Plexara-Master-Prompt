import { useEffect, useMemo, useState } from "react";
import { useUpdatePatient } from "@workspace/api-client-react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, ShieldCheck, AlertTriangle } from "lucide-react";
import { TagListEditor, type TagItem } from "../components/TagListEditor";

type DraftState = {
  displayName: string;
  dateOfBirth: string;
  sex: string;
  ethnicity: string;
  heightCm: string;
  weightKg: string;
  allergies: TagItem[];
  medications: TagItem[];
  conditions: TagItem[];
  smokingStatus: string;
  alcoholStatus: string;
  priorSurgeries: string;
  priorHospitalizations: string;
  familyHistory: string;
  additionalHistory: string;
  physicianName: string;
  physicianContact: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
};

// Single-page profile editor exposing every health-relevant field on the
// patient record. A "Save changes" button at the bottom commits all dirty
// fields in one PATCH so users aren't surprised by per-field auto-saves
// of in-progress text. Save state is reflected in the button to give a
// clear "your changes are stored" signal.
export default function HealthProfile() {
  const { patient } = useCurrentPatient();
  const updatePatient = useUpdatePatient();

  const initial = useMemo<DraftState>(() => ({
    displayName: patient?.displayName ?? "",
    dateOfBirth: patient?.dateOfBirth ?? "",
    sex: patient?.sex ?? "",
    ethnicity: patient?.ethnicity ?? "",
    heightCm: patient?.heightCm != null ? String(patient.heightCm) : "",
    weightKg: patient?.weightKg ?? "",
    allergies: (patient?.allergies as TagItem[] | null) ?? [],
    medications: (patient?.medications as TagItem[] | null) ?? [],
    conditions: (patient?.conditions as TagItem[] | null) ?? [],
    smokingStatus: patient?.smokingStatus ?? "",
    alcoholStatus: patient?.alcoholStatus ?? "",
    priorSurgeries: patient?.priorSurgeries ?? "",
    priorHospitalizations: patient?.priorHospitalizations ?? "",
    familyHistory: patient?.familyHistory ?? "",
    additionalHistory: patient?.additionalHistory ?? "",
    physicianName: patient?.physicianName ?? "",
    physicianContact: patient?.physicianContact ?? "",
    emergencyContactName: patient?.emergencyContactName ?? "",
    emergencyContactPhone: patient?.emergencyContactPhone ?? "",
    emergencyContactRelationship: patient?.emergencyContactRelationship ?? "",
  }), [patient]);

  const [draft, setDraft] = useState<DraftState>(initial);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");

  // Re-hydrate when the patient query refreshes (e.g. after a save).
  useEffect(() => { setDraft(initial); }, [initial]);

  const set = <K extends keyof DraftState>(key: K, value: DraftState[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const bmi = useMemo(() => {
    const h = parseInt(draft.heightCm, 10);
    const w = parseFloat(draft.weightKg);
    if (!h || !w) return null;
    const m = h / 100;
    return (w / (m * m)).toFixed(1);
  }, [draft.heightCm, draft.weightKg]);

  const handleSave = async () => {
    if (!patient) return;
    setError("");
    try {
      await updatePatient.mutateAsync({
        patientId: patient.id,
        data: {
          displayName: draft.displayName.trim() || undefined,
          dateOfBirth: draft.dateOfBirth || null,
          sex: draft.sex ? (draft.sex as "male" | "female" | "other") : null,
          ethnicity: draft.ethnicity || null,
          heightCm: draft.heightCm ? parseInt(draft.heightCm, 10) : null,
          weightKg: draft.weightKg || null,
          allergies: draft.allergies.length ? draft.allergies : null,
          medications: draft.medications.length ? draft.medications : null,
          conditions: draft.conditions.length ? draft.conditions : null,
          smokingStatus: draft.smokingStatus || null,
          alcoholStatus: draft.alcoholStatus || null,
          priorSurgeries: draft.priorSurgeries || null,
          priorHospitalizations: draft.priorHospitalizations || null,
          familyHistory: draft.familyHistory || null,
          additionalHistory: draft.additionalHistory || null,
          physicianName: draft.physicianName || null,
          physicianContact: draft.physicianContact || null,
          emergencyContactName: draft.emergencyContactName || null,
          emergencyContactPhone: draft.emergencyContactPhone || null,
          emergencyContactRelationship: draft.emergencyContactRelationship || null,
        },
      });
      setSavedAt(new Date());
    } catch {
      setError("Could not save your changes. Please try again.");
    }
  };

  if (!patient) return null;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6" data-testid="health-profile">
      <header className="space-y-2">
        <h1 className="text-3xl font-heading font-semibold tracking-tight">Health Profile</h1>
        <p className="text-muted-foreground">
          Keep this up to date so the three-lens AI pipeline can deliver more
          accurate, personalised interpretations of your data.
        </p>
      </header>

      <Card>
        <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="Display name">
            <Input data-testid="input-display-name" value={draft.displayName} onChange={(e) => set("displayName", e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Date of birth" hint="Never sent to AI — only an age range.">
              <Input data-testid="input-dob" type="date" value={draft.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} />
            </Field>
            <Field label="Biological sex">
              <Select value={draft.sex} onValueChange={(v) => set("sex", v)}>
                <SelectTrigger data-testid="select-sex"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other / Prefer not to say</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Ethnicity">
              <Input data-testid="input-ethnicity" value={draft.ethnicity} onChange={(e) => set("ethnicity", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Height (cm)">
              <Input data-testid="input-height" type="number" min="50" max="250" value={draft.heightCm} onChange={(e) => set("heightCm", e.target.value)} />
            </Field>
            <Field label="Weight (kg)">
              <Input data-testid="input-weight" type="number" min="20" max="400" step="0.1" value={draft.weightKg} onChange={(e) => set("weightKg", e.target.value)} />
            </Field>
            <Field label="BMI">
              <div className="h-10 px-3 rounded-md border border-border/40 bg-secondary/40 flex items-center text-sm" data-testid="display-bmi">
                {bmi ?? <span className="text-muted-foreground">—</span>}
              </div>
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Current state</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="Allergies">
            <TagListEditor data-testid="editor-allergies" items={draft.allergies} onChange={(v) => set("allergies", v)} placeholder="Add an allergy" />
          </Field>
          <Field label="Current medications">
            <TagListEditor data-testid="editor-medications" items={draft.medications} onChange={(v) => set("medications", v)} placeholder="Add a medication" />
          </Field>
          <Field label="Diagnosed conditions">
            <TagListEditor data-testid="editor-conditions" items={draft.conditions} onChange={(v) => set("conditions", v)} placeholder="Add a condition" />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Smoking">
              <Select value={draft.smokingStatus} onValueChange={(v) => set("smokingStatus", v)}>
                <SelectTrigger data-testid="select-smoking"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="former">Former</SelectItem>
                  <SelectItem value="current">Current</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Alcohol">
              <Select value={draft.alcoholStatus} onValueChange={(v) => set("alcoholStatus", v)}>
                <SelectTrigger data-testid="select-alcohol"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="occasional">Occasional</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="heavy">Heavy</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>History</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="Prior surgeries">
            <Textarea data-testid="input-prior-surgeries" value={draft.priorSurgeries} onChange={(e) => set("priorSurgeries", e.target.value)} rows={2} />
          </Field>
          <Field label="Prior hospitalizations">
            <Textarea data-testid="input-prior-hospitalizations" value={draft.priorHospitalizations} onChange={(e) => set("priorHospitalizations", e.target.value)} rows={2} />
          </Field>
          <Field label="Family history">
            <Textarea data-testid="input-family-history" value={draft.familyHistory} onChange={(e) => set("familyHistory", e.target.value)} rows={2} />
          </Field>
          <Field label="Additional history" hint="Anything else clinically relevant.">
            <Textarea data-testid="input-additional-history" value={draft.additionalHistory} onChange={(e) => set("additionalHistory", e.target.value)} rows={3} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Care team & emergency contact
            <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5" /> Never sent to AI
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Physician name">
              <Input data-testid="input-physician-name" value={draft.physicianName} onChange={(e) => set("physicianName", e.target.value)} />
            </Field>
            <Field label="Physician contact">
              <Input data-testid="input-physician-contact" value={draft.physicianContact} onChange={(e) => set("physicianContact", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Emergency contact name">
              <Input data-testid="input-emergency-name" value={draft.emergencyContactName} onChange={(e) => set("emergencyContactName", e.target.value)} />
            </Field>
            <Field label="Emergency contact phone">
              <Input data-testid="input-emergency-phone" value={draft.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone", e.target.value)} />
            </Field>
            <Field label="Relationship">
              <Input data-testid="input-emergency-relationship" value={draft.emergencyContactRelationship} onChange={(e) => set("emergencyContactRelationship", e.target.value)} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 p-4 rounded-xl bg-card/95 backdrop-blur border border-border shadow-lg">
        <div className="text-sm">
          {error && (
            <span className="inline-flex items-center gap-1.5 text-status-urgent" data-testid="save-error">
              <AlertTriangle className="w-4 h-4" />{error}
            </span>
          )}
          {!error && savedAt && (
            <span className="text-muted-foreground" data-testid="save-confirmation">
              Saved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <Button onClick={handleSave} disabled={updatePatient.isPending} data-testid="btn-save">
          <Save className="w-4 h-4 mr-2" />
          {updatePatient.isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
