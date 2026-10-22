/**
 * Colour arithmetic and theme-token reading for the guards that must reason
 * about what the eye compares - surfaces the CSS composites for us
 * (`color-mix`, alpha washes, box-shadow rims), which no computed style in a
 * unit test can hand back.
 *
 * Shared by `nav-selection-contrast.test.ts` (the floating nav's selected
 * segment against the glass island) and `mail-row-state.test.ts` (the mailbox
 * row's selected fill against the row and against its own ink). Two guards
 * disagreeing about "what colour is `secondary-container` in dark-medium" is
 * exactly the drift this exists to prevent.
 */
import { readFileSync } from 'node:fs';
import { PROJECT_ROOT } from './project-root';

/** Read a source file by repo-relative path. */
export const readSource = (relativePath: string): string =>
  readFileSync(`${PROJECT_ROOT}/${relativePath}`, 'utf8');

export type Rgb = [number, number, number];

export const themeCss = readSource('src/styles/theme.css');

/** Every theme `theme.css` declares, in declaration order. */
export const THEME_NAMES = [...themeCss.matchAll(/:root\[data-theme="([^"]+)"\]/g)].map(
  (m) => m[1]
);

/** The raw value of one `--<name>` token inside one theme block. */
export const tokenOf = (theme: string, name: string): string => {
  const block = themeCss.slice(themeCss.indexOf(`:root[data-theme="${theme}"]`));
  const match = block.slice(0, block.indexOf('\n}')).match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`theme ${theme} has no --${name}`);
  return match[1].trim();
};

export const hexToRgb = (value: string): Rgb => {
  const hex = value.trim().replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as Rgb;
};

export const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export const luminance = (rgb: Rgb): number =>
  0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);

/** WCAG contrast ratio. */
export const contrast = (a: Rgb, b: Rgb): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** `color-mix(in srgb, fg alpha, bg)` - alpha is fg's share. */
export const mix = (fg: Rgb, bg: Rgb, alpha: number): Rgb =>
  fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as Rgb;
