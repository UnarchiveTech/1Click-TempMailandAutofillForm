// Lightweight Material 3 color scheme generator (vendored port of
// @material/material-color-utilities, HCT core + DynamicColor machinery -
// pixel-exact at all contrast levels for Tonal Spot).
// The build-time script (scripts/generate-theme.ts) shares this module for
// offline pre-generated themes; this module also handles runtime generation.

import Material, {
  argbFromHex,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeTonalSpot,
} from '@/utils/theme/material-color-utils.js';

/**
 * Default theme seed - MUST stay in sync with scripts/generate-theme.ts (SEED_HEX).
 * Used by the content script to derive the injected-UI palette without hardcoding.
 */
export const DEFAULT_THEME_SEED = '#63A002';

/**
 * Resolve a dynamic color to hex by calling getArgb() against the scheme.
 */
function resolve(
  color: { getArgb: (scheme: SchemeTonalSpot) => number },
  scheme: SchemeTonalSpot
): string {
  return hexFromArgb(color.getArgb(scheme));
}

/**
 * Map a Material 3 scheme to the full set of --md-* CSS custom properties.
 */
function _mapMaterialToColors(scheme: SchemeTonalSpot, sourceHct: Hct, isDark: boolean) {
  const mdc = new MaterialDynamicColors();
  const { TonalPalette: TP } = Material;
  const colors: Record<string, string> = {};

  colors['--md-primary'] = resolve(mdc.primary(), scheme);
  colors['--md-on-primary'] = resolve(mdc.onPrimary(), scheme);
  colors['--md-primary-container'] = resolve(mdc.primaryContainer(), scheme);
  colors['--md-on-primary-container'] = resolve(mdc.onPrimaryContainer(), scheme);

  colors['--md-secondary'] = resolve(mdc.secondary(), scheme);
  colors['--md-on-secondary'] = resolve(mdc.onSecondary(), scheme);
  colors['--md-secondary-container'] = resolve(mdc.secondaryContainer(), scheme);
  colors['--md-on-secondary-container'] = resolve(mdc.onSecondaryContainer(), scheme);

  colors['--md-tertiary'] = resolve(mdc.tertiary(), scheme);
  colors['--md-on-tertiary'] = resolve(mdc.onTertiary(), scheme);
  colors['--md-tertiary-container'] = resolve(mdc.tertiaryContainer(), scheme);
  colors['--md-on-tertiary-container'] = resolve(mdc.onTertiaryContainer(), scheme);

  colors['--md-error'] = resolve(mdc.error(), scheme);
  colors['--md-on-error'] = resolve(mdc.onError(), scheme);
  colors['--md-error-container'] = resolve(mdc.errorContainer(), scheme);
  colors['--md-on-error-container'] = resolve(mdc.onErrorContainer(), scheme);

  colors['--md-background'] = resolve(mdc.background(), scheme);
  colors['--md-on-background'] = resolve(mdc.onBackground(), scheme);

  colors['--md-surface'] = resolve(mdc.surface(), scheme);
  colors['--md-surface-tint'] = resolve(mdc.primary(), scheme);
  colors['--md-on-surface'] = resolve(mdc.onSurface(), scheme);
  colors['--md-surface-variant'] = resolve(mdc.surfaceVariant(), scheme);
  colors['--md-on-surface-variant'] = resolve(mdc.onSurfaceVariant(), scheme);

  colors['--md-outline'] = resolve(mdc.outline(), scheme);
  colors['--md-outline-variant'] = resolve(mdc.outlineVariant(), scheme);

  colors['--md-surface-container-lowest'] = resolve(mdc.surfaceContainerLowest(), scheme);
  colors['--md-surface-container-low'] = resolve(mdc.surfaceContainerLow(), scheme);
  colors['--md-surface-container'] = resolve(mdc.surfaceContainer(), scheme);
  colors['--md-surface-container-high'] = resolve(mdc.surfaceContainerHigh(), scheme);
  colors['--md-surface-container-highest'] = resolve(mdc.surfaceContainerHighest(), scheme);

  colors['--md-inverse-surface'] = resolve(mdc.inverseSurface(), scheme);
  colors['--md-inverse-on-surface'] = resolve(mdc.inverseOnSurface(), scheme);
  colors['--md-inverse-primary'] = resolve(mdc.inversePrimary(), scheme);

  colors['--md-shadow'] = resolve(mdc.shadow(), scheme);
  colors['--md-scrim'] = resolve(mdc.scrim(), scheme);

  colors['--md-surface-bright'] = resolve(mdc.surfaceBright(), scheme);
  colors['--md-surface-dim'] = resolve(mdc.surfaceDim(), scheme);

  const cLevel = scheme.contrastLevel;
  const successTone = isDark ? 80 + cLevel * 10 : 40 - cLevel * 20;
  const onSuccessTone = isDark ? Math.max(0, 20 - cLevel * 10) : 100;
  const warningTone = isDark ? 80 + cLevel * 10 : 40 - cLevel * 20;
  const onWarningTone = isDark ? Math.max(0, 20 - cLevel * 10) : 100;

  colors['--md-success'] = hexFromArgb(
    TP.fromHueAndChroma(142, Math.min(sourceHct.chroma, 48)).tone(successTone)
  );
  colors['--md-on-success'] = hexFromArgb(
    TP.fromHueAndChroma(142, Math.min(sourceHct.chroma, 48)).tone(onSuccessTone)
  );

  colors['--md-warning'] = hexFromArgb(
    TP.fromHueAndChroma(85, Math.min(sourceHct.chroma, 48)).tone(warningTone)
  );
  colors['--md-on-warning'] = hexFromArgb(
    TP.fromHueAndChroma(85, Math.min(sourceHct.chroma, 48)).tone(onWarningTone)
  );

  return colors;
}

/**
 * Generate a theme from a seed color at runtime and return the CSS variables map.
 * Uses the lightweight vendored Material 3 color utilities.
 */
export async function generateThemeColors(
  seedColor: string,
  isDark: boolean = false,
  contrastLevel: number = 0
): Promise<Record<string, string>> {
  const sourceHct = Hct.fromInt(argbFromHex(seedColor));
  const scheme = new SchemeTonalSpot(sourceHct, isDark, contrastLevel);
  return _mapMaterialToColors(scheme, sourceHct, isDark);
}

/**
 * Synchronous theme generation - used by content scripts (shadow DOM host)
 * to derive the injected-UI palette without hardcoding or async/await.
 */
export function generateThemeColorsSync(
  seedColor: string,
  isDark: boolean = false,
  contrastLevel: number = 0
): Record<string, string> {
  const sourceHct = Hct.fromInt(argbFromHex(seedColor));
  const scheme = new SchemeTonalSpot(sourceHct, isDark, contrastLevel);
  return _mapMaterialToColors(scheme, sourceHct, isDark);
}

/**
 * Generate and apply a theme from a seed color at runtime.
 * Uses the lightweight vendored Material 3 color utilities.
 */
export async function applyThemeFromSeed(
  seedColor: string,
  isDark: boolean = false,
  contrastLevel: number = 0
) {
  const colors = await generateThemeColors(seedColor, isDark, contrastLevel);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(key, value);
  }
}

/**
 * Generate theme CSS strings from a seed color
 */
export async function generateThemeCSS(
  seedColor: string
): Promise<{ light: string; dark: string }> {
  const sourceHct = Hct.fromInt(argbFromHex(seedColor));
  const lightScheme = new SchemeTonalSpot(sourceHct, false, 0);
  const darkScheme = new SchemeTonalSpot(sourceHct, true, 0);

  const lightColors = await _mapMaterialToColors(lightScheme, sourceHct, false);
  const darkColors = await _mapMaterialToColors(darkScheme, sourceHct, true);

  let lightCSS = '[data-theme="custom"] {\n';
  for (const [key, value] of Object.entries(lightColors)) {
    lightCSS += `  ${key}: ${value};\n`;
  }
  lightCSS += '}\n';

  let darkCSS = '[data-theme="dark"] {\n';
  for (const [key, value] of Object.entries(darkColors)) {
    darkCSS += `  ${key}: ${value};\n`;
  }
  darkCSS += '}\n';

  return { light: lightCSS, dark: darkCSS };
}
