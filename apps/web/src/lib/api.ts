import { useAuthStore } from "../stores/auth.js";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

interface ApiErrorShape {
  error: { code: string; message: string };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: "POST",
    credentials: "include"
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { accessToken: string };
  useAuthStore.getState().setAccessToken(data.accessToken);
  return data.accessToken;
}

// Single-flight guard: concurrent 401s (or React StrictMode double-mount)
// must share ONE refresh call. Independent parallel refreshes would rotate
// the token twice and trip the server's reuse-detection, killing the session.
let refreshInFlight: Promise<string | null> | null = null;

function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * Odtwarza sesję z ciasteczka odnawiającego. Token dostępu żyje wyłącznie
 * w pamięci, więc po przeładowaniu strony pierwsze zapytanie i tak dostałoby
 * 401 — lepiej odnowić sesję od razu niż prowokować błąd i powtarzać zapytanie.
 */
export function odtworzSesje(): Promise<string | null> {
  return refreshOnce();
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  retryOn401 = true
): Promise<T> {
  const { accessToken } = useAuthStore.getState();

  const headers = new Headers(options.headers);
  // Only advertise a JSON body when we actually send one — otherwise Fastify
  // tries to parse an empty body and rejects the request (400/415).
  if (options.body != null) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    ...options,
    headers,
    credentials: "include"
  });

  if (res.status === 401 && retryOn401) {
    const newToken = await refreshOnce();
    if (newToken) {
      return apiFetch<T>(path, options, false);
    }
    useAuthStore.getState().clear();
  }

  if (!res.ok) {
    let code = "UNKNOWN";
    let message = "Wystąpił nieoczekiwany błąd";
    try {
      const body = (await res.json()) as ApiErrorShape;
      code = body.error.code;
      message = body.error.message;
    } catch {
      // non-JSON error body — keep generic message
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

/**
 * Downloads an authenticated endpoint straight to a file. Needed for
 * responses that are not JSON (CSV export), where `apiFetch` cannot be used
 * and a plain `<a href>` would omit the bearer token.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const { accessToken } = useAuthStore.getState();
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: "include"
  });
  if (!res.ok) throw new ApiError(res.status, "DOWNLOAD_FAILED", "Nie udało się pobrać pliku");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
