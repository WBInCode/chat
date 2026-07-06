import { create } from "zustand";
import { apiFetch } from "../lib/api.js";

interface AvatarState {
  urls: Record<string, string | null>;
  pending: Set<string>;
  ensure: (userIds: string[]) => void;
}

/**
 * Module-level cache of resolved (presigned) avatar URLs, shared by the
 * sidebar member list and message rows so the same user's avatar is only
 * fetched once per session instead of once per place it's rendered.
 */
export const useAvatarStore = create<AvatarState>((set, get) => ({
  urls: {},
  pending: new Set(),
  ensure: (userIds: string[]) => {
    const { urls, pending } = get();
    const missing = [...new Set(userIds)].filter((id) => !(id in urls) && !pending.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => pending.add(id));
    set({ pending: new Set(pending) });

    void apiFetch<Record<string, string | null>>("/users/avatars", {
      method: "POST",
      body: JSON.stringify({ userIds: missing })
    })
      .then((result) => {
        set((state) => ({ urls: { ...state.urls, ...result } }));
      })
      .catch(() => {
        // leave as "missing" — Avatar component falls back to initials
      })
      .finally(() => {
        set((state) => {
          const next = new Set(state.pending);
          missing.forEach((id) => next.delete(id));
          return { pending: next };
        });
      });
  }
}));
