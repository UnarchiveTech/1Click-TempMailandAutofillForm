import type { ContrastLevel, ThemeMode, ThemeSetters } from '@/features/theme/theme-actions.js';
import {
  applyCustomColor,
  applyTheme as applyThemeAction,
  listenForSystemThemeChanges,
  setContrastLevel as setContrastLevelAction,
  setThemeMode as setThemeModeAction,
  toggleTheme as toggleThemeAction,
} from '@/features/theme/theme-actions.js';

export type { ContrastLevel, ThemeMode, ThemeSetters };

/** Read-only accessors for the caller-owned reactive theme state ($state proxies). */
export interface ThemeStateAccessors {
  getThemeMode: () => ThemeMode;
  getCustomColor: () => string;
  getContrastLevel: () => ContrastLevel;
}

/**
 * Theme controller that owns the side effects (storage persistence, DOM
 * application, system-theme listener) while the caller keeps the $state proxies
 * and the setters. Callers pass accessors so the controller always reads the
 * live values, and setters so state updates flow back through the caller.
 */
export function createThemeController(
  ext: Browser,
  state: ThemeStateAccessors,
  setters: ThemeSetters
) {
  let _cleanupSystemTheme: (() => void) | null = null;

  /** Storage write failed - revert to the previously persisted value. */
  function revertThemeMode(previous: ThemeMode): void {
    setters.setThemeMode(previous);
    applyActiveTheme();
  }

  /** Storage write failed - revert to the previously persisted value. */
  function revertContrastLevel(previous: ContrastLevel): void {
    setters.setContrastLevel(previous);
    applyActiveTheme();
  }

  async function toggleTheme(): Promise<boolean> {
    const previous = state.getThemeMode();
    const ok = await toggleThemeAction(
      {
        themeMode: previous,
        customColor: state.getCustomColor(),
        contrastLevel: state.getContrastLevel(),
      },
      setters,
      ext
    );
    if (!ok) revertThemeMode(previous);
    return ok;
  }

  async function setThemeMode(mode: ThemeMode): Promise<boolean> {
    const previous = state.getThemeMode();
    const ok = await setThemeModeAction(
      mode,
      state.getCustomColor(),
      state.getContrastLevel(),
      setters,
      ext
    );
    if (!ok) revertThemeMode(previous);
    return ok;
  }

  function applyTheme() {
    applyThemeAction(state.getThemeMode(), state.getContrastLevel());
  }

  /** Re-apply the active theme + custom color after state changed externally. */
  function applyActiveTheme() {
    applyTheme();
    const customColor = state.getCustomColor();
    if (customColor) {
      void applyCustomColor(customColor);
    }
  }

  /** Read themeMode/contrastLevel from storage and push them into the caller state. */
  async function syncThemeSettings() {
    const themeData = (await ext.storage.local.get(['themeMode', 'contrastLevel'])) as {
      themeMode?: string;
      contrastLevel?: string;
    };
    if (
      themeData.themeMode === 'light' ||
      themeData.themeMode === 'system' ||
      themeData.themeMode === 'dark'
    ) {
      setters.setThemeMode(themeData.themeMode);
    }
    if (
      themeData.contrastLevel === 'standard' ||
      themeData.contrastLevel === 'medium' ||
      themeData.contrastLevel === 'high'
    ) {
      setters.setContrastLevel(themeData.contrastLevel);
    }
    applyActiveTheme();
  }

  async function setContrastLevel(level: ContrastLevel): Promise<boolean> {
    const previous = state.getContrastLevel();
    const ok = await setContrastLevelAction(
      level,
      state.getThemeMode(),
      state.getCustomColor(),
      setters,
      ext
    );
    if (!ok) revertContrastLevel(previous);
    return ok;
  }

  /** Register the system theme-change listener; returns its cleanup function. */
  function startSystemThemeListener(): () => void {
    _cleanupSystemTheme = listenForSystemThemeChanges(
      state.getThemeMode,
      state.getContrastLevel,
      (mode: ThemeMode, contrastLevel: ContrastLevel) => applyThemeAction(mode, contrastLevel)
    );
    return _cleanupSystemTheme;
  }

  function stopSystemThemeListener() {
    _cleanupSystemTheme?.();
    _cleanupSystemTheme = null;
  }

  return {
    toggleTheme,
    setThemeMode,
    applyTheme,
    syncThemeSettings,
    setContrastLevel,
    startSystemThemeListener,
    stopSystemThemeListener,
  };
}

/** Read theme settings from storage and apply them, updating the setters. */
export async function restoreThemeFromStorage(
  ext: Browser,
  setThemeMode: (v: ThemeMode) => void,
  setContrastLevel: (v: ContrastLevel) => void,
  applyTheme: (mode: ThemeMode, level: ContrastLevel) => void,
  getCustomColor: () => string
) {
  const themeData = (await ext.storage.local.get(['themeMode', 'contrastLevel'])) as {
    themeMode?: string;
    contrastLevel?: string;
  };
  let mode: ThemeMode = 'system';
  let level: ContrastLevel = 'standard';
  if (
    themeData.themeMode === 'light' ||
    themeData.themeMode === 'system' ||
    themeData.themeMode === 'dark'
  ) {
    mode = themeData.themeMode;
  }
  if (
    themeData.contrastLevel === 'standard' ||
    themeData.contrastLevel === 'medium' ||
    themeData.contrastLevel === 'high'
  ) {
    level = themeData.contrastLevel;
  }
  setThemeMode(mode);
  setContrastLevel(level);
  applyTheme(mode, level);
  const customColor = getCustomColor();
  if (customColor) {
    await applyCustomColor(customColor);
  }
  return { mode, level };
}
