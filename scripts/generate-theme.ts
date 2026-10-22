import { writeFileSync } from 'node:fs';
import {
  argbFromHex,
  type DynamicColor,
  type DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeTonalSpot,
  TonalPalette,
} from '../src/utils/theme/material-color-utils.js';

// ─── CONFIG ─────────────────────────────────────────────────────────────────
// Change this seed color to regenerate the entire palette
const SEED_HEX = '#63A002';
// ─────────────────────────────────────────────────────────────────────────────

const sourceHct = Hct.fromInt(argbFromHex(SEED_HEX));

// Contrast levels: 0 = standard, 0.5 = medium, 1.0 = high
const contrastLevels = [0, 0.5, 1.0] as const;

// Generate schemes for all contrast levels
const schemes: Record<string, DynamicScheme> = {};

contrastLevels.forEach((contrastLevel) => {
  const levelName = contrastLevel === 0 ? 'standard' : contrastLevel === 0.5 ? 'medium' : 'high';
  schemes[`light-${levelName}`] = new SchemeTonalSpot(sourceHct, false, contrastLevel);
  schemes[`dark-${levelName}`] = new SchemeTonalSpot(sourceHct, true, contrastLevel);
});

const mdc = new MaterialDynamicColors();

// Helper: resolve a DynamicColor against a scheme to get ARGB
function resolve(color: DynamicColor, scheme: DynamicScheme): string {
  return hexFromArgb(color.getArgb(scheme));
}

// Map Material DynamicColors → Material Design CSS variables
function buildMaterialColors(scheme: DynamicScheme, isDark: boolean): Record<string, string> {
  const colors: Record<string, string> = {};

  // Primary
  colors['--md-primary'] = resolve(mdc.primary(), scheme);
  colors['--md-on-primary'] = resolve(mdc.onPrimary(), scheme);
  colors['--md-primary-container'] = resolve(mdc.primaryContainer(), scheme);
  colors['--md-on-primary-container'] = resolve(mdc.onPrimaryContainer(), scheme);

  // Secondary
  colors['--md-secondary'] = resolve(mdc.secondary(), scheme);
  colors['--md-on-secondary'] = resolve(mdc.onSecondary(), scheme);
  colors['--md-secondary-container'] = resolve(mdc.secondaryContainer(), scheme);
  colors['--md-on-secondary-container'] = resolve(mdc.onSecondaryContainer(), scheme);

  // Tertiary
  colors['--md-tertiary'] = resolve(mdc.tertiary(), scheme);
  colors['--md-on-tertiary'] = resolve(mdc.onTertiary(), scheme);
  colors['--md-tertiary-container'] = resolve(mdc.tertiaryContainer(), scheme);
  colors['--md-on-tertiary-container'] = resolve(mdc.onTertiaryContainer(), scheme);

  // Error
  colors['--md-error'] = resolve(mdc.error(), scheme);
  colors['--md-on-error'] = resolve(mdc.onError(), scheme);
  colors['--md-error-container'] = resolve(mdc.errorContainer(), scheme);
  colors['--md-on-error-container'] = resolve(mdc.onErrorContainer(), scheme);

  // Background / Surface
  colors['--md-background'] = resolve(mdc.background(), scheme);
  colors['--md-on-background'] = resolve(mdc.onBackground(), scheme);
  colors['--md-surface'] = resolve(mdc.surface(), scheme);
  colors['--md-surface-tint'] = resolve(mdc.primary(), scheme);
  colors['--md-on-surface'] = resolve(mdc.onSurface(), scheme);
  colors['--md-surface-variant'] = resolve(mdc.surfaceVariant(), scheme);
  colors['--md-on-surface-variant'] = resolve(mdc.onSurfaceVariant(), scheme);
  colors['--md-outline'] = resolve(mdc.outline(), scheme);
  colors['--md-outline-variant'] = resolve(mdc.outlineVariant(), scheme);

  // Inverse
  colors['--md-inverse-surface'] = resolve(mdc.inverseSurface(), scheme);
  colors['--md-inverse-on-surface'] = resolve(mdc.inverseOnSurface(), scheme);
  colors['--md-inverse-primary'] = resolve(mdc.inversePrimary(), scheme);

  // Primary Fixed
  colors['--md-primary-fixed'] = resolve(mdc.primaryFixed(), scheme);
  colors['--md-on-primary-fixed'] = resolve(mdc.onPrimaryFixed(), scheme);
  colors['--md-primary-fixed-dim'] = resolve(mdc.primaryFixedDim(), scheme);
  colors['--md-on-primary-fixed-variant'] = resolve(mdc.onPrimaryFixedVariant(), scheme);

  // Secondary Fixed
  colors['--md-secondary-fixed'] = resolve(mdc.secondaryFixed(), scheme);
  colors['--md-on-secondary-fixed'] = resolve(mdc.onSecondaryFixed(), scheme);
  colors['--md-secondary-fixed-dim'] = resolve(mdc.secondaryFixedDim(), scheme);
  colors['--md-on-secondary-fixed-variant'] = resolve(mdc.onSecondaryFixedVariant(), scheme);

  // Tertiary Fixed
  colors['--md-tertiary-fixed'] = resolve(mdc.tertiaryFixed(), scheme);
  colors['--md-on-tertiary-fixed'] = resolve(mdc.onTertiaryFixed(), scheme);
  colors['--md-tertiary-fixed-dim'] = resolve(mdc.tertiaryFixedDim(), scheme);
  colors['--md-on-tertiary-fixed-variant'] = resolve(mdc.onTertiaryFixedVariant(), scheme);

  // Surface Dim/Bright
  colors['--md-surface-dim'] = resolve(mdc.surfaceDim(), scheme);
  colors['--md-surface-bright'] = resolve(mdc.surfaceBright(), scheme);

  // Surface Container
  colors['--md-surface-container-lowest'] = resolve(mdc.surfaceContainerLowest(), scheme);
  colors['--md-surface-container-low'] = resolve(mdc.surfaceContainerLow(), scheme);
  colors['--md-surface-container'] = resolve(mdc.surfaceContainer(), scheme);
  colors['--md-surface-container-high'] = resolve(mdc.surfaceContainerHigh(), scheme);
  colors['--md-surface-container-highest'] = resolve(mdc.surfaceContainerHighest(), scheme);

  // Shadow / Scrim
  colors['--md-shadow'] = resolve(mdc.shadow(), scheme);
  colors['--md-scrim'] = resolve(mdc.scrim(), scheme);

  // Success (green, derived)
  const successChroma = Math.min(sourceHct.chroma, 48);
  const successPalette = TonalPalette.fromHueAndChroma(142, successChroma);
  colors['--md-success'] = hexFromArgb(successPalette.tone(isDark ? 80 : 40));
  colors['--md-on-success'] = hexFromArgb(successPalette.tone(isDark ? 20 : 100));

  // Warning (amber, derived)
  const warningChroma = Math.min(sourceHct.chroma, 48);
  const warningPalette = TonalPalette.fromHueAndChroma(85, warningChroma);
  colors['--md-warning'] = hexFromArgb(warningPalette.tone(isDark ? 80 : 40));
  colors['--md-on-warning'] = hexFromArgb(warningPalette.tone(isDark ? 20 : 100));

  return colors;
}

// Build CSS block for Material Design theme
function buildMaterialCSS(
  name: string,
  colorScheme: 'light' | 'dark',
  colors: Record<string, string>
): string {
  const dataTheme = name;
  let css = `:root[data-theme="${dataTheme}"] {\n`;
  css += `  color-scheme: ${colorScheme};\n`;
  for (const [key, value] of Object.entries(colors)) {
    css += `  ${key}: ${value};\n`;
  }
  css += `}\n`;
  return css;
}

// Log palette tones so user can see full generated palette
function logPalette(label: string, palette: TonalPalette) {
  const tones = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];
  const entries = tones.map((t) => `  ${t}: ${hexFromArgb(palette.tone(t))}`).join('\n');
  console.log(`\n${label}:\n${entries}`);
}

// Generate CSS for all theme variants
let allCSS = '';
const standardLightScheme = schemes['light-standard'];

contrastLevels.forEach((contrastLevel) => {
  const levelName = contrastLevel === 0 ? 'standard' : contrastLevel === 0.5 ? 'medium' : 'high';
  const lightScheme = schemes[`light-${levelName}`];
  const darkScheme = schemes[`dark-${levelName}`];

  const lightColors = buildMaterialColors(lightScheme, false);
  const darkColors = buildMaterialColors(darkScheme, true);
  const lightCSS = buildMaterialCSS(`light-${levelName}`, 'light', lightColors);
  const darkCSS = buildMaterialCSS(`dark-${levelName}`, 'dark', darkColors);

  allCSS += `${lightCSS}\n${darkCSS}\n`;
});

// Add Tailwind v4 @theme directive so utility classes are generated
allCSS += `\n/* Tailwind v4 Theme Utility Mappings */\n@theme {\n`;
const sampleColors = buildMaterialColors(standardLightScheme, false);
for (const key of Object.keys(sampleColors)) {
  const colorName = key.replace('--md-', '');
  allCSS += `  --color-md-${colorName}: var(${key});\n`;
}
allCSS += `}\n`;

const successPaletteLog = TonalPalette.fromHueAndChroma(142, Math.min(sourceHct.chroma, 48));
const warningPaletteLog = TonalPalette.fromHueAndChroma(85, Math.min(sourceHct.chroma, 48));

console.log('=== GENERATED TONAL PALETTES ===');
logPalette('Primary (Standard Light)', standardLightScheme.primaryPalette);
logPalette('Secondary (Standard Light)', standardLightScheme.secondaryPalette);
logPalette('Tertiary (Accent) (Standard Light)', standardLightScheme.tertiaryPalette);
logPalette('Neutral (Standard Light)', standardLightScheme.neutralPalette);
logPalette('Neutral Variant (Standard Light)', standardLightScheme.neutralVariantPalette);
logPalette('Error (Standard Light)', standardLightScheme.errorPalette);
logPalette('Success (green, derived)', successPaletteLog);
logPalette('Warning (amber, derived)', warningPaletteLog);

console.log('\n=== GENERATED THEMES ===');
console.log(allCSS);

// Write to file
writeFileSync('src/styles/theme.css', allCSS);
console.log('\nThemes saved to src/styles/theme.css');
console.log(
  'Available themes: light-standard, light-medium, light-high, dark-standard, dark-medium, dark-high'
);
