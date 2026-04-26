import { useState } from "react";
import { useUser } from "@clerk/react";
import { useCreatePatient, useUpdatePatient } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowRight, ArrowLeft, Shield, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TagListEditor, type TagItem } from "../components/TagListEditor";

type Step = 1 | 2 | 3;

// Three-step onboarding. Step 1 creates the patient row (so we have an
// id to record consent and subsequent updates against); steps 2 and 3
// PATCH that same row. Each step is skippable — the user can finish at
// any time by clicking "Save and continue" on a later step or "Skip the
// rest". This mirrors how clinical intake forms work in real life: you
// can leave fields blank and your provider fills them in over time.
export default function Onboarding() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const createPatient = useCreatePatient();
  const updatePatient = useUpdatePatient();

  const defaultName = user?.fullName || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "";

  const [step, setStep] = useState<Step>(1);
  const [patientId, setPatientId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Step 1 — basics + body composition
  const [displayName, setDisplayName] = useState(defaultName);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sex, setSex] = useState<string>("");
  const [ethnicity, setEthnicity] = useState("");
  const [heightCm, setHeightCm] = useState<string>("");
  const [weightKg, setWeightKg] = useState<string>("");

  // Step 2 — current state (allergies, meds, conditions, lifestyle)
  const [allergies, setAllergies] = useState<TagItem[]>([]);
  const [medications, setMedications] = useState<TagItem[]>([]);
  const [conditions, setConditions] = useState<TagItem[]>([]);
  const [smokingStatus, setSmokingStatus] = useState<string>("");
  const [alcoholStatus, setAlcoholStatus] = useState<string>("");

  // Step 3 — prior history + care team + emergency contact
  const [priorSurgeries, setPriorSurgeries] = useState("");
  const [priorHospitalizations, setPriorHospitalizations] = useState("");
  const [familyHistory, setFamilyHistory] = useState("");
  const [physicianName, setPhysicianName] = useState("");
  const [physicianContact, setPhysicianContact] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [emergencyContactRelationship, setEmergencyContactRelationship] = useState("");

  const finish = async () => {
    queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    window.location.href = `${base}/dashboard`;
  };

  // Step 1 creates the patient. Returns the new id so subsequent steps
  // can PATCH it. If creation fails we surface a generic error so users
  // aren't blocked on a vague network problem.
  const submitStep1 = async (advance: boolean) => {
    setError("");
    if (!displayName.trim()) {
      setError("Please enter a display name.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await createPatient.mutateAsync({
        data: {
          displayName: displayName.trim(),
          dateOfBirth: dateOfBirth || undefined,
          sex: sex ? (sex as "male" | "female" | "other") : undefined,
          ethnicity: ethnicity || undefined,
        },
      });
      setPatientId(created.id);
      // Body composition lives on the same row so PATCH it immediately
      // if either field was filled.
      const heightInt = heightCm ? parseInt(heightCm, 10) : undefined;
      const weightDecimal = weightKg ? weightKg : undefined;
      if (heightInt || weightDecimal) {
        await updatePatient.mutateAsync({
          patientId: created.id,
          data: {
            heightCm: heightInt ?? null,
            weightKg: weightDecimal ?? null,
          },
        });
      }
      if (advance) setStep(2);
      else await finish();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitStep2 = async (advance: boolean) => {
    if (!patientId) return;
    setError("");
    setSubmitting(true);
    try {
      await updatePatient.mutateAsync({
        patientId,
        data: {
          allergies: allergies.length ? allergies : null,
          medications: medications.length ? medications : null,
          conditions: conditions.length ? conditions : null,
          smokingStatus: smokingStatus || null,
          alcoholStatus: alcoholStatus || null,
        },
      });
      if (advance) setStep(3);
      else await finish();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitStep3 = async () => {
    if (!patientId) return;
    setError("");
    setSubmitting(true);
    try {
      await updatePatient.mutateAsync({
        patientId,
        data: {
          priorSurgeries: priorSurgeries || null,
          priorHospitalizations: priorHospitalizations || null,
          familyHistory: familyHistory || null,
          physicianName: physicianName || null,
          physicianContact: physicianContact || null,
          emergencyContactName: emergencyContactName || null,
          emergencyContactPhone: emergencyContactPhone || null,
          emergencyContactRelationship: emergencyContactRelationship || null,
        },
      });
      await finish();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <header className="border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center px-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
              <Activity className="w-4 h-4 text-primary" />
            </div>
            <span className="font-heading font-semibold text-lg tracking-tight">
              Plexara<span className="text-primary">.</span>
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-12">
        <div className="w-full max-w-2xl space-y-8">
          <StepHeader step={step} />

          {step === 1 && (
            <form onSubmit={(e) => { e.preventDefault(); submitStep1(true); }} className="space-y-6 bg-card border border-border/50 rounded-2xl p-8" data-testid="onboarding-step-1">
              <SectionTitle title="Basics & body composition" subtitle="Used for age- and sex-adjusted reference ranges, and for BMI in cardiometabolic interpretation." />

              <FieldGroup>
                <Field label="Display name" required>
                  <Input data-testid="input-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How should we refer to you?" />
                </Field>

                <Field label="Date of birth" hint="Your exact date of birth is never sent to AI — only an age range like 30–39.">
                  <Input data-testid="input-dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                </Field>

                <Field label="Biological sex" hint="Many biomarker reference ranges differ by sex.">
                  <Select value={sex} onValueChange={setSex}>
                    <SelectTrigger data-testid="select-sex"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other / Prefer not to say</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Ethnicity (optional)" hint="Some ranges (e.g. eGFR) vary by ethnicity.">
                  <Input data-testid="input-ethnicity" value={ethnicity} onChange={(e) => setEthnicity(e.target.value)} placeholder="e.g. Caucasian, South Asian, African" />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Height (cm)">
                    <Input data-testid="input-height" type="number" min="50" max="250" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="170" />
                  </Field>
                  <Field label="Weight (kg)">
                    <Input data-testid="input-weight" type="number" min="20" max="400" step="0.1" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="70.5" />
                  </Field>
                </div>
              </FieldGroup>

              {error && <p className="text-sm text-destructive" data-testid="error-message">{error}</p>}

              <FormActions
                left={null}
                right={
                  <>
                    <Button type="button" variant="ghost" onClick={() => submitStep1(false)} disabled={submitting} data-testid="btn-finish-now">
                      Save and finish
                    </Button>
                    <Button type="submit" disabled={submitting} data-testid="btn-next">
                      {submitting ? "Saving..." : "Continue"}
                      {!submitting && <ArrowRight className="w-4 h-4 ml-2" />}
                    </Button>
                  </>
                }
              />
            </form>
          )}

          {step === 2 && (
            <form onSubmit={(e) => { e.preventDefault(); submitStep2(true); }} className="space-y-6 bg-card border border-border/50 rounded-2xl p-8" data-testid="onboarding-step-2">
              <SectionTitle title="Current state" subtitle="Allergies, medications, and conditions help our AI lenses flag drug-lab interactions and avoid contraindicated suggestions." />

              <FieldGroup>
                <Field label="Allergies" hint="e.g. penicillin, peanuts, latex.">
                  <TagListEditor data-testid="editor-allergies" items={allergies} onChange={setAllergies} placeholder="Add an allergy" />
                </Field>

                <Field label="Current medications" hint="Include supplements you take daily — not one-off doses.">
                  <TagListEditor data-testid="editor-medications" items={medications} onChange={setMedications} placeholder="Add a medication" />
                </Field>

                <Field label="Diagnosed conditions" hint="Active or chronic conditions only.">
                  <TagListEditor data-testid="editor-conditions" items={conditions} onChange={setConditions} placeholder="Add a condition" />
                </Field>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Smoking">
                    <Select value={smokingStatus} onValueChange={setSmokingStatus}>
                      <SelectTrigger data-testid="select-smoking"><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="never">Never</SelectItem>
                        <SelectItem value="former">Former</SelectItem>
                        <SelectItem value="current">Current</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Alcohol">
                    <Select value={alcoholStatus} onValueChange={setAlcoholStatus}>
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
              </FieldGroup>

              {error && <p className="text-sm text-destructive" data-testid="error-message">{error}</p>}

              <FormActions
                left={
                  <Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={submitting} data-testid="btn-back">
                    <ArrowLeft className="w-4 h-4 mr-2" />Back
                  </Button>
                }
                right={
                  <>
                    <Button type="button" variant="ghost" onClick={() => submitStep2(false)} disabled={submitting} data-testid="btn-finish-now">
                      Save and finish
                    </Button>
                    <Button type="submit" disabled={submitting} data-testid="btn-next">
                      {submitting ? "Saving..." : "Continue"}
                      {!submitting && <ArrowRight className="w-4 h-4 ml-2" />}
                    </Button>
                  </>
                }
              />
            </form>
          )}

          {step === 3 && (
            <form onSubmit={(e) => { e.preventDefault(); submitStep3(); }} className="space-y-6 bg-card border border-border/50 rounded-2xl p-8" data-testid="onboarding-step-3">
              <SectionTitle title="Prior history & care team" subtitle="Optional but useful — this gives interpretations historical context and surfaces who to contact in an emergency." />

              <FieldGroup>
                <Field label="Prior surgeries" hint="Free text — e.g. 'Appendectomy 2018'.">
                  <Textarea data-testid="input-prior-surgeries" value={priorSurgeries} onChange={(e) => setPriorSurgeries(e.target.value)} rows={2} />
                </Field>

                <Field label="Prior hospitalizations">
                  <Textarea data-testid="input-prior-hospitalizations" value={priorHospitalizations} onChange={(e) => setPriorHospitalizations(e.target.value)} rows={2} />
                </Field>

                <Field label="Family history" hint="e.g. 'Father — type 2 diabetes; mother — breast cancer at 52'.">
                  <Textarea data-testid="input-family-history" value={familyHistory} onChange={(e) => setFamilyHistory(e.target.value)} rows={2} />
                </Field>

                <div className="pt-2 border-t border-border/30">
                  <h4 className="text-sm font-medium text-foreground mb-3">Primary physician (private — never sent to AI)</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field label="Name">
                      <Input data-testid="input-physician-name" value={physicianName} onChange={(e) => setPhysicianName(e.target.value)} placeholder="Dr. Smith" />
                    </Field>
                    <Field label="Phone or email">
                      <Input data-testid="input-physician-contact" value={physicianContact} onChange={(e) => setPhysicianContact(e.target.value)} placeholder="555-555-5555" />
                    </Field>
                  </div>
                </div>

                <div className="pt-2 border-t border-border/30">
                  <h4 className="text-sm font-medium text-foreground mb-3">Emergency contact (private — never sent to AI)</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Field label="Name">
                      <Input data-testid="input-emergency-name" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} />
                    </Field>
                    <Field label="Phone">
                      <Input data-testid="input-emergency-phone" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} />
                    </Field>
                    <Field label="Relationship">
                      <Input data-testid="input-emergency-relationship" value={emergencyContactRelationship} onChange={(e) => setEmergencyContactRelationship(e.target.value)} placeholder="Spouse, parent..." />
                    </Field>
                  </div>
                </div>
              </FieldGroup>

              {error && <p className="text-sm text-destructive" data-testid="error-message">{error}</p>}

              <FormActions
                left={
                  <Button type="button" variant="ghost" onClick={() => setStep(2)} disabled={submitting} data-testid="btn-back">
                    <ArrowLeft className="w-4 h-4 mr-2" />Back
                  </Button>
                }
                right={
                  <Button type="submit" disabled={submitting} data-testid="btn-finish">
                    {submitting ? "Saving..." : (
                      <>
                        Finish setup
                        <Check className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                }
              />
            </form>
          )}

          <div className="flex items-start gap-3 p-4 rounded-xl bg-card/40 border border-border/30">
            <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Names, dates of birth, physician contacts, and emergency contacts
              are never sent to AI. Only de-identified clinical context — age
              range, sex, BMI, allergies, active medications, conditions, and
              lifestyle — is used to improve interpretation accuracy.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function StepHeader({ step }: { step: Step }) {
  const labels: Record<Step, string> = {
    1: "Basics",
    2: "Current state",
    3: "Prior history",
  };
  return (
    <div className="space-y-4">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-heading font-bold tracking-tight">Set Up Your Health Profile</h1>
        <p className="text-muted-foreground">Step {step} of 3 · {labels[step]}</p>
      </div>
      <div className="flex items-center gap-2 max-w-md mx-auto" data-testid="step-progress">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`h-1 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-border"}`}
            data-testid={`step-indicator-${n}`}
          />
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-xl font-heading font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FormActions({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 pt-2">
      <div>{left}</div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}
