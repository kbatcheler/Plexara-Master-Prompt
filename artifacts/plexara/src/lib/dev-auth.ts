/**
 * Dev-only static-login helper. Set a localStorage flag so the Clerk
 * `<Show signed-in>` gates in App.tsx can be bypassed while testing.
 */
import { api } from "./api";

const FLAG = "plexara_dev_user";

export function isDevSignedIn(): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(FLAG) === "1"; } catch { return false; }
}

export function setDevSignedIn(on: boolean): void {
  try {
    if (on) localStorage.setItem(FLAG, "1");
    else localStorage.removeItem(FLAG);
  } catch { /* ignore */ }
}

/**
 * Sign out of the dev session: clears server cookie + local flag.
 * Safe to call even when not signed in (server returns 200 either way
 * and clearing localStorage is idempotent).
 */
export async function devSignOut(): Promise<void> {
  try {
    await api<{ ok: true }>("/dev-auth/logout", { method: "POST" });
  } catch {
    // Server may be unreachable — still clear the local flag below.
  }
  setDevSignedIn(false);
}
