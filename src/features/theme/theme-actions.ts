import { applyThemeFromSeed } from '@/utils/theme-generator.js';

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
export function toggleTheme(state: ThemeState, setters: ThemeSetters, ext: typeof browser) {
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
  // Reapply custom color if set to ensure it matches the new theme mode
  if (state.customColor) {
    applyCustomColor(state.customColor);
  }
  ext.storage.local.set({ themeMode: newMode });
}

/**
 * Set the theme mode directly
 * @param mode - Theme mode to set (light, system, or dark)
 * @param customColor - Custom color to apply
 * @param contrastLevel - Contrast level to apply
 * @param setters - Theme setter functions
 * @param ext - Browser extension API
 */
export function setThemeMode(
  mode: ThemeMode,
  customColor: string,
  contrastLevel: ContrastLevel,
  setters: ThemeSetters,
  ext: typeof browser
) {
  setters.setThemeMode(mode);
  applyTheme(mode, contrastLevel);
  // Reapply custom color if set to ensure it matches the new theme mode
  if (customColor) {
    applyCustomColor(customColor);
  }
  ext.storage.local.set({ themeMode: mode });
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
) {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    if (getThemeMode() === 'system') {
      applyThemeFn('system', getContrastLevel());
    }
  });
}

/**
 * Set the contrast level
 * @param level - Contrast level to set (standard, medium, or high)
 * @param themeMode - Current theme mode
 * @param customColor - Custom color to reapply
 * @param setters - Theme setter functions
 * @param ext - Browser extension API
 */
export function setContrastLevel(
  level: ContrastLevel,
  themeMode: ThemeMode,
  customColor: string,
  setters: ThemeSetters,
  ext: typeof browser
) {
  setters.setContrastLevel(level);
  applyTheme(themeMode, level);
  // Reapply custom color if set to ensure it matches the new contrast level
  if (customColor) {
    applyCustomColor(customColor);
  }
  ext.storage.local.set({ contrastLevel: level });
}

/**
 * Apply custom color theme from a seed color
 * @param customColor - Hex color code to use as seed for theme generation
 */
export function applyCustomColor(customColor: string) {
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

    // Generate full Material Design color scheme from the seed color
    applyThemeFromSeed(customColor, isDark, contrastLevel);
  } else {
    // Remove all inline CSS custom properties set by applyThemeFromSeed
    const root = document.documentElement;
    const propsToRemove = [
      '--md-primary',
      '--md-on-primary',
      '--md-primary-container',
      '--md-on-primary-container',
      '--md-secondary',
      '--md-on-secondary',
      '--md-secondary-container',
      '--md-on-secondary-container',
      '--md-tertiary',
      '--md-on-tertiary',
      '--md-tertiary-container',
      '--md-on-tertiary-container',
      '--md-error',
      '--md-on-error',
      '--md-error-container',
      '--md-on-error-container',
      '--md-background',
      '--md-on-background',
      '--md-surface',
      '--md-on-surface',
      '--md-surface-variant',
      '--md-on-surface-variant',
      '--md-outline',
      '--md-outline-variant',
      '--md-success',
      '--md-on-success',
      '--md-warning',
      '--md-on-warning',
    ];
    for (const prop of propsToRemove) {
      root.style.removeProperty(prop);
    }
  }
}
