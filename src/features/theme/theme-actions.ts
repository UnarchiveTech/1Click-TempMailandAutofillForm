import type { browser } from 'wxt/browser';
import { CONTENT_DEFAULT_THEME_COLORS } from '@/utils/content/content-default-theme-colors.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

export type ThemeMode = 'light' | 'system' | 'dark';
export type ContrastLevel = 'standard' | 'medium' | 'high';

export interface ThemeState {
  themeMode: ThemeMode;
  customColor: string;
  contrastLevel: ContrastLevel;
}

export interface ThemeSetters {
  setThemeMode: (mode: ThemeMode) => void;
  setCustomColor: (color: string) => void;
  setContrastLevel: (level: ContrastLevel) => void;
}

/**
 * Toggle between theme modes (light → system → dark → light)
 * @param state - Current theme state
 * @param setters - Theme setter functions
 * @param ext - Browser extension API
 */
/** True when the applied theme is dark (reads the resolved `data-theme` that
 * applyTheme sets - `system` mode is already resolved to dark/light there). */
export function isDarkThemeActive(): boolean {
  if (typeof document === 'undefined') return false;
  return (document.documentElement.getAttribute('data-theme') || '').startsWith('dark');
}

export async function toggleTheme(
  state: ThemeState,
  setters: ThemeSetters,
  _ext: typeof browser
): Promise<boolean> {
  let newMode: ThemeMode;
  if (state.themeMode === 'light') {
    newMode = 'system';
  } else if (state.themeMode === 'system') {
    newMode = 'dark';
  } else {
    newMode = 'light';
  }
  setters.setThemeMode(newMode);
  applyTheme(newMode, state.contrastLevel);
  await reapplyCustomColor(state.customColor);
  try {
    await writeWithRetry({ themeMode: newMode });
  } catch {
    // Caller owns user feedback (toast + log); false lets it revert state.
    return false;
  }
  return true;
}

/**
 * Set the theme mode directly
 * @param mode - Theme mode to set (light, system, or dark)
 * @param customColor - Custom color to apply
 * @param contrastLevel - Contrast level to apply
 * @param setters - Theme setter functions
 * @param ext - Browser extension API
 */
export async function setThemeMode(
  mode: ThemeMode,
  customColor: string,
  contrastLevel: ContrastLevel,
  setters: ThemeSetters,
  _ext: typeof browser
): Promise<boolean> {
  setters.setThemeMode(mode);
  applyTheme(mode, contrastLevel);
  await reapplyCustomColor(customColor);
  try {
    await writeWithRetry({ themeMode: mode });
  } catch {
    // Caller owns user feedback (toast + log); false lets it revert state.
    return false;
  }
  return true;
}

/**
 * Apply theme to the document
 * @param themeMode - Theme mode to apply (light, system, or dark)
 * @param contrastLevel - Contrast level (standard, medium, or high)
 */
export function applyTheme(themeMode: ThemeMode, contrastLevel: ContrastLevel = 'standard') {
  let isDark = false;
  if (themeMode === 'system') {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    isDark = themeMode === 'dark';
  }
  const themeValue = `${isDark ? 'dark' : 'light'}-${contrastLevel}`;
  document.documentElement.setAttribute('data-theme', themeValue);
  setTimeout(() => {
    void syncThemeColors();
  }, 50);
}

/**
 * Listen for system theme changes and apply theme when in system mode
 * @param getThemeMode - Function to get current theme mode
 * @param getContrastLevel - Function to get current contrast level
 * @param applyThemeFn - Function to apply theme
 */
export function listenForSystemThemeChanges(
  getThemeMode: () => ThemeMode,
  getContrastLevel: () => ContrastLevel,
  applyThemeFn: (mode: ThemeMode, contrastLevel: ContrastLevel) => void
): () => void {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (getThemeMode() === 'system') {
      applyThemeFn('system', getContrastLevel());
    }
  };
  mediaQuery.addEventListener('change', handler);
  return () => mediaQuery.removeEventListener('change', handler);
}

/**
 * Set the contrast level
 * @param level - Contrast level to set (standard, medium, or high)
 * @param themeMode - Current theme mode
 * @param customColor - Custom color to reapply
 * @param setters - Theme setter functions
 * @param ext - Browser extension API
 */
export async function setContrastLevel(
  level: ContrastLevel,
  themeMode: ThemeMode,
  customColor: string,
  setters: ThemeSetters,
  _ext: typeof browser
): Promise<boolean> {
  setters.setContrastLevel(level);
  applyTheme(themeMode, level);
  await reapplyCustomColor(customColor);
  try {
    await writeWithRetry({ contrastLevel: level });
  } catch {
    // Caller owns user feedback (toast + log); false lets it revert state.
    return false;
  }
  return true;
}

export async function reapplyCustomColor(customColor: string) {
  if (customColor) {
    await applyCustomColor(customColor);
  }
}

export async function applyCustomColor(customColor: string) {
  if (customColor) {
    // Get current theme mode and contrast level from data-theme attribute
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light-standard';
    const parts = currentTheme.split('-');
    const isDark = parts[0] === 'dark';
    const contrastLevelStr = parts[1] || 'standard';

    // Convert contrast level string to number
    const contrastLevelMap: Record<string, number> = {
      standard: 0,
      medium: 0.5,
      high: 1.0,
    };
    const contrastLevel = contrastLevelMap[contrastLevelStr] || 0;

    // Keep the Material color solver off the startup chunk. It is needed only
    // when a user applies a custom accent color.
    const { applyThemeFromSeed } = await import('@/utils/theme/theme-generator.js');
    await applyThemeFromSeed(customColor, isDark, contrastLevel);
  } else {
    // Remove all inline CSS custom properties set by applyThemeFromSeed
    const root = document.documentElement;
    const propsToRemove = Array.from(root.style).filter((prop) => prop.startsWith('--md-'));
    for (const prop of propsToRemove) {
      root.style.removeProperty(prop);
    }
  }
  await syncThemeColors();
}

export async function syncThemeColors(): Promise<void> {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const computedStyle = getComputedStyle(root);
  const colors: Record<string, string> = {};

  // Theme generation always writes this fixed property set. The generated
  // default palette is kept in sync with the solver by its existing check.
  const props = Object.keys(CONTENT_DEFAULT_THEME_COLORS);

  for (const prop of props) {
    const val = root.style.getPropertyValue(prop) || computedStyle.getPropertyValue(prop);
    if (val) {
      colors[prop] = val.trim();
    }
  }

  if (Object.keys(colors).length > 0) {
    try {
      await writeWithRetry({ themeColors: colors });
    } catch {
      // ignore storage write errors
    }
  }
}
