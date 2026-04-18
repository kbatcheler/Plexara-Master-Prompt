import { useListPatients } from "@workspace/api-client-react";
import { useContext } from "react";
import { ActivePatientContext } from "../context/ActivePatientContext";

export function useCurrentPatient() {
  const { data: patients, isLoading, error } = useListPatients();
  const ctx = useContext(ActivePatientContext);

  const activeId = ctx?.activePatientId ?? null;
  const fromContext = activeId !== null ? patients?.find((p) => p.id === activeId) : undefined;
  const currentPatient = fromContext || patients?.find((p) => p.isPrimary) || patients?.[0];
  const needsOnboarding = !isLoading && patients !== undefined && patients.length === 0;

  return {
    patient: currentPatient,
    patientId: currentPatient?.id,
    isLoading,
    error,
    needsOnboarding,
  };
}
