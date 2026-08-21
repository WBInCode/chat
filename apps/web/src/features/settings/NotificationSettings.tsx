import { useEffect, useState } from "react";
import { Bell, BellOff, Mail } from "lucide-react";
import type { NotificationPreferencesDto } from "@chatv2/shared";
import { apiFetch } from "../../lib/api.js";
import { enablePushNotifications, disablePushNotifications, isPushEnabled } from "../../lib/push.js";
import { glassButtonGhost } from "../../styles/glass.js";
import { useNotifyPrefsStore } from "../../stores/notifyPrefs.js";

type NotifyMode = "ALL" | "MENTIONS" | "NONE";
type EmailDigestMode = "OFF" | "MENTIONS" | "ALL";

const MODE_LABELS: Record<NotifyMode, string> = {
  ALL: "Wszystkie wiadomości",
  MENTIONS: "Tylko wzmianki i DM",
  NONE: "Wyłączone"
};

const EMAIL_LABELS: Record<EmailDigestMode, { label: string; hint: string }> = {
  MENTIONS: {
    label: "Wzmianki i wiadomości bezpośrednie",
    hint: "Mail tylko wtedy, gdy ktoś zwraca się bezpośrednio do Ciebie."
  },
  ALL: {
    label: "Wszystko z niewyciszonych kanałów",
    hint: "Podsumowanie obejmie każdą rozmowę, której nie wyciszyłeś."
  },
  OFF: {
    label: "Bez maili",
    hint: "Zostaną tylko powiadomienia w przeglądarce."
  }
};

export function NotificationSettings() {
  const [mode, setMode] = useState<NotifyMode>("ALL");
  const [emailDigest, setEmailDigest] = useState<EmailDigestMode>("MENTIONS");
  const [emailAvailable, setEmailAvailable] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<NotificationPreferencesDto>("/me/notification-preferences").then((r) => {
      setMode(r.mode);
      useNotifyPrefsStore.getState().setMode(r.mode);
      setEmailDigest(r.emailDigest);
      setEmailAvailable(r.emailAvailable);
    });
    void isPushEnabled().then(setPushEnabled);
  }, []);

  async function changeMode(next: NotifyMode) {
    setMode(next);
    // Bez tego zmiana trybu działała dopiero po przeładowaniu strony: dźwięk
    // czyta wartość ze store'a, nie ze stanu tego ekranu.
    useNotifyPrefsStore.getState().setMode(next);
    await apiFetch("/me/notification-preferences", { method: "PATCH", body: JSON.stringify({ mode: next }) });
  }

  async function changeEmailDigest(next: EmailDigestMode) {
    setEmailDigest(next);
    await apiFetch("/me/email-digest", { method: "PATCH", body: JSON.stringify({ mode: next }) });
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
        <button type="button" className={`${glassButtonGhost} inline-flex items-center gap-2`} onClick={togglePush} disabled={busy}>
          {pushEnabled ? <BellOff size={15} aria-hidden="true" /> : <Bell size={15} aria-hidden="true" />}
          {pushEnabled ? "Wyłącz powiadomienia push" : "Włącz powiadomienia push"}
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

      <div className="space-y-2 border-t border-[var(--glass-border)] pt-4">
        <p className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
          <Mail size={15} aria-hidden="true" /> Powiadomienia e-mail
        </p>
        <p className="text-sm text-[var(--text-dim)]">
          Wysyłamy je tylko wtedy, gdy nie masz otwartej aplikacji. Wiadomości z krótkiego
          odstępu czasu trafiają do jednego podsumowania, a przy dłuższej rozmowie odstępy
          między mailami rosną, więc jedna dyskusja nie zapcha skrzynki.
        </p>
        {!emailAvailable && (
          <p className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-xs text-[var(--text-dim)]">
            Serwer poczty nie jest skonfigurowany, więc maile nie są wysyłane. Ustawienie
            zostanie zapamiętane i zacznie działać po włączeniu poczty przez administratora.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {(Object.keys(EMAIL_LABELS) as EmailDigestMode[]).map((m) => (
            <label key={m} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="email-digest"
                checked={emailDigest === m}
                onChange={() => void changeEmailDigest(m)}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                {EMAIL_LABELS[m].label}
                <span className="block text-xs text-[var(--text-dim)]">{EMAIL_LABELS[m].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
