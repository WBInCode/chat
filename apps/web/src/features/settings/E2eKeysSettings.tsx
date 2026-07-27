import { useState } from "react";
import { KeyRound, Copy, Check } from "lucide-react";
import { Icon } from "../../components/Icon.js";
import { exportIdentityKey, importIdentityKey, getOrCreateKeyPair } from "../../lib/e2e.js";
import { glassButtonGhost, glassInput } from "../../styles/glass.js";

/**
 * Device key management for end-to-end encrypted conversations.
 *
 * The identity private key lives only in this browser, which is what makes
 * E2E meaningful, but it also means a new browser/device starts as a
 * stranger: it cannot read old encrypted history and every peer sees a key
 * change. Export/import is the escape hatch, and it is deliberately manual
 * (copy the key yourself) so the key never travels through our servers.
 */
export function E2eKeysSettings() {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function reveal() {
    setRevealed(exportIdentityKey());
    setCopied(false);
  }

  async function copy() {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function runImport() {
    const res = importIdentityKey(importValue);
    if (res.ok) {
      setImportValue("");
      setResult({
        ok: true,
        text: "Klucz zaimportowany. Odśwież stronę, aby odczytać starą historię."
      });
    } else {
      setResult({ ok: false, text: res.error });
    }
  }

  return (
    <div className="glass-strong space-y-4 p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text)]">
        <Icon icon={KeyRound} size={17} className="text-[var(--accent)]" />
        Klucz szyfrowania (E2E)
      </h2>

      <p className="text-sm text-[var(--text-dim)]">
        Ten klucz odszyfrowuje Twoje rozmowy szyfrowane end-to-end. Jest przechowywany wyłącznie
        w tej przeglądarce i nigdy nie trafia na nasze serwery. Bez niego nowe urządzenie nie
        odczyta starej historii.
      </p>

      <div className="space-y-2 border-t border-[var(--glass-border)] pt-4">
        <p className="text-sm font-medium">Przenieś na inne urządzenie</p>
        {revealed ? (
          <>
            <p className="text-xs text-[var(--danger)]">
              Traktuj to jak hasło. Kto ma ten ciąg, odczyta Twoje zaszyfrowane rozmowy.
              Nie wysyłaj go czatem ani mailem.
            </p>
            <code className="block break-all rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] p-2.5 text-xs">
              {revealed}
            </code>
            <button type="button" className={`${glassButtonGhost} inline-flex items-center gap-2`} onClick={copy}>
              <Icon icon={copied ? Check : Copy} size={15} />
              {copied ? "Skopiowano" : "Kopiuj klucz"}
            </button>
          </>
        ) : (
          <button type="button" className={glassButtonGhost} onClick={reveal}>
            Pokaż klucz tego urządzenia
          </button>
        )}
      </div>

      <div className="space-y-2 border-t border-[var(--glass-border)] pt-4">
        <p className="text-sm font-medium">Wczytaj klucz z innego urządzenia</p>
        <p className="text-xs text-[var(--text-dim)]">
          Zastąpi klucz tej przeglądarki. Wszyscy rozmówcy będą wymagali ponownej weryfikacji
          numeru bezpieczeństwa.
        </p>
        <input
          value={importValue}
          onChange={(e) => setImportValue(e.target.value)}
          placeholder="chatv2-e2e-key-v1:..."
          className={glassInput}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className={glassButtonGhost}
          onClick={runImport}
          disabled={!importValue.trim()}
        >
          Wczytaj klucz
        </button>
        {result && (
          <p className={`text-sm ${result.ok ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>
            {result.text}
          </p>
        )}
      </div>

      <div className="border-t border-[var(--glass-border)] pt-4">
        <p className="text-xs text-[var(--text-dim)]">
          Odcisk klucza publicznego tego urządzenia:{" "}
          <code className="break-all">{getOrCreateKeyPair().publicKey.slice(0, 16)}…</code>
        </p>
      </div>
    </div>
  );
}
