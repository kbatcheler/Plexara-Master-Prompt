import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface ActivePatientContextValue {
  activePatientId: number | null;
  setActivePatientId: (id: number) => void;
}

export const ActivePatientContext = createContext<ActivePatientContextValue | undefined>(undefined);

const STORAGE_KEY = "plexara.activePatientId";

export function ActivePatientProvider({ children }: { children: ReactNode }) {
  const [activePatientId, setActivePatientIdState] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v ? parseInt(v) : null;
  });

  const setActivePatientId = (id: number) => {
    setActivePatientIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, String(id));
  };

  useEffect(() => {
    if (activePatientId !== null && typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(activePatientId));
    }
  }, [activePatientId]);

  return (
    <ActivePatientContext.Provider value={{ activePatientId, setActivePatientId }}>
      {children}
    </ActivePatientContext.Provider>
  );
}

export function useActivePatient() {
  const ctx = useContext(ActivePatientContext);
  if (!ctx) throw new Error("useActivePatient must be used within ActivePatientProvider");
  return ctx;
}
