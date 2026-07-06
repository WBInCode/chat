import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api.js";
import { useAuthStore } from "../../stores/auth.js";
import { glassButtonGhost, glassButtonPrimary } from "../../styles/glass.js";

interface DataExportDto {
  id: string;
  status: "PENDING" | "READY" | "FAILED";
  createdAt: string;
  expiresAt: string;
  downloadUrl: string | null;
  error: string | null;
}

/**
 * RODO/GDPR self-service: request an export of everything chatv2 holds
 * about you (polled every 2s until ready), and permanently delete your
 * account (anonymizes profile, revokes all sessions, blocks login).
 */
export function DataPrivacySection() {
  const [exportState, setExportState] = useState<DataExportDto | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function requestExport() {
    setRequesting(true);
    setError(null);
    try {
      const created = await apiFetch<DataExportDto>("/me/export", { method: "POST" });
      setExportState(created);
      pollRef.current = setInterval(async () => {
        const updated = await apiFetch<DataExportDto>(`/me/exports/${created.id}`);
        setExportState(updated);
        if (updated.status !== "PENDING" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 2000);
    } catch {
      setError("Nie udało się rozpocząć eksportu danych.");
    } finally {
      setRequesting(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    try {
      await apiFetch("/me", { method: "DELETE", body: JSON.stringify({ confirm: true }) });
      useAuthStore.getState().clear();
      window.location.href = "/login";
    } catch {
      setError("Nie udało się usunąć konta. Spróbuj ponownie.");
      setDeleting(false);
    }
  }

  return (
    <div className="glass-strong mt-6 space-y-4 p-6">
      <h2 className="text-base font-semibold text-[var(--text)]">Prywatność i dane (RODO)</h2>

      <div className="space-y-2">
        <p className="text-sm text-[var(--text-dim)]">
          Pobierz kopię wszystkich Twoich danych: profil, wiadomości, pliki, wpisy audytowe.
        </p>
        <button
          type="button"
          className={glassButtonGhost}
          onClick={requestExport}
          disabled={requesting || exportState?.status === "PENDING"}
        >
          {exportState?.status === "PENDING" ? "Generowanie eksportu…" : "Eksportuj moje dane"}
        </button>
        {exportState?.status === "READY" && exportState.downloadUrl && (
          <a
            href={exportState.downloadUrl}
            className="block text-sm font-medium text-[var(--accent)] hover:underline"
          >
            ⬇ Pobierz plik eksportu (.zip)
          </a>
        )}
        {exportState?.status === "FAILED" && (
          <p className="text-sm text-[var(--danger)]">Eksport nie powiódł się: {exportState.error}</p>
        )}
      </div>

      <div className="space-y-2 border-t border-[var(--glass-border)] pt-4">
        <p className="text-sm text-[var(--text-dim)]">
          Usunięcie konta jest nieodwracalne. Twój profil zostanie zanonimizowany, a wszystkie sesje
          natychmiast wylogowane. Wiadomości pozostaną widoczne dla innych jako "Użytkownik usunięty".
        </p>
        {!deleteConfirming ? (
          <button
            type="button"
            className="rounded-xl border border-[var(--danger)]/40 px-3 py-2 text-sm font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10"
            onClick={() => setDeleteConfirming(true)}
          >
            Usuń moje konto
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`${glassButtonPrimary} !w-auto bg-[var(--danger)] shadow-none`}
              onClick={deleteAccount}
              disabled={deleting}
            >
              {deleting ? "Usuwanie…" : "Tak, usuń trwale"}
            </button>
            <button type="button" className={glassButtonGhost} onClick={() => setDeleteConfirming(false)}>
              Anuluj
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
