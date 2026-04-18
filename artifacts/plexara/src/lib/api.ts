export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let detail: unknown = text;
    try { detail = JSON.parse(text); } catch { /* keep as text */ }
    const err = new Error(`API ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    (err as Error & { status?: number; detail?: unknown }).status = response.status;
    (err as Error & { status?: number; detail?: unknown }).detail = detail;
    throw err;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
