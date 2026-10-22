/**
 * Real-extension probe: a SELECTED mailbox row must be visible, and its ink
 * legible ON the fill - measured on the shipped build, not on a stylesheet.
 *
 * A unit test can prove the ratios from the tokens
 * (`tests/unit/utils/mail-row-state.test.ts`), but it cannot see the responsive fitting,
 * and the responsive fitting is where the previous indicator died twice over:
 *
 *  - the old `ring-2 ring-md-secondary` was a NON-inset box-shadow on a row
 *    inside an `overflow-hidden` wrapper, so the ring was clipped away;
 *  - a plain `bg-md-secondary-container` utility would lose to Tailwind's
 *    `hover:bg-md-surface-variant/40`, so hovering a selected row would repaint
 *    it with the hover wash and read as "no longer selected".
 *
 * So this drives the built extension: seeds four messages, ticks two ADJACENT
 * rows through the same avatar control a user taps, and measures the real
 * computed styles -
 *
 *  1. the fill is the theme's `secondary-container`, opaque, and the untouched
 *     row is NOT painted with it;
 *  2. every shadow layer is INSET (so nothing paints outside the row and gets
 *     clipped by the wrapper the ring died in), and there is a bar at the inline
 *     START plus the 1px rim - both in `on-secondary-container`;
 *  3. hovering a selected row does NOT change its background;
 *  4. every readable line inside the selected row clears 4:1 on that fill, and
 *     is that same container ink (never a muted `on-surface` grey).
 *
 * - in `light-standard`, `dark-standard` and RTL (`ar`).
 *
 * Then the SAME probe walks the four other surfaces that state a row's state -
 * the addresses list (ticked), the identity rows (the open/current one), saved
 * logins (ticked) and the automation rules (the row the keyboard sits on) -
 * through the app's own open-view handoff, and reads each cue out of the PIXELS
 * on that screen: the inline-start column must be the state's own edge ink, the
 * row's dominant pixel must be the fill the stylesheet declares (composited
 * over what the row rests on, because `active` is a 60% wash), and a resting
 * sibling of the same kind must show neither. What each state paints is parsed
 * from `src/styles/row-surfaces.css` rather than restated here, so the probe
 * cannot agree with itself about a value the app no longer ships - and the
 * credentials domain header's select-all disc, whose cue is a 2px border rather
 * than a bar, is measured the same way with a 1px inset.
 *
 * And it measures the CONTROL contract - filter chips, filter and view toggles,
 * and the segmented tab, on five screens - in all SIX themes plus RTL, because
 * the failure it replaces was theme-specific AND inverted: an unapplied control's
 * idle hover painted a stronger fill than applying it, so hovering a filter read
 * as applying it. Each case reads ONE element in three states (resting, hovered
 * while still off, applied) and asserts that the applied fill IS the theme's
 * `--md-primary`, that the hover moves it at most 20/255 from its own resting
 * pixel, and that applied dominates that move ≥4× and measures ≥4:1 against the
 * hovered pixel. The mailbox's inline filter chips live in a panel only the
 * search field's focus opens - and clicking one closes it - so those cases carry
 * a `reveal` that re-opens the row before each read.
 *
 * Colors are parsed here rather than in the page: `getComputedStyle` reports
 * `color(srgb …)` for the doubled declarations Tailwind emits and `oklab()` for
 * its `/85` opacity modifiers, so a canvas round-trip is not a normalizer - the
 * parser below converts all four notations, and the `oklab` arm is validated
 * against the token it came from.
 *
 * Finally it reads the CHROME: an anchored menu (the Settings language picker)
 * must paint above the floating nav island. The menu's number was never the
 * problem - `.view-crossfade`, the wrapper around every view, kept a `transform`
 * from its entry animation, and a stacking context is a jail: the island is a
 * SIBLING of the shell, so nothing inside it could paint above the navbar. That
 * stage therefore asserts the shell's computed transform is `none`, then reads
 * `elementFromPoint` AND the pixels across the band where the menu and the island
 * overlap, in a deliberately short viewport (the two never meet at full height).
 *
 * Screenshots land in `.nav-shot/`, a JSON report goes to stdout, and the exit
 * code is non-zero on any failure. Usage: bun scripts/row-selection-shot.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { avatarPx } from '../src/utils/ui/avatar-size';
import { PORTAL_Z } from '../src/utils/ui/portal-layers.js';

/** The Playwright build actually on disk (see nav-shot.ts for the why). */
function chromiumExecutable(): string | undefined {
  const root =
    process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
      : join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('chromium-'))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (dirs.length === 0) return undefined;
  const win = process.platform === 'win32';
  const sub = win ? 'chrome-win64' : process.platform === 'darwin' ? 'chrome-mac' : 'chrome-linux';
  const exe = join(root, dirs[dirs.length - 1], sub, win ? 'chrome.exe' : 'chrome');
  return existsSync(exe) ? exe : undefined;
}

const OUT_DIR = join(import.meta.dir, '..', '.nav-shot');
const EXTENSION_PATH = join(import.meta.dir, '..', '.output', 'chrome-mv3');
/** The host viewport the whole probe runs in (and the chrome stage restores). */
const POPUP_VIEWPORT = { width: 420, height: 720 };
/**
 * The chrome stage keeps the probe's own viewport: the app frame is a fixed
 * 360×600 (the popup shell's own size), while the portaled menu is placed against
 * the WINDOW, so the list naturally overhangs the content area and meets the nav
 * island (top ≈ 547 in the frame) - the band the bug lived in, with no viewport
 * trickery. The first version of this stage shrank the window instead, which only
 * moved the island off screen: the frame kept its 600px height.
 */

const MAILBOX_ID = 'demo-inbox-1';
const MAILBOX_ADDRESS = 'demo.user@example.com';
/** Four rows: 0 and 1 are ticked (adjacent on purpose), 3 stays untouched. */
const ROW_IDS = ['row-shot-0', 'row-shot-1', 'row-shot-2', 'row-shot-3'];

/**
 * The mailbox search field. Focusing it is what renders the inline filter row,
 * so it is both the reveal for those chips and the reason they exist at all.
 */
const SEARCH_INPUT = '#inbox-search-input';

function seed(preferredLanguage: string): Record<string, unknown> {
  return {
    demoMode: true,
    onboardingComplete: true,
    // Both prompts that would otherwise stand above the email list, pushing the
    // rows it exists to measure below the fold: the retention cleanup banner.
    // Dismissed, not disabled - it is UI a user closes, and the probe needs
    // the list on screen.
    retentionCleanupDismissed: true,
    // BOTH keys, because `preferredLanguage` wins over `locale` on boot - an
    // earlier pass persists the pair, so setting only `locale` silently keeps
    // the old language (and with it the old text direction).
    preferredLanguage,
    language: preferredLanguage,
    locale: preferredLanguage,
    // The mailbox needs a SELECTED address before it renders a list at all -
    // without this the popup shows the empty state and no row ever appears.
    addresses: [
      {
        id: MAILBOX_ID,
        address: MAILBOX_ADDRESS,
        provider: 'demo',
        status: 'active',
        accountStatus: 'active',
        createdAt: Date.now() - 3600_000,
        expiresAt: Date.now() + 86400_000,
      },
    ],
    emailStorageAddressIndex: { [MAILBOX_ID]: MAILBOX_ADDRESS },
    [`storedEmailsByAddress_${MAILBOX_ID}`]: ROW_IDS.map((id, i) => ({
      id,
      from: `sender${i}@example.com`,
      from_name: `Sender ${i}`,
      subject: `Subject ${i} - a line long enough to show truncation`,
      // A body, so the row renders its third line of ink and the run measures
      // all three: subject, sender and the body preview.
      body: 'A short preview line, so the third line of ink is measured too.',
      body_plain: 'A short preview line, so the third line of ink is measured too.',
      date: new Date(Date.now() - i * 3600_000).toISOString(),
      original_inbox: MAILBOX_ADDRESS,
    })),
  };
}

interface Pass {
  name: string;
  themeMode: 'light' | 'dark';
  /** The MD3 contrast level - `data-theme` is `<mode>-<level>`. */
  contrastLevel: 'standard' | 'medium' | 'high';
  locale: string;
  /** true when `dir=rtl` is expected, i.e. the bar sits on the right edge. */
  rtl: boolean;
}

/** The row-stage passes: the two standard themes plus RTL. */
const PASSES: Pass[] = [
  {
    name: 'light-standard',
    themeMode: 'light',
    contrastLevel: 'standard',
    locale: 'en',
    rtl: false,
  },
  { name: 'dark-standard', themeMode: 'dark', contrastLevel: 'standard', locale: 'en', rtl: false },
  { name: 'rtl-ar', themeMode: 'light', contrastLevel: 'standard', locale: 'ar', rtl: true },
];

/**
 * The passes the CONTROL contract is measured in: all SIX themes, plus RTL.
 *
 * Six, not two, because the applied fill is a solid accent role whose ink has to
 * hold in every palette - and because the failures this replaces were
 * theme-specific: `primary-container` on a `primary` fill is 1.54:1 in the
 * `-high` themes, and the old pill segment's `bg-md-surface` on a
 * `bg-md-surface-variant` track measured 1.23:1 in `light-standard` but 1.98:1
 * in `dark-standard`, i.e. the two standard themes do not even agree with each
 * other.
 */
const CONTROL_PASSES: Pass[] = [
  {
    name: 'light-standard',
    themeMode: 'light',
    contrastLevel: 'standard',
    locale: 'en',
    rtl: false,
  },
  { name: 'dark-standard', themeMode: 'dark', contrastLevel: 'standard', locale: 'en', rtl: false },
  { name: 'light-medium', themeMode: 'light', contrastLevel: 'medium', locale: 'en', rtl: false },
  { name: 'dark-medium', themeMode: 'dark', contrastLevel: 'medium', locale: 'en', rtl: false },
  { name: 'light-high', themeMode: 'light', contrastLevel: 'high', locale: 'en', rtl: false },
  { name: 'dark-high', themeMode: 'dark', contrastLevel: 'high', locale: 'en', rtl: false },
  { name: 'rtl-ar', themeMode: 'light', contrastLevel: 'standard', locale: 'ar', rtl: true },
];

type Rgb = [number, number, number];
interface Color {
  rgb: Rgb;
  alpha: number;
  /** The notation the browser reported, for the report. */
  raw: string;
}

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
/** sRGB gamma encode from a linear-light channel. */
const encode = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return clamp255(c * 255);
};

/** `oklab(L a b / alpha)` → sRGB, the notation Tailwind's `/nn` computes to. */
function oklabToRgb(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Any computed color: hex, `rgb()`/`rgba()`, `color(srgb …)` or `oklab()`. */
function parseColor(raw: string | null | undefined): Color | null {
  if (!raw) return null;
  const value = raw.trim();

  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      rgb: [0, 2, 4].map((i) => Number.parseInt(hex[1].slice(i, i + 2), 16)) as Rgb,
      alpha: 1,
      raw: value,
    };
  }

  const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1]
      .split(/[,\s/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length >= 3) {
      return {
        rgb: [parts[0], parts[1], parts[2]] as Rgb,
        alpha: parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1,
        raw: value,
      };
    }
  }

  const srgb = value.match(
    /^color\(srgb\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)(?:\s*\/\s*([\d.]+))?\)$/
  );
  if (srgb) {
    return {
      rgb: [srgb[1], srgb[2], srgb[3]].map((v) => clamp255(Number(v) * 255)) as Rgb,
      alpha: srgb[4] ? Number(srgb[4]) : 1,
      raw: value,
    };
  }

  const oklab = value.match(
    /^oklab\(\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i
  );
  if (oklab) {
    return {
      rgb: oklabToRgb(Number(oklab[1]), Number(oklab[2]), Number(oklab[3])),
      alpha: oklab[4] ? Number(oklab[4]) : 1,
      raw: value,
    };
  }

  return null;
}

const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (rgb: Rgb): number =>
  0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
const contrast = (a: Rgb, b: Rgb): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
/** Composite an alpha ink over its own row fill - what the eye compares. */
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb =>
  fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as Rgb;
/** Two tokens mixed in sRGB: what `color-mix(in srgb, A n%, B)` paints. */
const mix = (a: Rgb, b: Rgb, share: number): Rgb =>
  a.map((c, i) => Math.round(c * share + b[i] * (1 - share))) as Rgb;
const rgbKey = (color: Color): string => `${color.rgb.join(',')}@${color.alpha}`;
/** Largest per-channel difference - used to prove an `oklab()` read is the token. */
const channelDelta = (a: Rgb, b: Rgb): number => Math.max(...a.map((c, i) => Math.abs(c - b[i])));

/**
 * The best (smallest) channel delta between a window of pixels and an ink: how
 * close the edge came to painting the cue at all. Paired with
 * `closestPixel`, which is the pixel that answer came from - so a failure
 * message quotes a real pixel instead of an average nothing painted.
 */
const nearestDelta = (window: Rgb[], ink: Rgb): number =>
  Math.min(...window.map((p) => channelDelta(p, ink)));

const closestPixel = (window: Rgb[], ink: Rgb): Rgb =>
  window.reduce(
    (best, p) => (channelDelta(p, ink) < channelDelta(best, ink) ? p : best),
    window[0]
  );

interface ShadowLayer {
  raw: string;
  color: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
  inset: boolean;
}

/** Layers of a computed `box-shadow`, in either spec serialization order. */
function parseShadow(shadow: string | null): ShadowLayer[] {
  if (!shadow || shadow === 'none') return [];
  const color =
    '(rgba?\\([^)]*\\)|color\\([^)]*\\)|oklab\\([^)]*\\)|oklch\\([^)]*\\)|#[0-9a-f]{3,8})';
  const offsets = '(-?[\\d.]+)px\\s+(-?[\\d.]+)px\\s+(-?[\\d.]+)px\\s+(-?[\\d.]+)px';
  const re = new RegExp(
    `(?:inset\\s+)?${color}\\s+${offsets}(\\s+inset)?|(?:inset\\s+)${color}\\s+${offsets}`,
    'gi'
  );
  const layers: ShadowLayer[] = [];
  for (const match of shadow.matchAll(re)) {
    const groups = match.slice(1).filter((g) => g !== undefined);
    layers.push({
      raw: match[0],
      color: groups[0],
      x: Number(groups[1]),
      y: Number(groups[2]),
      blur: Number(groups[3]),
      spread: Number(groups[4]),
      inset: /inset/i.test(match[0]),
    });
  }
  return layers;
}

interface RowMeasurement {
  id: string;
  found: boolean;
  background: string | null;
  boxShadow: string | null;
  /** The nearest ancestor that clips the row, and whether the row fills it. */
  clip: { overflow: string; rowStartsAtClipEdge: boolean } | null;
  /** Ancestor backgrounds, nearest first - what a translucent fill lands on. */
  backdropChain: string[];
  ink: Array<{ text: string; color: string }>;
}

/** Computed styles and content-column ink for each row, verbatim. */
async function measure(page: Page, ids: string[]): Promise<RowMeasurement[]> {
  return page.evaluate(
    (rowIds: string[]) =>
      rowIds.map((id) => {
        const row = document.querySelector(`#email-button-${id}`) as HTMLElement | null;
        if (!row) {
          return {
            id,
            found: false,
            background: null,
            boxShadow: null,
            clip: null,
            backdropChain: [],
            ink: [],
          };
        }
        const backdropChain: string[] = [];
        for (let p = row.parentElement, i = 0; p && i < 12; p = p.parentElement, i++) {
          backdropChain.push(getComputedStyle(p).backgroundColor);
        }
        let clip: { overflow: string; rowStartsAtClipEdge: boolean } | null = null;
        for (let el = row.parentElement; el; el = el.parentElement) {
          const overflow = getComputedStyle(el).overflow;
          if (overflow.includes('hidden')) {
            clip = {
              overflow,
              rowStartsAtClipEdge:
                Math.abs(row.getBoundingClientRect().left - el.getBoundingClientRect().left) < 0.5,
            };
            break;
          }
        }
        // Text the user reads: inside the row, outside any button (avatar/star),
        // and only elements carrying their own text node.
        const ink = [...row.querySelectorAll('span, p')]
          .filter((el) => !el.closest('button'))
          .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
          .map((el) => ({
            text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48),
            color: getComputedStyle(el).color,
          }));
        const style = getComputedStyle(row);
        return {
          id,
          found: true,
          background: style.backgroundColor,
          boxShadow: style.boxShadow,
          clip,
          backdropChain,
          ink,
        };
      }),
    ids
  );
}

/** The theme tokens the page is painting with, as declared. */
function paintTokens(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      [
        '--md-secondary-container',
        '--md-on-secondary-container',
        '--md-surface',
        '--md-secondary',
        // The control contract's applied fill: a control's applied state must
        // reach this token, not a tint of it.
        '--md-primary',
        // The row contract's other inks and the surfaces a row can rest on, so
        // the cue stage can resolve a declared state against this theme.
        '--md-on-primary',
        '--md-on-surface',
        '--md-surface-variant',
        '--md-surface-container',
        '--md-surface-container-high',
        '--md-surface-container-highest',
      ].map((n) => [n, style.getPropertyValue(n).trim()])
    );
  });
}

/**
 * What the row really paints, read back from its own screenshot: the color of
 * the 3px inline-start column, and the row's dominant background color.
 *
 * A computed style can be correct while the pixels are not - a clipped shadow, a
 * later declaration overpainting the fill, or a bar hidden under an opaque
 * child all leave `getComputedStyle` intact. This is the check that says the
 * selection is actually VISIBLE.
 */
/**
 * `edgeInsetPx` is how far from the inline-start edge the CUE's middle sits:
 * the middle of a 3px bar is 2px in, of a 2px bar 1px, of a 2px border 1px.
 */
async function sampleSelector(
  page: Page,
  target: string | CuePick,
  rtl: boolean,
  edgeInsetPx = 2
): Promise<{ bar: Rgb; edge: Rgb[]; dominant: Rgb; size: [number, number] } | null> {
  const pick = normalizePick(target);
  const locator = page.locator(pick.selector).nth(pick.index ?? 0);
  if ((await locator.count()) === 0) return null;
  const box = await locator.boundingBox();
  if (!box) return null;
  const png = (await locator.screenshot()).toString('base64');
  return page.evaluate(
    async ({ data, cssWidth, inlineStartOnRight, cueInsetPx }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      const { data: px } = ctx.getImageData(0, 0, img.width, img.height);
      // Screenshots can come back at the device scale factor; sample in CSS px.
      const scale = cssWidth > 0 ? img.width / cssWidth : 1;
      type Px = [number, number, number];
      const at = (x: number, y: number): Px => {
        const cx = Math.max(0, Math.min(img.width - 1, Math.round(x)));
        const cy = Math.max(0, Math.min(img.height - 1, Math.round(y)));
        const i = (cy * img.width + cx) * 4;
        return [px[i], px[i + 1], px[i + 2]];
      };
      // The middle of the bar, sampled up and down to dodge glyph ink. The
      // offset stays inside the middle band of the element: a small control (a
      // 24px disc with an 8px corner radius) has no room for ±8, and folding its
      // corner antialiasing into the reading turned a painted 2px border into a
      // 24%-alpha blend - the one measurement that made this probe report the
      // disc's cue as missing while it was on screen.
      const midY = img.height / 2;
      const dy = Math.max(2, Math.min(8, Math.floor(img.height * 0.15)));
      const ys = [midY - dy, midY, midY + dy];
      const barX = inlineStartOnRight ? img.width - cueInsetPx * scale : cueInsetPx * scale;
      const barSamples = ys.map((y) => at(barX, y));
      const bar = [0, 1, 2].map((c) =>
        Math.round(barSamples.reduce((sum, s) => sum + s[c], 0) / barSamples.length)
      ) as Px;
      // The CUE WINDOW: the first few CSS px of the inline-start edge, each a
      // column averaged over the same three heights. A single sample cannot say
      // where a bar starts: an inset shadow paints inside the PADDING box, so a
      // row with a 1px border shifts its own bar one pixel along (measured on
      // the automation rule row, whose ink bar sits at x = 2…3), and a control
      // whose cue is a 2px border starts its ink at the border box instead.
      // Asserting the window asks the honest question - is the state's ink
      // painted at the inline-start edge - without pinning which pixel.
      const windowCount = Math.max(3, Math.round(4 * scale));
      const edge: Px[] = [];
      for (let k = 0; k < windowCount; k++) {
        const x = inlineStartOnRight ? img.width - 1 - k : k;
        const samples = ys.map((y) => at(x, y));
        edge.push(
          [0, 1, 2].map((c) =>
            Math.round(samples.reduce((sum, s) => sum + s[c], 0) / samples.length)
          ) as Px
        );
      }
      // The dominant colour over a coarse grid - the row's own background.
      const counts = new Map<string, { rgb: Px; n: number }>();
      for (let y = 5; y < img.height - 3; y += 4) {
        for (let x = 5 * scale; x < img.width - 5 * scale; x += 5) {
          const rgb = at(x, y);
          const key = rgb.join(',');
          const entry = counts.get(key) ?? { rgb, n: 0 };
          entry.n += 1;
          counts.set(key, entry);
        }
      }
      const dominant = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.rgb ?? ([0, 0, 0] as Px);
      return {
        bar,
        edge,
        dominant,
        size: [img.width / scale, img.height / scale] as [number, number],
      };
    },
    { data: png, cssWidth: box.width, inlineStartOnRight: rtl, cueInsetPx: edgeInsetPx }
  );
}

/** The mailbox row's own measurement, by its seeded id. */
function samplePixels(
  page: Page,
  id: string,
  rtl: boolean
): Promise<{ bar: Rgb; edge: Rgb[]; dominant: Rgb; size: [number, number] } | null> {
  return sampleSelector(page, `#email-button-${id}`, rtl);
}

/** The mode of a screenshot's pixels, decoded in the page (no PNG decoder here). */
async function dominantOfPng(page: Page, png: string): Promise<Rgb | null> {
  return page.evaluate(
    async ({ data }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      const { data: px } = ctx.getImageData(0, 0, img.width, img.height);
      const counts = new Map<string, { rgb: [number, number, number]; n: number }>();
      // A grid inset from the edge, so the antialiased rim of a rounded control is
      // not what the mode lands on.
      for (let y = 3; y < img.height - 3; y += 2) {
        for (let x = 3; x < img.width - 3; x += 2) {
          const i = (y * img.width + x) * 4;
          const rgb: [number, number, number] = [px[i], px[i + 1], px[i + 2]];
          const entry = counts.get(rgb.join(',')) ?? { rgb, n: 0 };
          entry.n += 1;
          counts.set(rgb.join(','), entry);
        }
      }
      return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.rgb ?? null;
    },
    { data: png }
  );
}

/**
 * The dominant colour inside an element's own box - its fill, pixels not
 * computed styles. A control's glyph is small compared with its box, so the
 * mode of a coarse grid is the fill it actually paints.
 */
async function dominantColor(page: Page, target: string | CuePick): Promise<Rgb | null> {
  const pick = normalizePick(target);
  const locator = page.locator(pick.selector).nth(pick.index ?? 0);
  if ((await locator.count()) === 0) return null;
  const box = await locator.boundingBox();
  if (!box) return null;
  const png = (await locator.screenshot()).toString('base64');
  return dominantOfPng(page, png);
}

/**
 * The same read for a BAND of the viewport rather than an element - where what
 * paints is the question (two overlays overlapping), there is no element to
 * screenshot, and the composite is the answer.
 */
async function dominantInClip(
  page: Page,
  clip: { x: number; y: number; width: number; height: number }
): Promise<Rgb | null> {
  if (clip.width < 6 || clip.height < 6) return null;
  const png = (await page.screenshot({ clip })).toString('base64');
  return dominantOfPng(page, png);
}

/**
 * The dominant colour of an element's TOP band - for an element something is
 * OVER.
 *
 * The mailbox's selection strip is anchored to the bottom of the list, and with
 * the probe's four seeded rows it covers the last row outright. A whole-box
 * dominant of that row therefore reported the strip's own `secondary-container`
 * pill as if it were the row's resting fill - 1.34:1 against the ticked fill in
 * `dark-standard`, where the strip keeps the raw token while a ticked row paints
 * the palette's deepened fill. The band above the strip is the row's own paint.
 */
async function dominantTopBand(
  page: Page,
  target: string | CuePick,
  share = 0.3
): Promise<Rgb | null> {
  const pick = normalizePick(target);
  const locator = page.locator(pick.selector).nth(pick.index ?? 0);
  if ((await locator.count()) === 0) return null;
  const box = await locator.boundingBox();
  if (!box) return null;
  return dominantInClip(page, {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.max(8, Math.round(box.height * share)),
  });
}

const failures: string[] = [];
const report: Record<string, unknown>[] = [];

/**
 * Progress, on stderr so stdout stays the JSON report alone (a run is minutes
 * long, and a killed run that printed nothing is impossible to diagnose).
 */
function progress(message: string): void {
  process.stderr.write(`· ${message}\n`);
}

/**
 * The one size every list row's leading avatar must paint - read from the app's
 * own scale, never restated here.
 */
const ROW_AVATAR_PX = avatarPx('row');

/** The rendered box of an element, in whole px. */
async function measureBox(page: Page, selector: string): Promise<[number, number] | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return [Math.round(rect.width), Math.round(rect.height)] as [number, number];
  }, selector);
}

/**
 * Measure each list row's avatar on its own screen, through the app's own
 * open-view handoff (the two-step seed + handoff `runCue` uses, for the same
 * reason: an `openView` written alongside the seed is eaten by the live page).
 */
async function runAvatarSizes(page: Page, pass: Pass): Promise<void> {
  for (const avatarCase of AVATAR_CASES) {
    await seedAndOpen(page, cueData(), avatarCase.view);

    try {
      await page.waitForSelector(avatarCase.selector, { timeout: 15000 });
    } catch {
      check(
        false,
        `${pass.name} · avatar ${avatarCase.key}: the ${avatarCase.view} list never appeared (${avatarCase.selector})`
      );
      continue;
    }

    const box = await measureBox(page, avatarCase.selector);
    check(box !== null, `${pass.name} · avatar ${avatarCase.key}: no avatar box was measurable`);
    if (!box) continue;
    check(
      box[0] === ROW_AVATAR_PX && box[1] === ROW_AVATAR_PX,
      `${pass.name} · avatar ${avatarCase.key}: paints ${box[0]}×${box[1]}px, expected ${ROW_AVATAR_PX}×${ROW_AVATAR_PX}px (the "row" tier)`
    );
    report.push({ pass: pass.name, avatar: { surface: avatarCase.key, box } });
  }
}

// ── The cue stage: every other surface that states a row's state ────────────
//
// Four views beyond the mailbox state a row's state through the same contract:
// the addresses list (ticked), the identity rows (the open/current one), saved
// logins (ticked) and the automation rules (the row the keyboard sits on). Each
// case below drives the app to that surface through its own open-view handoff,
// turns the state on through the control a user taps, and then reads the cue out
// of the pixels of that screen.
//
// What each state paints is PARSED from the stylesheet rather than restated: a
// probe that repeats the values would agree with itself while the app shipped
// something else, which is exactly how a dead fill goes unnoticed.

const ROW_SURFACES_CSS = join(import.meta.dir, '..', 'src', 'styles', 'row-surfaces.css');
const ROW_STATES = ['selected', 'active', 'highlighted'] as const;
type RowStateName = (typeof ROW_STATES)[number];

/**
 * A state's fill as the sheet declares it: the token, its share, and - where the
 * share is not 1 - the colour it is mixed with (`transparent`, or a second token
 * when the palette DEEPENS the state).
 */
interface DeclaredFill {
  token: string;
  share: number;
  mixedWith: 'transparent' | string;
}

/**
 * The stylesheet's rules, selector list and body - so a state can be resolved
 * ACROSS the rules that name it: the medium/high palettes' base rule, the
 * `standard` palettes' deepening rule, and a mode-wide rule where one applies.
 * Comments are stripped first: the sheet explains itself in prose that names
 * syntax this scanner must not read as values.
 */
const ROW_SHEET_RULES: { selectors: string[]; body: string }[] = (() => {
  const css = readFileSync(ROW_SURFACES_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: { selectors: string[]; body: string }[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]
      .split(',')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (selectors.length > 0) rules.push({ selectors, body: match[2] });
  }
  return rules;
})();

/** Declarations in force for a selector in one theme: the palette's rule first. */
function sheetDecl(selector: string, theme: string): string {
  const overrides = [
    `:root[data-theme="${theme}"] ${selector}`,
    ...['light', 'dark']
      .filter((mode) => theme.startsWith(mode))
      .map((mode) => `:root[data-theme^="${mode}"] ${selector}`),
  ];
  const parts: string[] = [];
  for (const override of overrides) {
    for (const rule of ROW_SHEET_RULES) {
      if (rule.selectors.includes(override)) parts.push(rule.body);
    }
  }
  for (const rule of ROW_SHEET_RULES) {
    if (rule.selectors.includes(selector)) parts.push(rule.body);
  }
  return parts.join('\n');
}

/**
 * The fill one row state paints in one theme, read out of `row-surfaces.css`.
 *
 * `null` means the stylesheet no longer declares it in a shape this probe can
 * read - reported as a failure rather than silently skipped, because every
 * assertion below is expressed in terms of this value.
 */
function declaredFill(state: RowStateName, theme: string): DeclaredFill | null {
  const decl = sheetDecl(`.row-surface-${state}`, theme);
  const line = /background-color:\s*([^;]+);/
    .exec(decl)?.[1]
    ?.replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
  if (!line) return null;
  const plain = /^var\((--md-[a-z-]+)\)$/.exec(line);
  if (plain) return { token: plain[1], share: 1, mixedWith: 'transparent' };
  const wash = /^color-mix\(in srgb, var\((--md-[a-z-]+)\) (\d+)%, transparent\)$/.exec(line);
  if (wash) return { token: wash[1], share: Number(wash[2]) / 100, mixedWith: 'transparent' };
  const deepened =
    /^color-mix\(in srgb, var\((--md-[a-z-]+)\) (\d+)%, var\((--md-[a-z-]+)\)\)$/.exec(line);
  if (deepened) {
    return { token: deepened[1], share: Number(deepened[2]) / 100, mixedWith: deepened[3] };
  }
  return null;
}

const CUE_ADDRESS_A = 'cue.alpha@example.com';
const CUE_ADDRESS_B = 'cue.beta@example.com';
const CUE_IDENTITY_A = 'Cue Identity Alpha';
const CUE_IDENTITY_B = 'Cue Identity Beta';
const CUE_DOMAIN = 'cue-logins.example';
const CUE_LOGIN_A = 'login-cue-0001';
const CUE_LOGIN_B = 'login-cue-0002';
const CUE_RULE_A = 'rule-cue-0001';
const CUE_RULE_B = 'rule-cue-0002';

/**
 * The data the four views need, written once per pass before the cases run.
 *
 * `addresses` includes the mailbox's own inbox as well as the two cue inboxes,
 * so nothing the mailbox stage left behind dangles while the list is read.
 */
function cueData(): Record<string, unknown> {
  const address = (id: string, addr: string, ageMs: number) => ({
    id,
    address: addr,
    provider: 'demo',
    status: 'active',
    accountStatus: 'active',
    createdAt: Date.now() - ageMs,
    expiresAt: Date.now() + 86400_000,
  });
  return {
    addresses: [
      address('cue-address-a', CUE_ADDRESS_A, 60_000),
      address('cue-address-b', CUE_ADDRESS_B, 120_000),
      address(MAILBOX_ID, MAILBOX_ADDRESS, 240_000),
    ],
    emailStorageAddressIndex: {
      'cue-address-a': CUE_ADDRESS_A,
      'cue-address-b': CUE_ADDRESS_B,
      [MAILBOX_ID]: MAILBOX_ADDRESS,
    },
    identities: [CUE_IDENTITY_A, CUE_IDENTITY_B].map((name, i) => ({
      id: `cue-identity-${i}`,
      name,
      firstNames: `Cue${i}`,
      lastNames: 'Identity',
      useRandomPassword: false,
      // REQUIRED by `isPersistedIdentity` (`storage-keys.ts`): without it the
      // loader filters the record out and the view renders its empty state, so
      // the probe would report a missing surface for a seed that never landed.
      isDefault: false,
      preferredEmail: '',
      createdAt: Date.now() - (i + 1) * 60_000,
      updatedAt: Date.now() - (i + 1) * 60_000,
    })),
    // The second identity is the OPEN one, so the row that must carry the cue is
    // not the row that would be highlighted by list order alone.
    selectedIdentityId: 'cue-identity-1',
    loginInfo: [CUE_LOGIN_A, CUE_LOGIN_B].map((id, i) => ({
      id,
      domain: CUE_DOMAIN,
      email: `cue${i}@${CUE_DOMAIN}`,
      username: `cue${i}`,
      password: `not-a-real-secret-${i}`,
      website: `https://${CUE_DOMAIN}/login/${i}`,
      timestamp: Date.now() - (i + 1) * 3600_000,
    })),
    // Rules ship enabled and expanded; the cue is the keyboard's row, which is a
    // state the rule list has to be able to paint without any selection at all.
    mailboxRules: [CUE_RULE_A, CUE_RULE_B].map((id, i) => ({
      id,
      name: `Cue rule ${i}`,
      enabled: true,
      field: 'sender',
      contains: `cue-${i}@example.com`,
      createdAt: Date.now() - (i + 1) * 60_000,
    })),
  };
}

/**
 * One element a case names, as a selector plus WHICH match - never a seeded id
 * where the app does not persist one. The credentials rows are stored with
 * generated ids, so naming them by the id this probe wrote would address an
 * element the app never renders (that is how the first version of this stage
 * reported four missing surfaces).
 */
interface CuePick {
  selector: string;
  /** Defaults to the first match. */
  index?: number;
}

function normalizePick(target: string | CuePick): CuePick {
  return typeof target === 'string' ? { selector: target } : target;
}

/** How a pick reads in a failure message. */
function pickLabel(target: string | CuePick): string {
  const pick = normalizePick(target);
  return pick.index === undefined ? pick.selector : `${pick.selector} [${pick.index}]`;
}

function samePick(a: string | CuePick, b: string | CuePick): boolean {
  const left = normalizePick(a);
  const right = normalizePick(b);
  return left.selector === right.selector && (left.index ?? 0) === (right.index ?? 0);
}

interface CueCase {
  /** How the case reads in the report. */
  key: string;
  /** The view the open-view handoff opens (`openView`). */
  view: string;
  /** The element that must carry the cue. */
  target: CuePick;
  /** A resting element of the SAME kind - the comparison that gives the cue meaning. */
  sibling: CuePick;
  /** A row state's declared values, or a cue the case declares (a border). */
  cue: { state: RowStateName } | { token: string; insetPx: number; fill: false };
  /**
   * The control a user taps to turn the state on, where it is not on at boot.
   * Clicked through `clickClear`, so the floating nav cannot intercept it.
   */
  activate?: CuePick;
}

/** The domain section the credentials cases address. */
const CUE_DOMAIN_SECTION = `[data-domain-section="${CUE_DOMAIN}"]`;
/** The login rows, in render order - the app mints their ids, so address by rank. */
const cueLoginRow = (index: number): CuePick => ({
  selector: `${CUE_DOMAIN_SECTION} [data-login-row]`,
  index,
});

/**
 * The list rows whose leading avatar must be the SAME size on every screen.
 *
 * This is the exact complaint the avatar scale answers: the mailbox row's
 * avatar was 35px, the addresses row 36px, the identity row 40px and a saved
 * login 32px - one role, four sizes. Each selector is the row's own select
 * control, i.e. the element a user taps to tick that row.
 */
const AVATAR_CASES: Array<{ key: string; view: string; selector: string }> = [
  {
    key: 'addresses row',
    view: 'addresses',
    selector: `[data-address="${CUE_ADDRESS_A}"] button[aria-pressed]`,
  },
  { key: 'identities row', view: 'identities', selector: '[role="listitem"] button[aria-pressed]' },
  {
    key: 'saved-login row',
    view: 'loginInfo',
    // `button[aria-pressed]`, not `button`: the first row of the first domain
    // section also carries the drag hint, whose dismiss ✕ is a button too (and
    // measured 12px here - the probe's first version reported exactly that).
    selector: `${CUE_DOMAIN_SECTION} [data-login-row] button[aria-pressed]`,
  },
];

const CUE_CASES: CueCase[] = [
  {
    key: 'addresses · selected',
    view: 'addresses',
    target: { selector: `[data-address="${CUE_ADDRESS_A}"]` },
    sibling: { selector: `[data-address="${CUE_ADDRESS_B}"]` },
    cue: { state: 'selected' },
    // The leading avatar is the control a user ticks a row with; the row itself
    // is not focusable, so this is the same path a pointer takes.
    activate: { selector: `[data-address="${CUE_ADDRESS_A}"] button[aria-pressed]` },
  },
  {
    key: 'identities · active',
    view: 'identities',
    target: { selector: `[role="listitem"][aria-label="${CUE_IDENTITY_B}"]` },
    sibling: { selector: `[role="listitem"][aria-label="${CUE_IDENTITY_A}"]` },
    cue: { state: 'active' },
  },
  {
    key: 'credentials · selected',
    view: 'loginInfo',
    target: cueLoginRow(0),
    sibling: cueLoginRow(1),
    cue: { state: 'selected' },
    // The row's avatar is its select control - addressed by its pressed state,
    // not by rank, because the first row also carries the drag hint's ✕.
    activate: { selector: `${CUE_DOMAIN_SECTION} [data-login-row] button[aria-pressed]` },
  },
  {
    key: 'credentials · domain select-all disc',
    view: 'loginInfo',
    target: { selector: `${CUE_DOMAIN_SECTION} button`, index: 0 },
    sibling: { selector: `${CUE_DOMAIN_SECTION} button`, index: 0 },
    // A disc, not a row: its cue is a 2px border on a control whose content (a
    // favicon) covers the box, so only the border column is asserted.
    cue: { token: '--md-primary', insetPx: 1, fill: false },
    activate: { selector: `${CUE_DOMAIN_SECTION} button`, index: 0 },
  },
  {
    key: 'automation · active',
    view: 'automation',
    target: { selector: `#rule-row-${CUE_RULE_A}` },
    sibling: { selector: `#rule-row-${CUE_RULE_B}` },
    cue: { state: 'active' },
    // The row is the roving-focus target: clicking it is what the keyboard does.
    activate: { selector: `#rule-row-${CUE_RULE_A}` },
  },
];

/**
 * A control that states its applied / off state through `controlSurface`
 * (`src/utils/ui/row-surface.ts`): a filter chip, a filter or view toggle, a
 * segmented tab.
 *
 * Each case names ONE element, measured in all three of its states - resting,
 * hovered while still off, and applied - because the bug this replaces was an
 * inversion *within* a single element: its idle hover (`bg-md-surface-variant`,
 * 1.23:1 on the surface in `light-standard`) painted a STRONGER fill than its
 * applied form (`bg-md-primary/10`, 1.15:1), so hovering an unapplied filter read
 * as applying it - and the drawer's tag pills hovered to the applied class
 * itself. Ten sites shipped that inversion, and it was invisible in a screenshot
 * because both states were quiet.
 */
interface ControlCase {
  /** How the case reads in the report. */
  key: string;
  kind: 'filter chip' | 'selection chip' | 'filter toggle' | 'view toggle' | 'segment';
  /** The control itself. */
  control: string | CuePick;
  /**
   * A click that brings the control onto the screen where it is not there at
   * boot (the selection strip's chip needs a ticked row first).
   */
  setup?: string | CuePick;
  /**
   * A click that re-opens the TRANSIENT panel the control lives in, run before
   * every read.
   *
   * The mailbox's filter chips only exist while the search field is focused, and
   * focusing is what clicking a chip takes away: the field's `onBlur` sets
   * `searchFocused = false` on a 200ms timer, so the chip that was just applied
   * is gone from the DOM well before a transition could settle - and the earlier
   * version of this stage read `null` and reported the surface as missing. The
   * reveal is a path a user takes (tap the search field again), and it re-renders
   * the chip in its applied state, so the pixel read is of the SAME control, not
   * of a different element.
   */
  reveal?: string | CuePick;
  /**
   * A click that returns the control to its resting state once the case is done,
   * where leaving it applied would change what a later case in the same view
   * measures (an `is:otp` chip empties the row list the select-all chip needs).
   */
  reset?: string | CuePick;
}

/** One screen's controls - the screen is opened once per pass, not once per case. */
interface ControlView {
  view: string;
  cases: ControlCase[];
}

const CONTROL_VIEWS: ControlView[] = [
  {
    view: 'inbox',
    cases: [
      { key: 'mailbox · filter toggle', kind: 'filter toggle', control: '#button-filter' },
      { key: 'mailbox · layout view toggle', kind: 'view toggle', control: '#button-tab-view' },
      {
        // A chip that lives in the popup: the selection strip's select-all, which
        // is measurable OFF because one ticked row is not enough for
        // `selectionAllMatched`.
        key: 'mailbox · select-all chip',
        kind: 'selection chip',
        control: '#button-select-all-matched',
        // One ticked row: enough for the selection strip to appear.
        setup: `#email-button-${ROW_IDS[0]} button[aria-pressed]`,
      },
      {
        // A real FILTER chip: the inline filter row's `is:otp` chip, on the same
        // `controlSurface` contract. It is reachable after all - the row renders
        // when the search field is focused, which is why an earlier read of this
        // layout (at boot, unfocused) found no `#button-otp-only` in the DOM and
        // concluded the chips were not in the popup. Both chips run LAST in this
        // group and reset themselves, because applying one filters the very list
        // the select-all chip is measured against.
        key: 'mailbox · otp filter chip',
        kind: 'filter chip',
        control: '#button-otp-only',
        reveal: SEARCH_INPUT,
        reset: '#button-otp-only',
      },
      {
        key: 'mailbox · attachment filter chip',
        kind: 'filter chip',
        control: '#button-has-attachment',
        reveal: SEARCH_INPUT,
        reset: '#button-has-attachment',
      },
    ],
  },
  {
    view: 'addresses',
    cases: [
      {
        // The second segment of the live/inactive strip: idle at boot (`live` is
        // applied), so the case can measure what hovering an UNAPPLIED segment
        // paints and then apply it.
        key: 'addresses · segmented tab',
        kind: 'segment',
        control: { selector: '[data-tour="manage-tabs"] button[role="tab"]', index: 1 },
      },
      {
        key: 'addresses · filter toggle',
        kind: 'filter toggle',
        control: '#button-addresses-filter',
      },
    ],
  },
  {
    view: 'identities',
    cases: [
      {
        key: 'identities · filter toggle',
        kind: 'filter toggle',
        control: '#button-identities-filter',
      },
    ],
  },
  {
    view: 'loginInfo',
    cases: [
      {
        key: 'saved logins · filter toggle',
        kind: 'filter toggle',
        control: '#button-savedlogin-filter',
      },
    ],
  },
];

/** One element's own paint, as declared - plus what lies behind it. */
interface CueNode {
  found: boolean;
  background: string | null;
  boxShadow: string | null;
  /** Ancestor background-colors, nearest first, ending at the first opaque one. */
  backdropChain: string[];
}

/**
 * The computed paint of the cue's element and of its resting sibling.
 *
 * `backdropChain` is returned as raw strings and composited in Node, so the
 * page and the probe cannot disagree about what a color means: a translucent
 * fill has to be resolved against the row's own backplate, because `active` is a
 * 60% wash and the pixel under it is whatever the row rests on.
 */
function measureCue(
  page: Page,
  target: string | CuePick,
  sibling: string | CuePick
): Promise<{ target: CueNode; sibling: CueNode }> {
  return page.evaluate(
    ({ targetSelector, targetIndex, siblingSelector, siblingIndex }) => {
      const read = (selector: string, index: number) => {
        const el = document.querySelectorAll(selector)[index] as HTMLElement | undefined;
        if (!el) {
          return { found: false, background: null, boxShadow: null, backdropChain: [] };
        }
        const style = getComputedStyle(el);
        // Every ancestor's own background, nearest first. Alpha is resolved in
        // Node, so the page never has to decide what "transparent" looks like in
        // each of the four notations `getComputedStyle` can return.
        const backdropChain: string[] = [];
        for (let p = el.parentElement, i = 0; p && i < 12; p = p.parentElement, i++) {
          backdropChain.push(getComputedStyle(p).backgroundColor);
        }
        return {
          found: true,
          background: style.backgroundColor,
          boxShadow: style.boxShadow,
          backdropChain,
        };
      };
      return {
        target: read(targetSelector, targetIndex),
        sibling: read(siblingSelector, siblingIndex),
      };
    },
    {
      targetSelector: normalizePick(target).selector,
      targetIndex: normalizePick(target).index ?? 0,
      siblingSelector: normalizePick(sibling).selector,
      siblingIndex: normalizePick(sibling).index ?? 0,
    }
  );
}

/** Composite a `nearest-first` ancestor chain, outermost layer first. */
function compositeBackdrop(chain: string[], fallback: Rgb): Rgb {
  let out: Rgb = fallback;
  for (const raw of [...chain].reverse()) {
    const parsed = parseColor(raw);
    if (parsed && parsed.alpha > 0) out = over(parsed.rgb, out, parsed.alpha);
  }
  return out;
}

/**
 * One cue case: drive to the surface, turn the state on, and read the pixels.
 *
 * The three facts asserted for every case are the ones a screenshot cannot
 * fake: the cue's own column is painted in the state's ink, the row's dominant
 * pixel is the fill the stylesheet declares, and the same surface shows NEITHER
 * before the state is turned on - plus a resting sibling of the same kind where
 * the case names a different element. A missing surface is reported as a failure
 * rather than thrown, so "the view never appeared" reads as a missing surface.
 */
async function runCue(page: Page, pass: Pass, cue: CueCase): Promise<void> {
  const theme = `${pass.themeMode}-${pass.contrastLevel}`;
  const stateName = 'state' in cue.cue ? cue.cue.state : null;
  // The declared fill comes from the sheet FOR THIS THEME, because the two
  // `standard` palettes deepen their fills (their container is 1.22:1 - the same
  // pixel as a hover) and the medium/high palettes do not.
  const declared = stateName ? declaredFill(stateName, theme) : null;
  if (stateName && !declared) {
    check(
      false,
      `${pass.name} · ${cue.key}: row-surfaces.css no longer declares .row-surface-${stateName} for ${theme}`
    );
    return;
  }
  // A case that names no state is a BORDER cue (the credentials domain's
  // select-all disc): its ink is a token and its window is the border itself.
  const border = stateName ? null : (cue.cue as { token: string; insetPx: number });
  const insetPx = declared ? 2 : (border?.insetPx ?? 2);
  const sameElement = samePick(cue.sibling, cue.target);

  // Seed → reload → hand the view off, in that order (see `seedAndReload`).
  await seedAndOpen(page, cueData(), cue.view);
  try {
    await page.waitForSelector(normalizePick(cue.target).selector, { timeout: 15000 });
  } catch {
    check(
      false,
      `${pass.name} · ${cue.key}: the ${cue.view} surface never appeared (${pickLabel(cue.target)})`
    );
    return;
  }
  await page.waitForTimeout(300);

  // What the surface looked like BEFORE the state is turned on: the same pixels
  // that must change, and the comparison that gives the cue meaning when the
  // case only has one element to look at (the domain disc).
  const before = cue.activate ? await sampleSelector(page, cue.target, pass.rtl, insetPx) : null;

  if (cue.activate) {
    try {
      await clickClear(page, cue.activate);
      await page.waitForTimeout(500);
    } catch (error) {
      check(
        false,
        `${pass.name} · ${cue.key}: the state could not be turned on (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`
      );
      return;
    }
  }

  const tokens = await paintTokens(page);
  const measured = await measureCue(page, cue.target, cue.sibling);
  const rest = await sampleSelector(page, cue.sibling, pass.rtl, insetPx);
  const painted = await sampleSelector(page, cue.target, pass.rtl, insetPx);

  check(
    measured.target.found && measured.sibling.found,
    `${pass.name} · ${cue.key}: a seeded element is missing (target ${measured.target.found}, sibling ${measured.sibling.found})`
  );
  check(painted !== null && rest !== null, `${pass.name} · ${cue.key}: a cue could not be sampled`);
  if (!measured.target.found || !painted || !rest) return;

  const surface = parseColor(tokens['--md-surface']) ?? { rgb: [255, 255, 255] as Rgb, alpha: 1 };
  // The backdrop is the paint the row rests on; a deepened fill is opaque and
  // ignores it, a wash composites over it.
  const backdrop = compositeBackdrop(measured.target.backdropChain, surface.rgb);
  const fillRgb = declared ? resolveDeclaredFill(declared, tokens, backdrop) : null;
  const edge = border ? parseColor(tokens[border.token]) : null;
  if (border) {
    check(edge !== null, `${pass.name} · ${cue.key}: ${border.token} is not a readable token`);
    if (!edge) return;
  }
  if (declared) {
    check(
      fillRgb !== null,
      `${pass.name} · ${cue.key}: the declared fill (${declared.token} at ${declared.share}) does not resolve`
    );
    if (!fillRgb) return;
  }

  // 1. NO STATE IS AN EDGE. The state is its fill, so the inline-start window
  //    itself must be the fill - a bar, a rim or any other second cue would show
  //    up here as a pixel that is not.
  let edgeDelta: number | null = null;
  let edgePixel: Rgb | null = null;
  if (fillRgb) {
    edgePixel = closestPixel(painted.edge, fillRgb);
    edgeDelta = nearestDelta(painted.edge, fillRgb);
    check(
      edgeDelta <= 16,
      `${pass.name} · ${cue.key}: the inline-start edge paints rgb(${edgePixel.join(',')}), not the state's fill rgb(${fillRgb.join(',')}) - a state must be a fill and nothing else`
    );
  } else if (edge) {
    // The one BORDER cue left in the app: the credentials domain disc. Its ink
    // is a 2px border, so the window is where it has to be found - with the
    // reading error a fractional boundary costs (measured in `dark-standard`:
    // rgb(195,230,152) for `--md-primary` rgb(177,209,138)). The ratio guard
    // keeps that wider bound from accepting a pixel that is not the ink at all.
    edgeDelta = nearestDelta(painted.edge, edge.rgb);
    edgePixel = closestPixel(painted.edge, edge.rgb);
    const inkVsFill = channelDelta(edgePixel, painted.dominant);
    check(
      edgeDelta <= 28 && edgeDelta * 3 < inkVsFill,
      `${pass.name} · ${cue.key}: no pixel in the first ${painted.edge.length} of the inline-start edge is ${border?.token} rgb(${edge.rgb.join(',')}) - nearest rgb(${edgePixel.join(',')}) (Δ${edgeDelta} of ${inkVsFill} vs the fill)`
    );
  }
  // 2. ...and the surface showed NONE of it before the state was turned on, nor
  //    does a resting sibling of the same kind - so the cue is the state, not
  //    the element's own shape or a colour it carries anyway.
  const cueInk = fillRgb ?? edge?.rgb ?? null;
  if (before && cueInk) {
    const beforeDelta = nearestDelta(before.edge, cueInk);
    check(
      beforeDelta >= 24,
      `${pass.name} · ${cue.key}: the surface carried the state's fill BEFORE it was applied (nearest rgb(${closestPixel(before.edge, cueInk).join(',')}))`
    );
  }
  if (!sameElement && cueInk) {
    const restDelta = nearestDelta(rest.edge, cueInk);
    check(
      restDelta >= 24,
      `${pass.name} · ${cue.key}: the RESTING sibling is painted with the state's fill (nearest rgb(${closestPixel(rest.edge, cueInk).join(',')}))`
    );
  }

  // 3. The row's dominant pixel is the fill the stylesheet declares for THIS
  //    theme - the deepened mix in the standard palettes, the container in the
  //    medium/high ones.
  let fillDelta: number | null = null;
  let siblingFillDelta: number | null = null;
  let fillVsRow: number | null = null;
  if (fillRgb) {
    fillDelta = channelDelta(painted.dominant, fillRgb);
    check(
      fillDelta <= 10,
      `${pass.name} · ${cue.key}: the row's dominant pixel is rgb(${painted.dominant.join(',')}), not the declared fill rgb(${fillRgb.join(',')})`
    );
    if (!sameElement) {
      siblingFillDelta = channelDelta(rest.dominant, fillRgb);
      check(
        siblingFillDelta >= 8,
        `${pass.name} · ${cue.key}: the RESTING sibling paints the state fill too (rgb(${rest.dominant.join(',')}))`
      );
      // The fill separates from the row it rests on - the number that says the
      // state is visible rather than merely present.
      fillVsRow = contrast(fillRgb, rest.dominant);
      check(
        fillVsRow >= 1.8,
        `${pass.name} · ${cue.key}: the fill is only ${fillVsRow.toFixed(2)}:1 against the resting row rgb(${rest.dominant.join(',')})`
      );
    }
  }

  // 4. The border cue separates from the fill it is drawn on.
  const edgeVsFill = edge && fillRgb ? contrast(edge.rgb, fillRgb) : null;
  if (edgeVsFill !== null) {
    check(
      edgeVsFill >= 3,
      `${pass.name} · ${cue.key}: the cue is only ${edgeVsFill.toFixed(2)}:1 on the fill`
    );
  }
  // ...and no state paints an outward ring, which any clipping ancestor removes.
  if (measured.target.boxShadow && measured.target.boxShadow !== 'none') {
    check(
      parseShadow(measured.target.boxShadow).every((layer) => layer.inset),
      `${pass.name} · ${cue.key}: the state paints an OUTWARD box-shadow (${measured.target.boxShadow})`
    );
  }

  // 5. Hovering the row must not repaint the state (the stylesheet's rule is
  //    unlayered for exactly this reason).
  await page
    .locator(normalizePick(cue.target).selector)
    .nth(normalizePick(cue.target).index ?? 0)
    .hover();
  await page.waitForTimeout(300);
  const hovered = await measureCue(page, cue.target, cue.sibling);
  await page.waitForTimeout(50);
  const hoveredPixels = await sampleSelector(page, cue.target, pass.rtl, insetPx);
  check(
    hovered.target.background === measured.target.background,
    `${pass.name} · ${cue.key}: hover repainted the state (${measured.target.background} -> ${hovered.target.background})`
  );
  if (hoveredPixels) {
    const hoverDelta = channelDelta(hoveredPixels.dominant, painted.dominant);
    check(
      hoverDelta <= 12,
      `${pass.name} · ${cue.key}: hover moved the row's dominant pixel by ${hoverDelta}/255`
    );
  }
  await page.mouse.move(0, 0);

  await page
    .locator(normalizePick(cue.target).selector)
    .nth(normalizePick(cue.target).index ?? 0)
    .screenshot({
      path: join(OUT_DIR, `cue-${pass.name}-${cue.key.replace(/[^a-z0-9]+/gi, '-')}.png`),
    });

  report.push({
    pass: pass.name,
    cue: cue.key,
    view: cue.view,
    theme: await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    dir: pass.rtl ? 'rtl' : 'ltr',
    declared: declared ?? (border ? { border: border.token, insetPx: border.insetPx } : null),
    fillToken: declared ? (tokens[declared.token] ?? null) : null,
    edgeToken: border ? tokens[border.token] : null,
    expectedFill: fillRgb ? `rgb(${fillRgb.join(',')})` : null,
    background: measured.target.background,
    boxShadow: measured.target.boxShadow,
    siblingBackground: measured.sibling.background,
    backdropChain: measured.target.backdropChain, // Painted pixels, not declarations. `cueWindow` is all of them, so a report
    // says where the ink actually was rather than only that it was found.
    cuePixel: edgePixel ? `rgb(${edgePixel.join(',')})` : null,
    cueWindow: painted.edge.map((p) => `rgb(${p.join(',')})`),
    cuePixelDelta: edgeDelta,
    siblingCuePixel: cueInk ? `rgb(${closestPixel(rest.edge, cueInk).join(',')})` : null,
    siblingCueDelta: cueInk ? nearestDelta(rest.edge, cueInk) : null,
    fillVsRow: fillVsRow === null ? null : Number(fillVsRow.toFixed(2)),
    dominantPixel: `rgb(${painted.dominant.join(',')})`,
    fillPixelDelta: fillDelta,
    siblingDominantPixel: `rgb(${rest.dominant.join(',')})`,
    siblingFillDelta,
    hoverDominantPixel: hoveredPixels ? `rgb(${hoveredPixels.dominant.join(',')})` : null,
    edgeVsFill: edgeVsFill === null ? null : Number(edgeVsFill.toFixed(2)),
    box: painted.size,
  });
}

/**
 * A declared fill as an RGB, resolved from the page's own tokens: a wash
 * composites over the backdrop the row rests on, a deepened mix is opaque and
 * mixes the two tokens the sheet names.
 */
function resolveDeclaredFill(
  fill: DeclaredFill,
  tokens: Record<string, string>,
  backdrop: Rgb
): Rgb | null {
  const token = parseColor(tokens[fill.token]);
  if (!token) return null;
  if (fill.share >= 0.999 && fill.mixedWith === 'transparent') return token.rgb;
  if (fill.mixedWith === 'transparent') return over(token.rgb, backdrop, fill.share);
  const second = parseColor(tokens[fill.mixedWith]);
  if (!second) return null;
  return mix(token.rgb, second.rgb, fill.share);
}

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

/**
 * Click a control the way a user does - after bringing it clear of the floating
 * nav pill, which is a `position: fixed` overlay and therefore happily intercepts
 * a pointer aimed at a row that happens to sit underneath it.
 */
async function clickClear(page: Page, target: string | CuePick, nth = 0): Promise<void> {
  const pick = normalizePick(target);
  const locator = page.locator(pick.selector).nth(pick.index ?? nth);
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(120);
  await locator.click({ timeout: 10000 });
}

/**
 * Write storage and reload so the app BOOTS on it.
 *
 * The seed goes in FIRST and any view handoff afterwards (`seedAndOpen`) on
 * purpose: writing both together lets the already-open page's `storage.onChanged`
 * listener consume the `openView` before the reload, and the reload then boots on
 * an empty payload - which is what made the first version of the cue stage report
 * a missing surface in every pass.
 */
async function seedAndReload(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (payload) =>
      new Promise<void>((resolve) => {
        (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set(payload, () =>
          resolve()
        );
      }),
    data
  );
  await page.reload();
  await page.waitForSelector('#app > *', { timeout: 20000 });
  await page.waitForTimeout(800);
}

/**
 * Hand a view to the LIVE page, which its listener applies without a reload -
 * the same path a context-menu “open addresses” takes.
 */
async function handoffView(page: Page, view: string): Promise<void> {
  await page.evaluate(
    (v) =>
      new Promise<void>((resolve) => {
        (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set(
          { openView: v, openViewAt: Date.now() },
          () => resolve()
        );
      }),
    view
  );
}

/** Seed + reload, then hand a view off where the target is not the boot view. */
async function seedAndOpen(
  page: Page,
  data: Record<string, unknown>,
  view?: string
): Promise<void> {
  await seedAndReload(page, data);
  if (view) await handoffView(page, view);
}

/** Wait for a pick to be visible, reporting rather than throwing on a miss. */
async function waitForVisible(
  page: Page,
  target: string | CuePick,
  timeoutMs: number
): Promise<boolean> {
  const pick = normalizePick(target);
  try {
    await page.waitForSelector(pick.selector, { timeout: timeoutMs, state: 'visible' });
  } catch {
    return false;
  }
  return page
    .locator(pick.selector)
    .nth(pick.index ?? 0)
    .isVisible()
    .catch(() => false);
}

/** The element's own computed box-shadow - the layer a ring would live in. */
function boxShadowOf(page: Page, target: string | CuePick): Promise<string> {
  const pick = normalizePick(target);
  return page.evaluate(
    ({ selector, index }) => {
      const el = document.querySelectorAll(selector)[index] as HTMLElement | undefined;
      return el ? getComputedStyle(el).boxShadow : '';
    },
    { selector: pick.selector, index: pick.index ?? 0 }
  );
}

/** One pass: seed, tick two adjacent rows, measure. */
async function runPass(page: Page, pass: Pass): Promise<void> {
  await seedAndOpen(page, {
    ...seed(pass.locale),
    themeMode: pass.themeMode,
    contrastLevel: pass.contrastLevel,
  });
  await page.waitForSelector(`#email-button-${ROW_IDS[0]}`, { timeout: 20000 });
  await page.waitForTimeout(700);

  const direction = await page.evaluate(() => document.documentElement.dir);
  check(
    pass.rtl ? direction === 'rtl' : direction === 'ltr',
    `${pass.name}: direction is "${direction}" (expected ${pass.rtl ? 'rtl' : 'ltr'})`
  );

  const before = await measure(page, [ROW_IDS[0]]);
  const tokens = await paintTokens(page);

  // Tick two ADJACENT rows through the avatar button - the same control a user
  // taps - so the run also shows whether two selected rows stay two rows.
  for (const id of [ROW_IDS[0], ROW_IDS[1]]) {
    await clickClear(page, `#email-button-${id} button`);
    await page.waitForTimeout(300);
  }
  const after = await measure(page, [ROW_IDS[0], ROW_IDS[1], ROW_IDS[3]]);
  // Pixels of the resting state: what the row actually puts on screen.
  const pixels = await samplePixels(page, ROW_IDS[0], pass.rtl);
  // Top band, not the whole box: the selection strip covers the last row (see
  // `dominantTopBand`).
  const untouchedFill = await dominantTopBand(page, `#email-button-${ROW_IDS[3]}`);

  // The mailbox row's own avatar, on the mailbox screen: the fourth list surface
  // that has to paint the row tier (the others are measured in runAvatarSizes).
  const mailboxAvatar = await measureBox(page, `#email-button-${ROW_IDS[3]} button[aria-pressed]`);
  check(mailboxAvatar !== null, `${pass.name} · avatar mailbox row: no avatar box was measurable`);
  if (mailboxAvatar) {
    check(
      mailboxAvatar[0] === ROW_AVATAR_PX && mailboxAvatar[1] === ROW_AVATAR_PX,
      `${pass.name} · avatar mailbox row: paints ${mailboxAvatar[0]}×${mailboxAvatar[1]}px, expected ${ROW_AVATAR_PX}×${ROW_AVATAR_PX}px (the "row" tier)`
    );
    report.push({ pass: pass.name, avatar: { surface: 'mailbox row', box: mailboxAvatar } });
  }

  // Hover a selected row: the hover wash must not repaint it.
  await page.locator(`#email-button-${ROW_IDS[0]}`).hover();
  await page.waitForTimeout(300);
  const hovered = await measure(page, [ROW_IDS[0]]);

  await page.screenshot({ path: join(OUT_DIR, `row-selection-${pass.name}.png`) });
  await page
    .locator(`#email-button-${ROW_IDS[0]}`)
    .screenshot({ path: join(OUT_DIR, `row-selection-${pass.name}-row.png`) });

  // The control contract is NOT measured here: it runs in its own loop over all
  // SIX themes (`runControlPass`), because an applied-vs-hovered comparison that
  // only ever sees the two standard themes cannot see the palette-specific
  // failures this family had (`primary-container` on a `primary` fill is 1.54:1
  // in the `-high` themes).

  const surface = parseColor(tokens['--md-surface']);
  const theme = `${pass.themeMode}-${pass.contrastLevel}`;
  const declared = declaredFill('selected', theme);
  const selected = after[0];
  const adjacent = after[1];
  const untouched = after[2];
  const hoveredRow = hovered[0];

  check(
    selected.found && adjacent.found && untouched.found,
    `${pass.name}: a seeded row is missing`
  );
  check(declared !== null, `${pass.name}: row-surfaces.css declares no selected fill for ${theme}`);
  if (!surface || !declared || !selected.found) return;

  // The fill the sheet declares FOR THIS PALETTE: the two `standard` themes
  // deepen it (their container is 1.22:1 - the same pixel as a hover) and the
  // medium/high ones keep the MD3 container.
  const backdrop = compositeBackdrop(selected.backdropChain ?? [], surface.rgb);
  const fillRgb = resolveDeclaredFill(declared, tokens, backdrop);
  const fill = fillRgb
    ? ({ rgb: fillRgb, alpha: 1, raw: `rgb(${fillRgb.join(',')})` } as Color)
    : null;
  check(fill !== null, `${pass.name}: the declared fill (${declared.token}) does not resolve`);
  if (!fill) return;

  // 1. The selected row paints the declared fill; the untouched row does not.
  const painted = parseColor(selected.background);
  check(
    painted !== null && channelDelta(painted.rgb, fill.rgb) <= 2,
    `${pass.name}: selected row background is ${selected.background}, expected rgb(${fill.rgb.join(',')})`
  );
  const stray = parseColor(untouched.background);
  check(
    stray === null || channelDelta(stray.rgb, fill.rgb) > 8,
    `${pass.name}: the UNselected row is painted with the selection fill (${untouched.background})`
  );
  const adjacentPaint = parseColor(adjacent.background);
  check(
    adjacentPaint !== null && channelDelta(adjacentPaint.rgb, fill.rgb) <= 2,
    `${pass.name}: the second ticked row is not painted (${adjacent.background})`
  );

  // 2. NO state is a second shape. The fill IS the state, so the row paints no
  //    bar, no rim, no edge at all - an inset bar and a 1px rim used to sit here,
  //    and the rim drew a line between two ADJACENT ticked rows.
  check(
    !selected.boxShadow ||
      selected.boxShadow === 'none' ||
      selected.boxShadow.startsWith('rgba(0, 0, 0, 0)'),
    `${pass.name}: the selected row paints a shape of its own (${selected.boxShadow}) - the state is the fill`
  );

  // 3. Hover must not repaint the selection.
  check(
    hoveredRow.background === selected.background,
    `${pass.name}: hover repainted the selected row (${selected.background} -> ${hoveredRow.background})`
  );

  // 4. Every readable line clears 4:1 on the fill.
  const inks = selected.ink.map((entry) => {
    const parsed = parseColor(entry.color);
    return {
      ...entry,
      parsed,
      ratio: parsed ? contrast(over(parsed.rgb, fill.rgb, parsed.alpha), fill.rgb) : null,
    };
  });
  check(selected.ink.length > 0, `${pass.name}: the selected row reported no readable ink`);
  for (const line of inks) {
    check(
      line.parsed !== null,
      `${pass.name}: "${line.text}" reported an unparsable color (${line.color})`
    );
    check(
      (line.ratio ?? 0) >= 4,
      `${pass.name}: "${line.text}" is ${line.ratio?.toFixed(2) ?? 'unparsable'}:1 on the fill (${line.color})`
    );
  }
  const beforeColors = before[0].ink.map((i) => i.color);
  check(
    beforeColors.some((c) => !inks.some((i) => i.color === c)),
    `${pass.name}: no ink changed when the row was ticked - the row looks untouched`
  );

  // 5. The PIXELS: the fill reaches the inline-start edge (there is no bar to
  //    find there) and the row's body is the fill - a computed style can be
  //    right while the screen is not.
  check(pixels !== null, `${pass.name}: could not read the selected row's pixels`);
  if (pixels) {
    check(
      channelDelta(pixels.bar, fill.rgb) <= 16,
      `${pass.name}: the inline-start column paints rgb(${pixels.bar.join(',')}), not the fill rgb(${fill.rgb.join(',')}) - a state is a fill and nothing else`
    );
    check(
      channelDelta(pixels.dominant, fill.rgb) <= 8,
      `${pass.name}: the row's dominant pixel is rgb(${pixels.dominant.join(',')}), not the fill rgb(${fill.rgb.join(',')})`
    );

    // ...and the fill separates from the row it rests on: the number that says
    // the state is visible rather than merely present.
    const restFill = untouchedFill;
    if (restFill) {
      check(
        contrast(fill.rgb, restFill) >= 1.8,
        `${pass.name}: the ticked fill is only ${contrast(fill.rgb, restFill).toFixed(2)}:1 against the resting row rgb(${restFill.join(',')})`
      );
    }
  }
  if (untouchedFill) {
    check(
      channelDelta(untouchedFill, fill.rgb) > 12,
      `${pass.name}: the UNselected row is painted with the fill (rgb(${untouchedFill.join(',')}))`
    );
  }

  report.push({
    pass: pass.name,
    theme: await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    dir: direction,
    declaredFill: declared,
    fill: rgbKey(fill),
    rowBackground: selected.background,
    adjacentSelectedRowBackground: adjacent.background,
    unselectedBackground: untouched.background,
    boxShadow: selected.boxShadow,
    hoverBackground: hoveredRow.background,
    clippedBy: selected.clip,
    fillVsRow: Number(contrast(fill.rgb, untouchedFill ?? surface.rgb).toFixed(2)),
    // Painted pixels, not declarations.
    inlineStartPixel: pixels ? `rgb(${pixels.bar.join(',')})` : null,
    dominantPixel: pixels ? `rgb(${pixels.dominant.join(',')})` : null,
    unselectedDominantPixel: untouchedFill ? `rgb(${untouchedFill.join(',')})` : null,
    ink: inks.map((i) => ({
      text: i.text,
      color: i.color,
      parsed: i.parsed ? i.parsed.rgb : null,
      ratio: i.ratio === null ? null : Number(i.ratio.toFixed(2)),
    })),
  });
}

/**
 * Close any flyout left open by the previous case (or restored from storage).
 *
 * A toolbar flyout puts a full-screen `button.fixed.inset-0` backdrop over the
 * screen, and Playwright then (correctly) refuses to click through it - which is
 * how the first version of this stage timed out on the toolbar's own filter
 * toggle, with the backdrop reported as "intercepts pointer events".
 *
 * The backdrop's only job is to close the flyout, so clicking it cannot activate
 * anything else; this is best-effort cleanup, and each step is allowed to find
 * nothing to do (a flyout that is already closed).
 */
async function closeFlyouts(page: Page): Promise<void> {
  // NOT Escape. In this app Escape is a VIEW gesture - it leaves the addresses
  // view for the mailbox - so the first version of this stage pressed it and then
  // measured a screen it had just navigated away from (reported as "the control
  // never appeared", for the addresses chips and tabs alike).
  for (let guard = 0; guard < 4; guard++) {
    if ((await page.locator('[role="menu"]:visible').count()) === 0) break;
    const backdrop = page.locator('button.fixed.inset-0:visible').first();
    if ((await backdrop.count()) === 0) break;
    // Dispatch the app's OWN dismiss handler (`filterMenuOpen = false`). A
    // synthetic click anywhere on a full-screen backdrop is hit-tested against
    // the flyout that sits above it, so Playwright (correctly) refuses it and the
    // menu stays open - which is how this stage first timed out on the toolbar's
    // own filter toggle, with its backdrop reported as intercepting the click.
    await backdrop.dispatchEvent('click');
    await page.waitForTimeout(200);
  }
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
}

/**
 * One control, three states, read out of the pixels of the SAME element.
 *
 * The facts asserted are the contract's own (`tests/unit/utils/row-surface.test.ts`
 * proves them from the stylesheet in six themes; this proves them on the screen):
 *
 *  1. applied IS the accent role - the dominant pixel equals `--md-primary`;
 *  2. the idle hover is a WHISPER over the control's own resting pixel (≤26/255),
 *     never a replacement for it - which is what stops "hovering an unapplied
 *     control" from reading as applied;
 *  3. applied moves the control at least 4× as far from its resting pixel as the
 *     hover does, and applied-vs-hovered measures ≥4:1 - the margin, in pixels;
 *  4. no state cue is an OUTWARD ring: a non-`inset` box-shadow is painted
 *     outside the border box and any clipping ancestor removes it.
 */
async function runControl(page: Page, pass: Pass, control: ControlCase): Promise<void> {
  const pick = normalizePick(control.control);
  const locator = page.locator(pick.selector).nth(pick.index ?? 0);

  // Start from a clear screen: a menu the previous case opened (or storage
  // restored) would otherwise cover the control under a full-screen backdrop.
  await closeFlyouts(page);

  if (control.setup) {
    await clickClear(page, control.setup);
    await page.waitForTimeout(400);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
  }
  // The control may live in a panel that only a focus opens - and that the very
  // click which applies the control closes again. Reveal it before every read.
  await revealControl(page, control);
  if (!(await waitForVisible(page, control.control, 8000))) {
    check(
      false,
      `${pass.name} · control ${control.key}: the control never appeared (${pickLabel(pick)})`
    );
    return;
  }

  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  const resting = await dominantColor(page, control.control);
  await revealControl(page, control);
  await locator.hover();
  await page.waitForTimeout(250);
  const hovered = await dominantColor(page, control.control);
  await clickClear(page, control.control);
  // Long enough for the click's own `transition-colors` to settle, then reveal
  // again: on a transient panel the element a 350ms read would find is `null`.
  await page.waitForTimeout(350);
  await revealControl(page, control);
  const applied = await dominantColor(page, control.control);
  const shadow = await boxShadowOf(page, control.control);
  const primary = parseColor((await paintTokens(page))['--md-primary']);

  check(
    resting !== null && hovered !== null && applied !== null,
    `${pass.name} · control ${control.key} [${control.kind}]: a state pixel could not be read (resting ${resting ? 'ok' : 'missing'}, hovered ${hovered ? 'ok' : 'missing'}, applied ${applied ? 'ok' : 'missing'})`
  );
  check(primary !== null, `${pass.name} · control ${control.key}: --md-primary is not parseable`);
  if (!resting || !hovered || !applied || !primary) return;

  await locator.screenshot({
    path: join(OUT_DIR, `control-${pass.name}-${control.kind.replace(/ /g, '-')}.png`),
  });

  // 1. Applied is the accent role - the contract's fill reached the control,
  //    unlayered, over whatever utility the view also writes.
  const appliedDelta = channelDelta(applied, primary.rgb);
  check(
    appliedDelta <= 2,
    `${pass.name} · control ${control.key} [${control.kind}]: applied paints [${applied.join(',')}], expected --md-primary [${primary.rgb.join(',')}]`
  );
  // 2. The idle hover is a whisper over the control's own resting pixel.
  const whisper = channelDelta(hovered, resting);
  check(
    whisper <= 26,
    `${pass.name} · control ${control.key} [${control.kind}]: the idle hover moved the control by ${whisper}/255 (expected a whisper, ≤26)`
  );
  // 3. ...and applied dominates it - both as a multiple of the hover's own move
  //    and as a contrast ratio, which is what "hovering an unapplied control
  //    cannot read as applied" means in pixels.
  const appliedHeights = channelDelta(applied, resting);
  check(
    whisper === 0 || appliedHeights >= 4 * whisper,
    `${pass.name} · control ${control.key} [${control.kind}]: applied moves ${appliedHeights}/255 from resting, only ${whisper === 0 ? '∞' : (appliedHeights / whisper).toFixed(1)}× the hover's ${whisper}/255 (expected ≥4×)`
  );
  const appliedVsHover = contrast(applied, hovered);
  check(
    appliedVsHover >= 4,
    `${pass.name} · control ${control.key} [${control.kind}]: applied vs hovered is only ${appliedVsHover.toFixed(2)}:1 (expected ≥4:1)`
  );
  // 4. The structural rule this family also satisfied: no OUTWARD ring.
  check(
    shadow === 'none' || shadow === '' || shadow.includes('inset'),
    `${pass.name} · control ${control.key} [${control.kind}]: the state cue includes an OUTWARD box-shadow (${shadow}) - any clipping ancestor removes it`
  );

  // Put the control back where the next case in this view expects to find it (an
  // applied `is:otp` chip would empty the row list under the select-all chip).
  if (control.reset) {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
    await clickClear(page, control.reset);
    await page.waitForTimeout(300);
  }

  report.push({
    pass: pass.name,
    control: {
      key: control.key,
      kind: control.kind,
      resting,
      hovered,
      applied,
      primary: primary.rgb,
      whisperDelta: whisper,
      appliedHeights,
      appliedVsHover: Number(appliedVsHover.toFixed(2)),
      boxShadow: shadow,
    },
  });
}

/**
 * Re-open the transient panel a control lives in, and let the transition settle.
 *
 * A no-op for every control that is simply on the screen; the reason it exists at
 * all is the mailbox filter row, which unmounts 200ms after the search field
 * loses focus - i.e. immediately after the click that applies one of its chips.
 */
async function revealControl(page: Page, control: ControlCase): Promise<void> {
  if (!control.reveal) return;
  await clickClear(page, control.reveal);
  await page.waitForTimeout(500);
}

/**
 * One control pass: seed the row data once, then walk the four screens and
 * measure every control surface on each - so a single pass covers the chips, the
 * toggles and the segmented strip in ONE theme.
 */
async function runControlPass(page: Page, pass: Pass): Promise<void> {
  progress(`control pass ${pass.name}`);
  await seedAndReload(page, {
    // `seed` contributes the mailbox rows (the select-all chip needs a ticked
    // row); `cueData` the addresses, identities and saved logins the other three
    // screens are built from.
    ...seed(pass.locale),
    ...cueData(),
    // The language is seeded per pass too: `preferredLanguage` wins over `locale`
    // on boot, so leaving it to whatever the previous pass wrote would run the
    // Arabic RTL layout while the pass calls itself `light-standard`.
    preferredLanguage: pass.locale,
    language: pass.locale,
    locale: pass.locale,
    themeMode: pass.themeMode,
    contrastLevel: pass.contrastLevel,
  });
  check(
    await isThemeApplied(page, pass),
    `${pass.name}: the app did not apply ${pass.name} (data-theme is "${await themeAttribute(page)}")`
  );

  for (const group of CONTROL_VIEWS) {
    if (group.view !== 'inbox') {
      await handoffView(page, group.view);
      await page.waitForTimeout(800);
    }
    for (const control of group.cases) {
      progress(`${pass.name} · control ${control.key}`);
      await runControl(page, pass, control);
    }
  }
}

/** The `data-theme` the app is actually painting with. */
function themeAttribute(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? '');
}

/** Whether the app applied the pass's own theme (and not the OS default). */
async function isThemeApplied(page: Page, pass: Pass): Promise<boolean> {
  return (await themeAttribute(page)) === `${pass.themeMode}-${pass.contrastLevel}`;
}

/** The Settings language picker: its trigger, and the listbox it opens. */
const LANGUAGE_TRIGGER = '#setting-language button[aria-expanded]';
const LANGUAGE_MENU = '[role="listbox"]';
/** The view shell (which must not be a stacking context) and the chrome it must beat. */
const VIEW_SHELL = '.view-crossfade';
/**
 * The island's own box and interactive chrome. The pill is measured rather than
 * `.bottom-floating-layer-wrapper`: the wrapper's only children are absolutely
 * positioned, so its own rect has zero height and a band computed from it is
 * meaningless (that is how the first version of this stage "measured" nothing).
 */
const NAV_ISLAND = '.floating-nav';
/**
 * The element that CARRIES the chrome layer. It is the wrapper, not the pill:
 * the wrapper is what declares `PORTAL_Z_CLASS.chrome`, and it is `position:
 * absolute` with only absolutely-positioned children, so its own rect is 0 tall
 * (measuring the band from it proved nothing). Geometry comes from the pill.
 */
const NAV_ISLAND_LAYER = '.bottom-floating-layer-wrapper';
const NAV_ISLAND_CHROME = '.floating-nav, .bottom-nav-container, .fab-btn, .more-menu-nav';

/**
 * The chrome stage: an anchored menu must paint ABOVE the floating nav island.
 *
 * No stylesheet can make this measurement. The language selector carried
 * `PORTAL_Z.menu` (50) and the island carries `PORTAL_Z.chrome` (30) - the menu's
 * number was never the problem. `.view-crossfade`, the wrapper around every
 * view, kept a `transform` from its entry animation (`animation: … both`), which
 * made it a permanent STACKING CONTEXT; the island is a SIBLING of that shell,
 * so no z-index inside it could ever paint above the navbar and the language
 * selector appeared behind it. That is why this stage reads the DOM and the
 * pixels together:
 *
 *   1. the shell's own computed transform is `none` - no jail above the views;
 *   2. the live elements carry the scale's own numbers (`chrome` / `menu`),
 *      so the classes on them are the layer the scale declares;
 *   3. `elementFromPoint` across the band where the two OVERLAP never resolves
 *      to the island's interactive chrome - the pointer, not the declaration;
 *   4. the pixels in that band are the menu's own `--md-surface`, i.e. the menu
 *      is what is PAINTED there and not the island's glass over it;
 *   5. the menu's own box is INSIDE the viewport (nothing clips it) and its last
 *      item is reachable - the menu scrolls to its own end and the last language
 *      is then on screen and hit-testable, which is what "the tail was cut off"
 *      used to break: the scroll container clipped the box itself, so no amount
 *      of scrolling reached the last languages.
 *
 * Both the island and the menu are read as they are on the real popup shell: the
 * app frame is a fixed 360×600 and the portaled menu overhangs it, which is what
 * puts the two in the same band.
 */
async function runChromeMenu(page: Page, pass: Pass): Promise<void> {
  progress(`chrome menu ${pass.name}`);
  await seedAndOpen(
    page,
    { ...seed(pass.locale), themeMode: pass.themeMode, contrastLevel: pass.contrastLevel },
    'settings'
  );

  const triggerVisible = await waitForVisible(page, LANGUAGE_TRIGGER, 20000);
  check(triggerVisible, `${pass.name} · chrome: the Settings language control never appeared`);
  if (!triggerVisible) return;

  // Wait for the shell's ENTRY animation to settle first: during it the element
  // is transformed on purpose. The bug is the transform that REMAINS afterwards.
  await page
    .waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return el ? el.getAnimations().every((a) => a.playState !== 'running') : false;
      },
      VIEW_SHELL,
      { timeout: 5000 }
    )
    .catch(() => {});
  const shellTransform = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).transform : null;
  }, VIEW_SHELL);
  check(
    shellTransform === 'none',
    `${pass.name} · chrome: the view shell still computes transform "${shellTransform}" after its ` +
      `entry animation finished - a stacking context above every view jails in-view menus below the nav island`
  );

  await clickClear(page, LANGUAGE_TRIGGER);
  const menuVisible = await waitForVisible(page, LANGUAGE_MENU, 8000);
  check(menuVisible, `${pass.name} · chrome: the language listbox never opened`);
  if (!menuVisible) return;
  await page.waitForTimeout(300);

  const live = await page.evaluate(
    ({ menuSelector, islandSelector, islandLayerSelector, chromeSelector }) => {
      const menu = document.querySelector(menuSelector) as HTMLElement | null;
      const island = document.querySelector(islandSelector) as HTMLElement | null;
      const islandLayer = document.querySelector(islandLayerSelector) as HTMLElement | null;
      if (!menu || !island || !islandLayer) return null;
      const m = menu.getBoundingClientRect();
      const i = island.getBoundingClientRect();
      const top = Math.max(m.top, i.top);
      const bottom = Math.min(m.bottom, i.bottom);
      const band = { top, bottom, height: bottom - top };
      const y = (top + bottom) / 2;
      // Sample the whole width of the island's own rect at the band's middle: if
      // the island paints above the menu, these points land on nav buttons.
      let onIslandChrome = 0;
      let onMenu = 0;
      let samples = 0;
      if (band.height > 0) {
        for (let step = 0; step <= 12; step += 1) {
          const x = i.left + ((i.width - 1) * step) / 12;
          if (x < m.left || x > m.right) continue;
          samples += 1;
          const hit = document.elementFromPoint(x, y);
          if (hit?.closest(menuSelector)) onMenu += 1;
          if (hit?.closest(chromeSelector)) onIslandChrome += 1;
        }
      }
      const items = [...menu.querySelectorAll('button')];
      const last = items[items.length - 1];
      // Reachability, not luck: scroll the menu to its own end, THEN read the
      // last item. A menu whose box is clipped by an ancestor cannot reach it.
      menu.scrollTop = menu.scrollHeight;
      const lastRect = last?.getBoundingClientRect();
      const lastHit = lastRect
        ? document.elementFromPoint(
            Math.min(Math.max(lastRect.left + lastRect.width / 2, 0), innerWidth - 1),
            Math.min(Math.max(lastRect.top + lastRect.height / 2, 0), innerHeight - 1)
          )
        : null;
      return {
        menuInViewport:
          m.top >= -1 && m.left >= -1 && m.bottom <= innerHeight + 1 && m.right <= innerWidth + 1,
        menuScrolls: menu.scrollHeight > menu.clientHeight,
        menuZ: Number(getComputedStyle(menu).zIndex),
        islandZ: Number(getComputedStyle(islandLayer).zIndex),
        menuBox: [
          Math.round(m.left),
          Math.round(m.top),
          Math.round(m.width),
          Math.round(m.height),
        ] as [number, number, number, number],
        islandTop: Math.round(i.top),
        bandHeight: Math.round(band.height),
        samples,
        onMenu,
        onIslandChrome,
        items: items.length,
        lastItemLabel: (last?.textContent ?? '').trim().slice(0, 40),
        lastItemOnScreen: lastRect
          ? lastRect.bottom <= innerHeight + 1 && lastRect.top >= -1
          : false,
        lastItemHit: lastRect ? Boolean(lastHit?.closest(menuSelector)) : false,
        viewport: [innerWidth, innerHeight] as [number, number],
      };
    },
    {
      menuSelector: LANGUAGE_MENU,
      islandSelector: NAV_ISLAND,
      islandLayerSelector: NAV_ISLAND_LAYER,
      chromeSelector: NAV_ISLAND_CHROME,
    }
  );

  if (!live) {
    check(false, `${pass.name} · chrome: no menu/island pair to measure on this screen`);
    return;
  }

  // The scale, read off the live elements: the classes landed as the layers.
  check(
    live.islandZ === PORTAL_Z.chrome,
    `${pass.name} · chrome: the nav island computes z-index ${live.islandZ}, not PORTAL_Z.chrome (${PORTAL_Z.chrome})`
  );
  check(
    live.menuZ === PORTAL_Z.menu,
    `${pass.name} · chrome: the language menu computes z-index ${live.menuZ}, not PORTAL_Z.menu (${PORTAL_Z.menu})`
  );

  // The band the bug lived in: the menu's list over the island's own rect.
  check(
    live.bandHeight > 0 && live.samples > 0,
    `${pass.name} · chrome: the menu and the island never overlap (band ${live.bandHeight}px), so this pass proves nothing - the viewport is ${live.viewport.join('×')}`
  );
  check(
    live.samples === 0 || live.onIslandChrome === 0,
    `${pass.name} · chrome: ${live.onIslandChrome}/${live.samples} points across the overlap band resolve to the nav island's chrome - the menu is painted BEHIND the navbar`
  );
  check(
    live.onMenu > 0,
    `${pass.name} · chrome: no point in the overlap band resolves inside the menu`
  );

  // The strict read: what is PAINTED in the band. The island's glass is a 32%
  // wash of `surface-container-high` over whatever is behind it, so if the menu
  // were behind it the band's mode would be that blend, never the pure surface.
  const band = await dominantInClip(page, {
    x: Math.max(0, live.menuBox[0]),
    y: Math.max(0, live.islandTop),
    width: Math.max(1, live.menuBox[2]),
    height: Math.max(1, live.bandHeight),
  });
  const tokens = await paintTokens(page);
  const surface = parseColor(tokens['--md-surface'])?.rgb ?? null;
  check(
    band !== null && surface !== null,
    `${pass.name} · chrome: the overlap band could not be read`
  );
  if (band && surface) {
    const delta = Math.max(...band.map((v, i) => Math.abs(v - surface[i])));
    check(
      delta <= 6,
      `${pass.name} · chrome: the overlap band's dominant pixel is ${band.join(',')}, but the menu paints --md-surface ${surface.join(',')} - the island's glass is over the menu (Δ${delta})`
    );
    report.push({
      stage: 'chrome-menu',
      pass: pass.name,
      menuZ: live.menuZ,
      islandZ: live.islandZ,
      bandHeight: live.bandHeight,
      onMenu: live.onMenu,
      onIslandChrome: live.onIslandChrome,
      bandPixel: band.join(','),
      surface: surface.join(','),
      delta,
      shellTransform,
    });
  }

  check(
    live.menuInViewport,
    `${pass.name} · chrome: the menu's own box (${live.menuBox.join(',')}) is not inside the ${live.viewport.join('×')} viewport - an ancestor is still clipping it`
  );
  check(
    live.lastItemOnScreen && live.lastItemHit,
    `${pass.name} · chrome: the menu's last item ("${live.lastItemLabel}") is ${live.lastItemOnScreen ? 'on screen but not hit-testable' : 'unreachable even with the menu scrolled to its end'}${live.menuScrolls ? '' : ' (the menu does not scroll either)'}`
  );

  await page.screenshot({
    path: join(OUT_DIR, `z-layers-${pass.name}-language-menu.png`),
    clip: { x: 0, y: 0, width: live.viewport[0], height: live.viewport[1] },
  });
  // Leave the app the way the next pass expects to find it: menu closed, so no
  // stage inherits an open overlay it did not open itself.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const executablePath = chromiumExecutable();
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    ...(executablePath ? { executablePath } : {}),
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = background.url().split('/')[2];

  const page = await context.newPage();
  await page.setViewportSize(POPUP_VIEWPORT);
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForSelector('#app > *', { timeout: 20000 });

  try {
    for (const pass of PASSES) {
      progress(`row pass ${pass.name}`);
      await runPass(page, pass);
      // Then the rest of the app's row surfaces, on the same screen and in the
      // same theme: one live pass per surface, read out of the pixels.
      for (const cue of CUE_CASES) await runCue(page, pass, cue);
      // Then the avatar ladder: one row, four screens, one size.
      await runAvatarSizes(page, pass);
      // Then the chrome stage: an in-view menu paints above the nav island.
      await runChromeMenu(page, pass);
    }

    // Then the control contract - filter chips, filter/view toggles and the
    // segmented tab - in all SIX themes (plus RTL), each measured in pixels.
    for (const pass of CONTROL_PASSES) await runControlPass(page, pass);
  } finally {
    writeFileSync(join(OUT_DIR, 'row-selection-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await context.close();
  }

  if (failures.length > 0) {
    console.error('\nFAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    "\nOK - selected rows are painted, unclipped and legible in every pass, every cue on the addresses, identities, credentials and automation surfaces paints in the pixels, every list row's avatar measures the same size on all four screens, every applied control - filter chips, toggles and segments - paints the accent role and beats its own hover in all six themes (plus RTL), and an anchored menu paints above the floating nav island in every pass."
  );
}

void main();
