import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../../lib/api.js";
import { useAuthStore } from "../../stores/auth.js";
import { glassInput, glassButtonPrimary, glassCard } from "../../styles/glass.js";

const SSO_ONLY = import.meta.env.VITE_SSO_ONLY === "true";
const HUB_URL = (import.meta.env.VITE_HUB_URL as string | undefined) ?? "https://wb-partners.pl";

interface LoginResponse {
  accessToken: string;
  user: { id: string; email: string; displayName: string; isSuperAdmin?: boolean };
}

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const body: Record<string, string> = { email, password };
      if (needsTotp && totpCode) body.totpCode = totpCode;

      const data = await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(body)
      });

      setAuth(data.accessToken, data.user);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "TOTP_REQUIRED") {
        setNeedsTotp(true);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Nie można połączyć się z serwerem");
      }
    } finally {
      setLoading(false);
    }
  }

  if (SSO_ONLY) {
    return (
      <div className="flex min-h-full items-center justify-center p-4">
        <div className={`max-w-sm ${glassCard}`}>
          <div className="mb-6 flex flex-col items-center text-center">
            <img
              src="/icon-192.png"
              alt=""
              className="animate-spring-in mb-4 h-14 w-14 rounded-2xl shadow-[0_8px_24px_var(--accent-glow)]"
            />
            <h1 className="text-brand-gradient text-2xl font-semibold">Zaloguj się</h1>
            <p className="mt-1 text-sm text-[var(--text-dim)]">Dostęp wyłącznie przez WB Platform</p>
          </div>
          <a href={HUB_URL} className={`${glassButtonPrimary} block text-center no-underline`}>
            Zaloguj przez WB Platform
          </a>
          <p className="mt-4 text-center text-sm text-[var(--text-dim)]">
            Konta i logowanie są zarządzane centralnie w WB Platform.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className={`max-w-sm ${glassCard}`}>
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src="/icon-192.png"
            alt=""
            className="animate-spring-in mb-4 h-14 w-14 rounded-2xl shadow-[0_8px_24px_var(--accent-glow)]"
          />
          <h1 className="text-brand-gradient text-2xl font-semibold">Zaloguj się</h1>
          <p className="mt-1 text-sm text-[var(--text-dim)]">chatv2 — komunikator firmowy</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={glassInput}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Hasło
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={glassInput}
            />
          </div>

          {needsTotp && (
            <div>
              <label htmlFor="totp" className="mb-1 block text-sm font-medium">
                Kod 2FA
              </label>
              <input
                id="totp"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                className={glassInput}
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={glassButtonPrimary}
          >
            {loading ? "Logowanie..." : "Zaloguj się"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-[var(--text-dim)]">
          Nie masz konta?{" "}
          <Link to="/register" className="text-[var(--accent)] hover:underline">
            Zarejestruj się
          </Link>
        </p>
      </div>
    </div>
  );
}
