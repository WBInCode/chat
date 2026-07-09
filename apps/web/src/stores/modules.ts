import { create } from "zustand";
import { DEFAULT_MODULE_STATE, type ModuleKey, type ModuleState } from "@chatv2/shared";
import { apiFetch } from "../lib/api.js";

interface ModulesStore {
  /** Resolved module state for the active org (defaults to all-on until loaded). */
  modules: ModuleState;
  loadedOrgId: string | null;
  /** Fetch and cache the module state for an organization. */
  loadModules: (orgId: string) => Promise<void>;
  setModules: (state: ModuleState) => void;
  isEnabled: (key: ModuleKey) => boolean;
}

export const useModulesStore = create<ModulesStore>((set, get) => ({
  modules: { ...DEFAULT_MODULE_STATE },
  loadedOrgId: null,

  loadModules: async (orgId) => {
    try {
      const state = await apiFetch<ModuleState>(`/orgs/${orgId}/modules`);
      set({ modules: state, loadedOrgId: orgId });
    } catch {
      // On failure keep everything enabled (fail-open on the client — the
      // server still enforces gating, so this only affects UI visibility).
      set({ modules: { ...DEFAULT_MODULE_STATE }, loadedOrgId: orgId });
    }
  },

  setModules: (state) => set({ modules: state }),

  isEnabled: (key) => get().modules[key] !== false
}));
