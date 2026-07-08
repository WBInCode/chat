import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "midnight" | "system";
export type Density = "comfortable" | "compact";

const STORAGE_KEY = "chatv2-theme";
const DENSITY_KEY = "chatv2-density";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(mode: ThemeMode) {
  const isDark = mode === "dark" || (mode === "system" && systemPrefersDark());
  const isMidnight = mode === "midnight";
  // Midnight builds on the dark palette (text colors) but overrides surfaces
  // with pure black + no blur — both classes on <html> when midnight.
  document.documentElement.classList.toggle("dark", isDark || isMidnight);
  document.documentElement.classList.toggle("midnight", isMidnight);
}

function applyDensity(density: Density) {
  document.documentElement.classList.toggle("compact", density === "compact");
}

interface ThemeState {
  mode: ThemeMode;
  density: Density;
  setMode: (mode: ThemeMode) => void;
  setDensity: (density: Density) => void;
}

const initialMode = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? "system";
const initialDensity = (localStorage.getItem(DENSITY_KEY) as Density | null) ?? "comfortable";
applyDensity(initialDensity);
applyTheme(initialMode);

export const useThemeStore = create<ThemeState>((set) => ({
  mode: initialMode,
  density: initialDensity,
  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    applyTheme(mode);
    set({ mode });
  },
  setDensity: (density) => {
    localStorage.setItem(DENSITY_KEY, density);
    applyDensity(density);
    set({ density });
  }
}));

// Keep in sync with OS-level changes when the user has chosen "system".
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (useThemeStore.getState().mode === "system") applyTheme("system");
  });
