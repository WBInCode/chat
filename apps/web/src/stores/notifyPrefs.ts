import { create } from "zustand";

import type { NotifyMode } from "@chatv2/shared";

export type { NotifyMode };

interface NotifyPrefsState {
  /**
   * Tryb powiadomień użytkownika, ten sam, który serwer stosuje przy wysyłce
   * push. Dotąd żył wyłącznie w ekranie ustawień, więc dźwięk w aplikacji
   * kompletnie go ignorował: ustawienie "Wyłączone" gasiło push, a dzwonek
   * grał dalej przy każdej wiadomości. Z perspektywy użytkownika wyglądało to
   * jak "powiadomienie bez dźwięku albo dźwięk bez powiadomienia".
   */
  mode: NotifyMode;
  setMode: (mode: NotifyMode) => void;
}

export const useNotifyPrefsStore = create<NotifyPrefsState>((set) => ({
  mode: "ALL",
  setMode: (mode) => set({ mode })
}));
