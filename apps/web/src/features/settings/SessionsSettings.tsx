import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api.js";
import { glassButtonGhost } from "../../styles/glass.js";

interface SessionDto {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/** Best-effort friendly device/browser label from a raw user-agent string. */
function describeUserAgent(ua: string | null): string {
  if (!ua) return "Nieznane urządzenie";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) || /Opera/.test(ua) ? "Opera" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" :
    "Przeglądarka";
  const os =
    /Windows/.test(ua) ? "Windows" :
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad|iOS/.test(ua) ? "iOS" :
    /Mac OS X|Macintosh/.test(ua) ? "macOS" :
    /Linux/.test(ua) ? "Linux" :
    "";
  return os ? `${browser} · ${os}` : browser;
}

/**
 * Active sessions (F6-E): shows every device with a live session and lets
 * the user remotely sign out a single device or all others at once.
 */
export function SessionsSettings() {
  const [sessions, setSessions] = useState<SessionDto[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyOthers, setBusyOthers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    void apiFetch<SessionDto[]>("/me/sessions")
      .then(setSessions)
      .catch(() => setError("Nie udało się wczytać sesji"));
  }

  useEffect(reload, []);

  async function revoke(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/me/sessions/${id}`, { method: "DELETE" });
      reload();
    } catch {
      setError("Nie udało się wylogować urządzenia");
    } finally {
      setBusyId(null);
    }
  }

  async function revokeOthers() {
    setBusyOthers(true);
    setError(null);
    try {
      await apiFetch("/me/sessions/revoke-others", { method: "POST" });
      reload();
    } catch {
      setError("Nie udało się wylogować pozostałych urządzeń");
    } finally {
      setBusyOthers(false);
    }
  }

  const others = sessions?.filter((s) => !s.current) ?? [];

  return (
    <div className="max-w-md glass p-5">
      <h2 className="mb-1 text-sm font-semibold">Aktywne sesje</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Urządzenia i przeglądarki, które są obecnie zalogowane na Twoje konto. Możesz wylogować
        każde z nich zdalnie.
      </p>

      {error && <p className="mb-3 text-xs text-[var(--danger)]">{error}</p>}

      {sessions === null ? (
        <p className="text-xs text-[var(--text-dim)]">Ładowanie...</p>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-[var(--text-dim)]">Brak aktywnych sesji.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{describeUserAgent(s.userAgent)}</span>
                  {s.current && (
                    <span className="shrink-0 rounded-full bg-[var(--accent-2)]/20 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-2)]">
                      To urządzenie
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-[var(--text-dim)]">
                  {s.ip ?? "—"} · od {new Date(s.createdAt).toLocaleString("pl-PL")}
                </p>
              </div>
              {!s.current && (
                <button
                  type="button"
                  onClick={() => revoke(s.id)}
                  disabled={busyId === s.id}
                  className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 disabled:opacity-40"
                >
                  {busyId === s.id ? "..." : "Wyloguj"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {others.length > 0 && (
        <button
          type="button"
          onClick={revokeOthers}
          disabled={busyOthers}
          className={`${glassButtonGhost} mt-4 text-[var(--danger)]`}
        >
          {busyOthers ? "Wylogowywanie..." : `Wyloguj wszystkie inne urządzenia (${others.length})`}
        </button>
      )}
    </div>
  );
}
