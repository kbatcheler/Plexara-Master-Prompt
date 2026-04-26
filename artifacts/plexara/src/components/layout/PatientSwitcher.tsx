import { useListPatients } from "@workspace/api-client-react";
import { useEffect, useState } from "react";
import { ChevronDown, Users, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  const activeIsShared = active.relation === "collaborator";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-2 h-10 pl-2.5 pr-3 rounded-lg border border-border bg-card hover:bg-secondary/60 transition-colors text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        data-testid="patient-switcher"
      >
        {activeIsShared
          ? <Share2 className="w-3.5 h-3.5 text-primary" />
          : <Users className="w-3.5 h-3.5 text-primary" />}
        <span className="max-w-[120px] truncate">{active.displayName}</span>
        {activeIsShared && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-primary/40 text-primary">
            Shared
          </Badge>
        )}
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Switch patient</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {patients.map((p) => {
          const shared = p.relation === "collaborator";
          return (
            <DropdownMenuItem
              key={p.id}
              onClick={() => setActivePatientId(p.id)}
              className={p.id === active.id ? "bg-primary/10 text-primary" : ""}
              data-testid={`patient-option-${p.id}`}
            >
              <div className="flex flex-col flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate">{p.displayName}</span>
                  {shared && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-primary/40 text-primary">
                      Shared
                    </Badge>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {p.isPrimary ? "Primary" : shared ? "Shared with you" : "Owned"}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
