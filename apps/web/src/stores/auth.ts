import { create } from "zustand";

interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isSuperAdmin?: boolean;
}

/** Powód zakończenia sesji, przenoszony na ekran logowania. */
export type SessionEndReason = "expired" | "revoked" | null;

interface AuthState {
  // Access token lives ONLY in memory (never localStorage) per PLAN.md §6.1.
  // Refresh token is an httpOnly cookie managed entirely by the browser.
  accessToken: string | null;
  user: AuthUser | null;
  // Bez tego wylogowanie wyglądało jak awaria: użytkownik nagle widział pusty
  // formularz logowania i nie miał jak odróżnić "sesja wygasła" od "apka padła".
  sessionEndReason: SessionEndReason;
  setAuth: (accessToken: string, user: AuthUser) => void;
  setAccessToken: (accessToken: string) => void;
  clear: (reason?: SessionEndReason) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  sessionEndReason: null,
  setAuth: (accessToken, user) => set({ accessToken, user, sessionEndReason: null }),
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: (reason = null) => set({ accessToken: null, user: null, sessionEndReason: reason })
}));
