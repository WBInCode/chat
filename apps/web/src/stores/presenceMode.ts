import { create } from "zustand";

export type PresenceMode = "online" | "away" | "dnd";

interface PresenceModeState {
  /** User's manual override, or null when presence should follow automatic idle-detection. */
  manual: PresenceMode | null;
  setManual: (mode: PresenceMode | null) => void;
}

export const usePresenceModeStore = create<PresenceModeState>((set) => ({
  manual: null,
  setManual: (mode) => set({ manual: mode })
}));
