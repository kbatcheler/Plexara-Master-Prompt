import { useEffect } from "react";
import { useListPatients, useCreatePatient } from "@workspace/api-client-react";
import { useUser } from "@clerk/react";

export function useCurrentPatient() {
  const { user } = useUser();
  const { data: patients, isLoading, error, refetch } = useListPatients();
  const createPatient = useCreatePatient();
  
  const currentPatient = patients?.find(p => p.isPrimary) || patients?.[0];

  useEffect(() => {
    if (!isLoading && patients && patients.length === 0 && user && !createPatient.isPending) {
      const displayName = user.fullName || user.primaryEmailAddress?.emailAddress?.split("@")[0] || "My Profile";
      createPatient.mutate({ data: { displayName } }, {
        onSuccess: () => refetch(),
      });
    }
  }, [isLoading, patients, user]);

  return {
    patient: currentPatient,
    patientId: currentPatient?.id,
    isLoading: isLoading || createPatient.isPending,
    error
  };
}
