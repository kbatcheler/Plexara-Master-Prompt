import { useState } from "react";
import { useUser } from "@clerk/react";
import { useCreatePatient } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowRight, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Onboarding() {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createPatient = useCreatePatient();

  const defaultName = user?.fullName || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "";

  const [displayName, setDisplayName] = useState(defaultName);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sex, setSex] = useState<string>("");
  const [ethnicity, setEthnicity] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!displayName.trim()) {
      setError("Please enter a display name.");
      return;
    }

    createPatient.mutate(
      {
        data: {
          displayName: displayName.trim(),
          dateOfBirth: dateOfBirth || undefined,
          sex: sex ? (sex as "male" | "female" | "other") : undefined,
          ethnicity: ethnicity || undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["listPatients"] });
          setLocation("/dashboard");
        },
        onError: () => {
          setError("Something went wrong. Please try again.");
        },
      }
    );
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

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg space-y-8">
          <div className="text-center space-y-3">
            <h1 className="text-3xl font-heading font-bold tracking-tight">
              Set Up Your Health Profile
            </h1>
            <p className="text-muted-foreground leading-relaxed max-w-md mx-auto">
              This information helps our AI lenses produce more accurate and
              personalised interpretations of your health data.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 bg-card border border-border/50 rounded-2xl p-8">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How should we refer to you?"
                className="bg-background border-border/50"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dob">Date of Birth</Label>
              <Input
                id="dob"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="bg-background border-border/50"
              />
              <p className="text-xs text-muted-foreground">
                Used for age-adjusted reference ranges. Never shared with AI.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sex">Biological Sex</Label>
              <Select value={sex} onValueChange={setSex}>
                <SelectTrigger className="bg-background border-border/50">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other / Prefer not to say</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Reference ranges differ by biological sex for many biomarkers.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ethnicity">Ethnicity (optional)</Label>
              <Input
                id="ethnicity"
                value={ethnicity}
                onChange={(e) => setEthnicity(e.target.value)}
                placeholder="e.g. Caucasian, South Asian, African"
                className="bg-background border-border/50"
              />
              <p className="text-xs text-muted-foreground">
                Some biomarker ranges vary by ethnicity. This is never used outside analysis.
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button
              type="submit"
              disabled={createPatient.isPending}
              className="w-full h-12 text-base font-medium"
            >
              {createPatient.isPending ? "Creating Profile..." : "Continue to Dashboard"}
              {!createPatient.isPending && <ArrowRight className="w-4 h-4 ml-2" />}
            </Button>

            <div className="flex items-start gap-3 pt-2 border-t border-border/30">
              <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your personal details are stored securely and never sent to any AI
                model. All data shared with AI is fully anonymised.
              </p>
            </div>
          </form>
        </div>
      </main>

      <footer className="border-t border-border/40 bg-background py-6">
        <div className="container mx-auto px-4">
          <p className="text-xs text-muted-foreground text-center max-w-3xl mx-auto leading-relaxed">
            <strong className="text-foreground">DISCLAIMER:</strong> Plexara
            provides AI-generated health interpretations for informational
            purposes only. These are not medical diagnoses. Always consult a
            qualified healthcare professional before making health decisions
            based on these results.
          </p>
        </div>
      </footer>
    </div>
  );
}
