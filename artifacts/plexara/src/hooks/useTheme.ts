import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "plexara_theme";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* localStorage may be blocked */ }
  return "light";
}

function resolveSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyDocumentTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const effective = theme === "system" ? resolveSystemTheme() : theme;
  const root = document.documentElement;
  root.classList.toggle("dark", effective === "dark");
  root.style.colorScheme = effective;
}

/**
 * Theme hook backed by localStorage. The current value is "light" | "dark" |
 * "system"; the document class reflects the *resolved* theme. The hook also
 * listens to OS changes when the user has chosen "system".
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  // Apply on mount and whenever theme changes.
  useEffect(() => { applyDocumentTheme(theme); }, [theme]);

  // When the user chose "system", respond to OS preference changes.
  useEffect(() => {
    if (theme !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyDocumentTheme("system");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const resolved: "light" | "dark" =
    theme === "system" ? resolveSystemTheme() : theme;

  return { theme, resolved, setTheme };
}

/** Mount-only component: applies the stored theme on first render so other
 *  consumers (e.g. portals) see the right class. */
export function ThemeMount() {
  useTheme();
  return null;
}
