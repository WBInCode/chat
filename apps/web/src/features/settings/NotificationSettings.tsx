import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api.js";
import { enablePushNotifications, disablePushNotifications, isPushEnabled } from "../../lib/push.js";
import { glassButtonGhost } from "../../styles/glass.js";

type NotifyMode = "ALL" | "MENTIONS" | "NONE";

const MODE_LABELS: Record<NotifyMode, string> = {
  ALL: "Wszystkie wiadomości",
  MENTIONS: "Tylko wzmianki i DM",
  NONE: "Wyłączone"
};

export function NotificationSettings() {
  const [mode, setMode] = useState<NotifyMode>("ALL");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<{ mode: NotifyMode }>("/me/notification-preferences").then((r) => setMode(r.mode));
    void isPushEnabled().then(setPushEnabled);
  }, []);

  async function changeMode(next: NotifyMode) {
    setMode(next);
    await apiFetch("/me/notification-preferences", { method: "PATCH", body: JSON.stringify({ mode: next }) });
  }

  async function togglePush() {
    setBusy(true);
    setError(null);
    try {
      if (pushEnabled) {
        await disablePushNotifications();
        setPushEnabled(false);
      } else {
        const ok = await enablePushNotifications();
        if (!ok) {
          setError("Powiadomienia push są niedostępne lub zostały zablokowane w przeglądarce.");
        }
        setPushEnabled(ok);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-strong space-y-4 p-6">
      <h2 className="text-base font-semibold text-[var(--text)]">Powiadomienia</h2>

      <div className="space-y-2">
        <p className="text-sm text-[var(--text-dim)]">
          Powiadomienia push w przeglądarce (działają nawet, gdy karta jest nieaktywna).
        </p>
        <button type="button" className={glassButtonGhost} onClick={togglePush} disabled={busy}>
          {pushEnabled ? "🔔 Wyłącz powiadomienia push" : "🔕 Włącz powiadomienia push"}
        </button>
      </div>

      <div className="space-y-2 border-t border-[var(--glass-border)] pt-4">
        <p className="text-sm text-[var(--text-dim)]">O czym chcesz być powiadamiany?</p>
        <div className="flex flex-col gap-1.5">
          {(Object.keys(MODE_LABELS) as NotifyMode[]).map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="notify-mode"
                checked={mode === m}
                onChange={() => void changeMode(m)}
                className="accent-[var(--accent)]"
              />
              {MODE_LABELS[m]}
            </label>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
