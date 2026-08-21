import { useEffect, useRef } from "react";

const OGNISKOWALNE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Wspólne zachowanie okna modalnego: Escape zamyka, tło nie przewija się pod
 * spodem, tabulator krąży wewnątrz okna, a po zamknięciu ognisko wraca tam,
 * skąd okno otwarto.
 *
 * Bez pułapki tabulator wychodzi na treść zasłoniętą nakładką — widać wtedy
 * podświetlenie w miejscu, w które nie da się kliknąć, a osoba korzystająca
 * z czytnika ekranu czyta stronę pod oknem, nie wiedząc, że okno jest otwarte.
 *
 * Zwraca referencję do przypięcia na panelu okna. Panel powinien dostać też
 * `role="dialog"` i `aria-modal="true"`.
 */
export function useOknoModalne(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const poprzednieOgnisko = document.activeElement as HTMLElement | null;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const elementy = [...panelRef.current.querySelectorAll<HTMLElement>(OGNISKOWALNE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (elementy.length === 0) return;
      const pierwszy = elementy[0]!;
      const ostatni = elementy[elementy.length - 1]!;
      const aktywny = document.activeElement;
      if (!panelRef.current.contains(aktywny)) {
        e.preventDefault();
        pierwszy.focus();
      } else if (e.shiftKey && aktywny === pierwszy) {
        e.preventDefault();
        ostatni.focus();
      } else if (!e.shiftKey && aktywny === ostatni) {
        e.preventDefault();
        pierwszy.focus();
      }
    }

    // Faza przechwytywania: inaczej Escape najpierw zamknąłby okno pod spodem,
    // zostawiając to na wierzchu wiszące nad pustką.
    document.addEventListener("keydown", onKey, true);
    const poprzedniOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Gdy okno samo nie ustawi ogniska, wpuszczamy je na pierwszy element —
    // inaczej pierwszy Tab zaczyna wędrówkę od początku strony pod spodem.
    const start = window.setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        panel.querySelector<HTMLElement>(OGNISKOWALNE)?.focus();
      }
    }, 0);

    return () => {
      window.clearTimeout(start);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = poprzedniOverflow;
      // Element mógł zniknąć razem z menu, z którego okno otwarto.
      if (poprzednieOgnisko?.isConnected) poprzednieOgnisko.focus();
    };
  }, [onClose]);

  return panelRef;
}
