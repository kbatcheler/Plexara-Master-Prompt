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
      <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 border border-border/50 hover:bg-secondary text-sm font-medium">
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
