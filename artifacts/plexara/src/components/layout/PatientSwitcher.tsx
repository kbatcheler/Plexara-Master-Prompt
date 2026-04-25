import { useListPatients } from "@workspace/api-client-react";
import { useEffect, useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActivePatient } from "../../context/ActivePatientContext";

export function PatientSwitcher() {
  const { data: patients } = useListPatients();
  const { activePatientId, setActivePatientId } = useActivePatient();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!patients || patients.length === 0) return;
    if (!activePatientId) {
      const primary = patients.find((p) => p.isPrimary) ?? patients[0];
      setActivePatientId(primary.id);
    }
    setHydrated(true);
  }, [patients, activePatientId, setActivePatientId]);

  if (!patients || patients.length <= 1 || !hydrated) return null;

  const active = patients.find((p) => p.id === activePatientId) ?? patients[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-2 h-10 pl-2.5 pr-3 rounded-lg border border-border bg-card hover:bg-secondary/60 transition-colors text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        data-testid="patient-switcher"
      >
        <Users className="w-3.5 h-3.5 text-primary" />
        <span className="max-w-[120px] truncate">{active.displayName}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Switch patient</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {patients.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => setActivePatientId(p.id)}
            className={p.id === active.id ? "bg-primary/10 text-primary" : ""}
          >
            <div className="flex flex-col">
              <span>{p.displayName}</span>
              {p.isPrimary && <span className="text-[10px] text-muted-foreground">Primary</span>}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
