// Lazy-load Material Color Utilities — only used when setting custom colors (~2% of sessions).
// Keeps ~50 KB off the shared entrypoint chunk.

let _material: typeof import('@material/material-color-utilities') | null = null;
let _mdc: InstanceType<
  typeof import('@material/material-color-utilities').MaterialDynamicColors
> | null = null;

async function _loadMaterial() {
  if (!_material) {
    _material = await import('@material/material-color-utilities');
    const { MaterialDynamicColors } = _material!;
    _mdc = new MaterialDynamicColors();
  }
}

function resolve(
  color: ReturnType<
    typeof import('@material/material-color-utilities').MaterialDynamicColors['prototype']['primary']
  >,
  scheme: import('@material/material-color-utilities').SchemeTonalSpot
): string {
  return _material!.hexFromArgb(color.getArgb(scheme));
}

async function _mapMaterialToColors(
  scheme: import('@material/material-color-utilities').SchemeTonalSpot,
  sourceHct: import('@material/material-color-utilities').Hct,
  isDark: boolean
) {
  const { hexFromArgb, TonalPalette } = _material!;
  const mdc = _mdc!;
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
  colors['--md-on-surface'] = resolve(mdc.onSurface(), scheme);
  colors['--md-surface-variant'] = resolve(mdc.surfaceVariant(), scheme);
  colors['--md-on-surface-variant'] = resolve(mdc.onSurfaceVariant(), scheme);
  colors['--md-outline'] = resolve(mdc.outline(), scheme);
  colors['--md-outline-variant'] = resolve(mdc.outlineVariant(), scheme);

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
  await _loadMaterial();
  const { Hct, SchemeTonalSpot, argbFromHex } = _material!;
  const sourceHct = Hct.fromInt(argbFromHex(seedColor));
  const scheme = new SchemeTonalSpot(sourceHct, isDark, contrastLevel);
  const colors = await _mapMaterialToColors(scheme, sourceHct, isDark);

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
  await _loadMaterial();
  const { Hct, SchemeTonalSpot, argbFromHex } = _material!;
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
