import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api.js";
import { glassInput, glassButtonPrimary, glassButtonGhost } from "../../styles/glass.js";

interface TotpSetupResponse {
  otpauthUrl: string;
  secret: string;
}

/**
 * Minimal 2FA (TOTP) enrollment panel. The backend already exposes
 * /auth/2fa/setup and /auth/2fa/verify; this walks the user through
 * scanning the secret and confirming a code to receive recovery codes.
 */
export function TotpSettings() {
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function startSetup() {
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<TotpSetupResponse>("/auth/2fa/setup", { method: "POST" });
      setSetup(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Błąd konfiguracji 2FA");
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ recoveryCodes: string[] }>("/auth/2fa/verify", {
        method: "POST",
        body: JSON.stringify({ code })
      });
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nieprawidłowy kod");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md glass p-5">
      <h2 className="mb-1 text-sm font-semibold">Uwierzytelnianie dwuskładnikowe (2FA)</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Dodatkowa warstwa zabezpieczeń oparta o aplikację TOTP (np. Google Authenticator, Aegis).
      </p>

      {recoveryCodes ? (
        <div>
          <p className="mb-2 text-sm font-medium text-[var(--accent-2)]">2FA włączone.</p>
          <p className="mb-2 text-xs text-[var(--text-dim)]">
            Zapisz kody zapasowe w bezpiecznym miejscu — każdy działa jednorazowo:
          </p>
          <ul className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] p-3 font-mono text-xs">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : setup ? (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-[var(--text-dim)]">
              Dodaj ten sekret w aplikacji uwierzytelniającej:
            </p>
            <code className="block break-all rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] p-2 text-xs">
              {setup.secret}
            </code>
          </div>
          <div>
            <label htmlFor="totp-code" className="mb-1 block text-xs font-medium">
              Wpisz 6-cyfrowy kod z aplikacji
            </label>
            <input
              id="totp-code"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={glassInput}
            />
          </div>
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          <button
            onClick={verify}
            disabled={loading || code.length !== 6}
            className={glassButtonPrimary}
          >
            Potwierdź i włącz
          </button>
        </div>
      ) : (
        <div>
          {error && <p className="mb-2 text-xs text-[var(--danger)]">{error}</p>}
          <button
            onClick={startSetup}
            disabled={loading}
            className={glassButtonGhost}
          >
            Skonfiguruj 2FA
          </button>
        </div>
      )}
    </div>
  );
}
