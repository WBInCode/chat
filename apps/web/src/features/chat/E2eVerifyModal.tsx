import { createPortal } from "react-dom";
import { ShieldCheck, ShieldAlert, X } from "lucide-react";
import { Icon } from "../../components/Icon.js";
import { glassButtonGhost } from "../../styles/glass.js";

interface E2eVerifyModalProps {
  peerName: string;
  safetyNumber: string;
  /** True when the served key differs from the one pinned on first contact. */
  changed: boolean;
  onTrust: () => void;
  onClose: () => void;
}

/**
 * Safety-number verification, the control that makes E2E meaningful against
 * the SERVER itself. The server hands out peer public keys, so without an
 * out-of-band check it could hand out a key it controls and read everything.
 * Comparing this number over a channel the server does not control (a call,
 * in person) proves nobody is in the middle.
 *
 * Two entry points:
 *  - informational: user opened it to verify a conversation;
 *  - alarm (changed=true): the served key no longer matches the pinned one,
 *    sending is blocked until the user explicitly accepts the new key.
 */
export function E2eVerifyModal({ peerName, safetyNumber, changed, onTrust, onClose }: E2eVerifyModalProps) {
  const groups = safetyNumber.split(" ");

  return createPortal(
    <>
      <div className="animate-overlay-in fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="animate-modal-pop glass-strong fixed left-1/2 top-1/2 z-50 w-[26rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Icon
              icon={changed ? ShieldAlert : ShieldCheck}
              size={16}
              className={changed ? "text-[var(--danger)]" : "text-[var(--accent-2)]"}
            />
            {changed ? "Klucz rozmówcy się zmienił" : "Zweryfikuj rozmowę"}
          </h2>
          <button onClick={onClose} aria-label="Zamknij" className="text-[var(--text-dim)] hover:text-[var(--text)]">
            <Icon icon={X} size={16} />
          </button>
        </div>

        {changed ? (
          <div className="space-y-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 p-3 text-xs leading-relaxed">
            <p className="font-medium text-[var(--danger)]">
              Wiadomości do {peerName} są zablokowane do czasu weryfikacji.
            </p>
            <p className="text-[var(--text-dim)]">
              Klucz szyfrowania {peerName} jest inny niż ten zapamiętany wcześniej. Zwykle
              oznacza to nowe urządzenie lub przeinstalowanie aplikacji. Może też oznaczać,
              że ktoś próbuje przechwycić tę rozmowę.
            </p>
            <p className="text-[var(--text-dim)]">
              Zanim zaakceptujesz, potwierdź poniższy numer z {peerName} innym kanałem:
              telefonicznie lub osobiście. Nie pytaj o to na tym czacie.
            </p>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-[var(--text-dim)]">
            Porównajcie ten numer z {peerName} podczas rozmowy telefonicznej lub osobiście.
            Jeśli u obojga jest identyczny, nikt nie jest w stanie odczytać tej rozmowy,
            łącznie z administratorem platformy.
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] p-3 text-center font-[family-name:var(--font-mono)] text-sm tracking-wider">
          {groups.map((g, i) => (
            <span key={i}>{g}</span>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={glassButtonGhost}>
            {changed ? "Anuluj" : "Zamknij"}
          </button>
          {changed && (
            <button
              onClick={onTrust}
              className="rounded-lg bg-[var(--danger)] px-3 py-2 text-sm font-medium text-white transition-colors hover:brightness-110"
            >
              Numer się zgadza, zaufaj
            </button>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
