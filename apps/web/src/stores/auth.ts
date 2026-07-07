import { create } from "zustand";

interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isSuperAdmin?: boolean;
}

interface AuthState {
  // Access token lives ONLY in memory (never localStorage) per PLAN.md §6.1.
  // Refresh token is an httpOnly cookie managed entirely by the browser.
  accessToken: string | null;
  user: AuthUser | null;
  setAuth: (accessToken: string, user: AuthUser) => void;
  setAccessToken: (accessToken: string) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setAuth: (accessToken, user) => set({ accessToken, user }),
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: () => set({ accessToken: null, user: null })
}));
