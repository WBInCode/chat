import { useAuthStore, type SessionEndReason } from "../stores/auth.js";

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

/**
 * Kanał między kartami. Karta, która odświeżyła token, rozgłasza go
 * pozostałym — dzięki temu nie strzelają własnym odświeżeniem, a wszystkie
 * konwergują do jednego żywego tokenu.
 */
const authChannel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("chatv2-auth") : null;

let tokenFromPeerAt = 0;

authChannel?.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as { type: string; token?: string; reason?: SessionEndReason };
  if (msg.type === "token" && msg.token) {
    tokenFromPeerAt = Date.now();
    useAuthStore.getState().setAccessToken(msg.token);
  } else if (msg.type === "cleared") {
    useAuthStore.getState().clear(msg.reason ?? null);
  }
});

async function refreshAccessToken(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: "POST",
    credentials: "include"
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { accessToken: string };
  useAuthStore.getState().setAccessToken(data.accessToken);
  authChannel?.postMessage({ type: "token", token: data.accessToken });
  return data.accessToken;
}

/**
 * Blokada obejmująca wszystkie karty tej samej przeglądarki.
 *
 * Sam mutex modułowy chronił tylko jedną kartę, a ciasteczko odświeżające jest
 * wspólne — więc dwie karty potrafiły wysłać ten sam token i wywołać po stronie
 * serwera wykrywanie nadużycia, które kasowało całą rodzinę sesji. Blokada
 * szereguje karty: druga rusza dopiero wtedy, gdy pierwsza skończyła i w
 * ciasteczku leży już nowy token.
 */
function withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) return fn();
  return navigator.locks.request("chatv2-refresh", fn) as Promise<T>;
}

// Single-flight guard: concurrent 401s (or React StrictMode double-mount)
// must share ONE refresh call.
let refreshInFlight: Promise<string | null> | null = null;

function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    const startedAt = Date.now();
    refreshInFlight = withCrossTabLock(async () => {
      // Inna karta odświeżyła, gdy czekaliśmy na blokadę — jej token jest już
      // w naszym storze, więc drugie odświeżenie byłoby czystym marnotrawstwem.
      if (tokenFromPeerAt > startedAt) {
        return useAuthStore.getState().accessToken;
      }
      return refreshAccessToken();
    }).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function endSession(reason: SessionEndReason) {
  useAuthStore.getState().clear(reason);
  authChannel?.postMessage({ type: "cleared", reason });
}

/**
 * Odnawianie z wyprzedzeniem.
 *
 * Wcześniej token był odnawiany wyłącznie po napotkaniu 401, więc każdy powrót
 * do aktywności zaczynał się od błędu — w logu produkcyjnym `/auth/me` miało
 * 364 odpowiedzi 401 na 333 udane, czyli proporcję 1:1. Teraz odnawiamy
 * minutę przed wygaśnięciem i użytkownik nie zauważa niczego.
 */
function odczytajWygasniecie(token: string): number | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
let zaplanowanyToken: string | null = null;

function zaplanujOdnowienie(token: string | null) {
  if (token === zaplanowanyToken) return;
  zaplanowanyToken = token;
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = null;
  if (!token) return;

  const exp = odczytajWygasniecie(token);
  if (!exp) return;
  // Minuta zapasu, ale nigdy częściej niż co 30 s — inaczej token wydany
  // z krótkim czasem życia wpadłby w pętlę odnowień.
  const delay = Math.max(30_000, exp - Date.now() - 60_000);
  proactiveTimer = setTimeout(() => void refreshOnce(), delay);
}

useAuthStore.subscribe((state) => zaplanujOdnowienie(state.accessToken));

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

  if (res.status === 401) {
    if (retryOn401) {
      const newToken = await refreshOnce();
      if (newToken) {
        return apiFetch<T>(path, options, false);
      }
      endSession("expired");
    } else {
      // Drugie 401 mimo świeżego tokenu: sesja została unieważniona po stronie
      // serwera (wylogowanie z innego urządzenia, rewokacja z Huba). Wcześniej
      // stan NIE był czyszczony i użytkownik zostawał w interfejsie, w którym
      // nic nie działa i nic go nigdzie nie przekierowuje.
      endSession("revoked");
    }
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
export async function downloadFile(path: string, fallbackName: string, retryOn401 = true): Promise<void> {
  const { accessToken } = useAuthStore.getState();
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: "include"
  });
  // Bez tego eksport CSV po kwadransie bezczynności padał, mimo że sesja
  // była do odzyskania jednym odświeżeniem.
  if (res.status === 401 && retryOn401 && (await refreshOnce())) {
    return downloadFile(path, fallbackName, false);
  }
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
