import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "midnight" | "system";
export type Density = "comfortable" | "compact";
/** Skórka steruje układem i bryłą interfejsu, niezależnie od jasny/ciemny. */
export type Skin = "klasyczny" | "platforma" | "konsola" | "papier" | "czytelny" | "nokturn";

const STORAGE_KEY = "chatv2-theme";
const DENSITY_KEY = "chatv2-density";
const SKIN_KEY = "chatv2-skin";

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

function applySkin(skin: Skin) {
  document.documentElement.dataset.skin = skin;
  // Kroje dociągamy dopiero przy włączeniu skórki, która ich używa — kto
  // zostaje przy klasycznej, nie płaci za nie transferem. Import jest
  // idempotentny, więc powrót do skórki nic nie kosztuje.
  if (skin === "platforma") void import("@fontsource-variable/plus-jakarta-sans");
  if (skin === "papier") void import("@fontsource-variable/literata");
}

interface ThemeState {
  mode: ThemeMode;
  density: Density;
  skin: Skin;
  setMode: (mode: ThemeMode) => void;
  setDensity: (density: Density) => void;
  setSkin: (skin: Skin) => void;
}

const initialMode = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? "system";
const initialDensity = (localStorage.getItem(DENSITY_KEY) as Density | null) ?? "comfortable";
const initialSkin = (localStorage.getItem(SKIN_KEY) as Skin | null) ?? "klasyczny";
applyDensity(initialDensity);
applyTheme(initialMode);
applySkin(initialSkin);

export const useThemeStore = create<ThemeState>((set) => ({
  mode: initialMode,
  density: initialDensity,
  skin: initialSkin,
  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    applyTheme(mode);
    set({ mode });
  },
  setDensity: (density) => {
    localStorage.setItem(DENSITY_KEY, density);
    applyDensity(density);
    set({ density });
  },
  setSkin: (skin) => {
    localStorage.setItem(SKIN_KEY, skin);
    applySkin(skin);
    set({ skin });
  }
}));

// Keep in sync with OS-level changes when the user has chosen "system".
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (useThemeStore.getState().mode === "system") applyTheme("system");
  });
