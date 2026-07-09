import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { registerSchema } from "@chatv2/shared";
import { apiFetch, ApiError } from "../../lib/api.js";
import { glassInput, glassButtonPrimary, glassCard } from "../../styles/glass.js";

export function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = registerSchema.safeParse({ email, password, displayName });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setError(
        first?.path[0] === "password"
          ? "Hasło musi mieć co najmniej 12 znaków"
          : "Sprawdź poprawność danych"
      );
      return;
    }

    setLoading(true);
    try {
      await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify(parsed.data)
      });
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nie można połączyć się z serwerem");
    } finally {
      setLoading(false);
    }
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
          <h1 className="text-brand-gradient text-2xl font-semibold">Załóż konto</h1>
          <p className="mt-1 text-sm text-[var(--text-dim)]">chatv2 — komunikator firmowy</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="displayName" className="mb-1 block text-sm font-medium">
              Imię i nazwisko
            </label>
            <input
              id="displayName"
              type="text"
              required
              minLength={2}
              maxLength={60}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={glassInput}
            />
          </div>

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
              Hasło <span className="text-[var(--text-dim)]">(min. 12 znaków)</span>
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={glassInput}
            />
          </div>

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
            {loading ? "Tworzenie konta..." : "Zarejestruj się"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-[var(--text-dim)]">
          Masz już konto?{" "}
          <Link to="/login" className="text-[var(--accent)] hover:underline">
            Zaloguj się
          </Link>
        </p>
      </div>
    </div>
  );
}
