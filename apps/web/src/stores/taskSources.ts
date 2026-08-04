import { create } from "zustand";
import type { TaskSourceLinkDto } from "@chatv2/shared";
import { apiFetch } from "../lib/api.js";

interface TaskSourcesStore {
  /** Wzory adresów potrzebne do zbudowania odnośnika plakietki w wiadomości. */
  sources: TaskSourceLinkDto[];
  loadedOrgId: string | null;
  loadSources: (orgId: string) => Promise<void>;
}

export const useTaskSourcesStore = create<TaskSourcesStore>((set, get) => ({
  sources: [],
  loadedOrgId: null,

  loadSources: async (orgId) => {
    if (get().loadedOrgId === orgId) return;
    try {
      const sources = await apiFetch<TaskSourceLinkDto[]>(`/orgs/${orgId}/task-source-links`);
      set({ sources, loadedOrgId: orgId });
    } catch {
      // Brak wzorów oznacza tylko plakietki bez odnośnika — treść wiadomości
      // pozostaje czytelna, więc nie ma po co blokować widoku.
      set({ sources: [], loadedOrgId: orgId });
    }
  }
}));
