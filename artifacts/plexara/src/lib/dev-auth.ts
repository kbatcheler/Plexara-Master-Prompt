/**
 * Dev-only static-login helper. Set a localStorage flag so the Clerk
 * `<Show signed-in>` gates in App.tsx can be bypassed while testing.
 */
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
