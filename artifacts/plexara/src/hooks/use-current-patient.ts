import { useListPatients } from "@workspace/api-client-react";

export function useCurrentPatient() {
  const { data: patients, isLoading, error } = useListPatients();
  
  const currentPatient = patients?.find(p => p.isPrimary) || patients?.[0];
  const needsOnboarding = !isLoading && patients !== undefined && patients.length === 0;

  return {
    patient: currentPatient,
    patientId: currentPatient?.id,
    isLoading,
    error,
    needsOnboarding,
  };
}
