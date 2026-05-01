import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Mode = "patient" | "clinician";

interface ModeContextType {
  mode: Mode;
  setMode: (mode: Mode) => void;
  toggleMode: () => void;
}

const ModeContext = createContext<ModeContextType | undefined>(undefined);

const STORAGE_KEY = "plexara.mode";

function readInitialMode(): Mode {
  if (typeof window === "undefined") return "patient";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "patient" || stored === "clinician") return stored;
  } catch {
    // ignore (e.g. SecurityError when storage is disabled)
  }
  return "patient";
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(readInitialMode);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  }, [mode]);

  const setMode = (next: Mode) => setModeState(next);
  const toggleMode = () => setModeState((prev) => (prev === "patient" ? "clinician" : "patient"));

  return (
    <ModeContext.Provider value={{ mode, setMode, toggleMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  const context = useContext(ModeContext);
  if (context === undefined) {
    throw new Error("useMode must be used within a ModeProvider");
  }
  return context;
}
