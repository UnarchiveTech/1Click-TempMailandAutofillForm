// Lazy-load Material Color Utilities - only used when setting custom colors (~2% of sessions).
// Keeps ~50 KB off the shared entrypoint chunk.

import type * as Material from '@material/material-color-utilities';
import type { MaterialDynamicColors } from '@material/material-color-utilities';

let _material: typeof Material | null = null;
let _mdc: InstanceType<typeof MaterialDynamicColors> | null = null;

async function _loadMaterial(): Promise<{
  material: typeof Material;
  mdc: InstanceType<typeof MaterialDynamicColors>;
}> {
  if (!_material) {
    _material = await import('@material/material-color-utilities');
    const { MaterialDynamicColors } = _material;
    _mdc = new MaterialDynamicColors();
  }
  return { material: _material, mdc: _mdc as InstanceType<typeof MaterialDynamicColors> };
}

function resolve(
  color: ReturnType<
    typeof import('@material/material-color-utilities').MaterialDynamicColors['prototype']['primary']
  >,
  scheme: import('@material/material-color-utilities').SchemeTonalSpot,
  material: typeof Material
): string {
  return material.hexFromArgb(color.getArgb(scheme));
}

async function _mapMaterialToColors(
  scheme: import('@material/material-color-utilities').SchemeTonalSpot,
  sourceHct: import('@material/material-color-utilities').Hct,
  isDark: boolean,
  material: typeof Material,
  mdc: InstanceType<typeof MaterialDynamicColors>
) {
  const { hexFromArgb, TonalPalette } = material;
  const colors: Record<string, string> = {};

  colors['--md-primary'] = resolve(mdc.primary(), scheme, material);
  colors['--md-on-primary'] = resolve(mdc.onPrimary(), scheme, material);
  colors['--md-primary-container'] = resolve(mdc.primaryContainer(), scheme, material);
  colors['--md-on-primary-container'] = resolve(mdc.onPrimaryContainer(), scheme, material);

  colors['--md-secondary'] = resolve(mdc.secondary(), scheme, material);
  colors['--md-on-secondary'] = resolve(mdc.onSecondary(), scheme, material);
  colors['--md-secondary-container'] = resolve(mdc.secondaryContainer(), scheme, material);
  colors['--md-on-secondary-container'] = resolve(mdc.onSecondaryContainer(), scheme, material);

  colors['--md-tertiary'] = resolve(mdc.tertiary(), scheme, material);
  colors['--md-on-tertiary'] = resolve(mdc.onTertiary(), scheme, material);
  colors['--md-tertiary-container'] = resolve(mdc.tertiaryContainer(), scheme, material);
  colors['--md-on-tertiary-container'] = resolve(mdc.onTertiaryContainer(), scheme, material);

  colors['--md-error'] = resolve(mdc.error(), scheme, material);
  colors['--md-on-error'] = resolve(mdc.onError(), scheme, material);
  colors['--md-error-container'] = resolve(mdc.errorContainer(), scheme, material);
  colors['--md-on-error-container'] = resolve(mdc.onErrorContainer(), scheme, material);

  colors['--md-background'] = resolve(mdc.background(), scheme, material);
  colors['--md-on-background'] = resolve(mdc.onBackground(), scheme, material);
  colors['--md-surface'] = resolve(mdc.surface(), scheme, material);
  colors['--md-on-surface'] = resolve(mdc.onSurface(), scheme, material);
  colors['--md-surface-variant'] = resolve(mdc.surfaceVariant(), scheme, material);
  colors['--md-on-surface-variant'] = resolve(mdc.onSurfaceVariant(), scheme, material);
  colors['--md-outline'] = resolve(mdc.outline(), scheme, material);
  colors['--md-outline-variant'] = resolve(mdc.outlineVariant(), scheme, material);

  colors['--md-surface-container-lowest'] = resolve(mdc.surfaceContainerLowest(), scheme, material);
  colors['--md-surface-container-low'] = resolve(mdc.surfaceContainerLow(), scheme, material);
  colors['--md-surface-container'] = resolve(mdc.surfaceContainer(), scheme, material);
  colors['--md-surface-container-high'] = resolve(mdc.surfaceContainerHigh(), scheme, material);
  colors['--md-surface-container-highest'] = resolve(
    mdc.surfaceContainerHighest(),
    scheme,
    material
  );

  colors['--md-inverse-surface'] = resolve(mdc.inverseSurface(), scheme, material);
  colors['--md-inverse-on-surface'] = resolve(mdc.inverseOnSurface(), scheme, material);
  colors['--md-inverse-primary'] = resolve(mdc.inversePrimary(), scheme, material);

  colors['--md-shadow'] = resolve(mdc.shadow(), scheme, material);
  colors['--md-scrim'] = resolve(mdc.scrim(), scheme, material);

  colors['--md-surface-bright'] = resolve(mdc.surfaceBright(), scheme, material);
  colors['--md-surface-dim'] = resolve(mdc.surfaceDim(), scheme, material);

  colors['--md-success'] = hexFromArgb(
    TonalPalette.fromHueAndChroma(142, Math.min(sourceHct.chroma, 48)).tone(isDark ? 80 : 40)
  );
  colors['--md-on-success'] = hexFromArgb(
    TonalPalette.fromHueAndChroma(142, Math.min(sourceHct.chroma, 48)).tone(isDark ? 20 : 100)
  );

  colors['--md-warning'] = hexFromArgb(
    TonalPalette.fromHueAndChroma(85, Math.min(sourceHct.chroma, 48)).tone(isDark ? 80 : 40)
  );
  colors['--md-on-warning'] = hexFromArgb(
    TonalPalette.fromHueAndChroma(85, Math.min(sourceHct.chroma, 48)).tone(isDark ? 20 : 100)
  );

  return colors;
}

/**
 * Generate and apply a theme from a seed color at runtime
 * Only loads Material Color Utilities on first call.
 */
export async function applyThemeFromSeed(
  seedColor: string,
  isDark: boolean = false,
  contrastLevel: number = 0
) {
  const { material, mdc } = await _loadMaterial();
  const { Hct, SchemeTonalSpot, argbFromHex } = material;
  const sourceHct = Hct.fromInt(argbFromHex(seedColor));
  const scheme = new SchemeTonalSpot(sourceHct, isDark, contrastLevel);
  const colors = await _mapMaterialToColors(scheme, sourceHct, isDark, material, mdc);

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
  const { material, mdc } = await _loadMaterial();
  const { Hct, SchemeTonalSpot, argbFromHex } = material;
  const sourceHct = Hct.fromInt(argbFromHex(seedColor));
  const lightScheme = new SchemeTonalSpot(sourceHct, false, 0);
  const darkScheme = new SchemeTonalSpot(sourceHct, true, 0);

  const lightColors = await _mapMaterialToColors(lightScheme, sourceHct, false, material, mdc);
  const darkColors = await _mapMaterialToColors(darkScheme, sourceHct, true, material, mdc);

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
