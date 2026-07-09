import { useMemo } from "react";
import { useInstallPrompt } from "../../lib/useInstallPrompt.js";
import { glassButtonGhost } from "../../styles/glass.js";

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallAppSettings() {
  const { canInstall, installed, promptInstall } = useInstallPrompt();
  const ios = useMemo(isIos, []);

  return (
    <div className="glass-strong space-y-4 p-6">
      <h2 className="text-base font-semibold text-[var(--text)]">Aplikacja</h2>
      <p className="text-sm text-[var(--text-dim)]">
        Zainstaluj chatv2 jako aplikację — własne okno, ikona na pulpicie i podstawowy tryb offline.
      </p>

      {installed ? (
        <p className="text-sm text-[var(--text-dim)]">✅ Aplikacja jest zainstalowana.</p>
      ) : canInstall ? (
        <button type="button" className={glassButtonGhost} onClick={() => void promptInstall()}>
          ⬇️ Zainstaluj aplikację
        </button>
      ) : ios ? (
        <p className="text-sm text-[var(--text-dim)]">
          Na iPhonie/iPadzie: dotknij przycisku <span className="font-medium">Udostępnij</span> w Safari, a
          następnie <span className="font-medium">„Do ekranu głównego"</span>.
        </p>
      ) : (
        <p className="text-sm text-[var(--text-dim)]">
          Instalacja będzie dostępna po chwili korzystania z aplikacji (lub użyj opcji „Zainstaluj" w pasku
          adresu przeglądarki).
        </p>
      )}
    </div>
  );
}
