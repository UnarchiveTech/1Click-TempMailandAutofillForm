/**
 * Avatar geometry regression gate (deterministic, pixel-measured).
 *
 * Why this exists: `Avatar.svelte` optically centers its letter with CSS
 * leading-trim (`text-box-trim: trim-both; text-box-edge: cap alphabetic`).
 * A regression there (removing the trim, changing the font-size ratio,
 * switching `line-height`, adding padding, altering flex centering, or
 * re-adding a per-font em nudge) shifts the glyph ink out of the circle by a
 * whole pixel or more - exactly the class of bug that reads as a "slightly
 * misplaced first character" and that DOM-only tests cannot see.
 *
 * Determinism strategy:
 *  - Renders the REAL compiled `Avatar.svelte` (svelte/compiler + Bun.build),
 *    not a hand-copied replica of its markup.
 *  - Pins the glyph metrics with a vendored font (Roboto Bold woff2 in
 *    `tests/e2e/assets/`, Apache-2.0 via @fontsource) so results are identical
 *    on every OS, and also renders with the platform `system-ui` stack.
 *  - Leading-trim normalizes Latin geometry across fonts (measured identical
 *    on Roboto and Segoe), so the ±0.5px bound holds on any engine that
 *    implements it; unsupported engines fall back to the em nudge and are
 *    deliberately not covered here (see the DOM unit tests in
 *    tests/unit/components/primitives/avatar.test.ts).
 *  - deviceScaleFactor 1, headless Chromium, DPR snap dominates measurement
 *    noise; tolerance is half a CSS pixel on both axes.
 *
 * Runs with the rest of the Playwright suite (`.e2e.ts`, `bun run test:e2e`),
 * so every PR's Chrome E2E CI job exercises it. Quick local run:
 *   bun run test:e2e avatar-geometry
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { PNG } from 'pngjs';
import { compile } from 'svelte/compiler';
import { AVATAR_TIER_NAMES, type AvatarTier, avatarPx } from '../../src/utils/ui/avatar-size';

interface MountedWindow {
  __mounted?: boolean;
}

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, '.wxt', 'avatar-geometry-e2e');

// Sizes actually used by the app (MailboxView 28/35, AddressesView 32, etc.).
// The app's avatar tiers, in px - the scale IS the matrix, so a new tier (or a
// change to one) is measured here without a second list to keep in sync.
const SIZES = AVATAR_TIER_NAMES.map(avatarPx);
// Symmetric caps: horizontally their ink bbox is inherently centered, so an
// off-center reading is a layout regression, not glyph side-bearing noise.
const LETTERS = ['N', 'S', 'G', 'W', 'A'];
const HALF_PX = 0.5;

interface Case {
  /** The tier the component is mounted with. */
  tier: AvatarTier;
  /** Its px box - what the pixels are compared against. */
  size: number;
  letter: string;
}

interface Cell extends Case {
  dy: number;
  dx: number;
}

test('avatar letters are pixel-centered in the circle within ±0.5px on both axes', async ({
  playwright,
  browserName,
}) => {
  test.setTimeout(120_000);

  const cases: Case[] = [];
  for (const tier of AVATAR_TIER_NAMES) {
    for (const letter of LETTERS) cases.push({ tier, size: avatarPx(tier), letter });
  }

  // --- Compile the REAL Avatar component and bundle it (mount + svelte
  // runtime + avatar-color) into one self-contained module for the browser.
  mkdirSync(OUT_DIR, { recursive: true });
  const src = readFileSync(join(ROOT, 'src/ui/components/primitives/Avatar.svelte'), 'utf8');
  const { js } = compile(src, { generate: 'client', filename: 'Avatar.svelte', css: 'injected' });
  // Rewrite EVERY '@/<path>.js' specifier to its relative TS source - the
  // compiled component may import any shared utility via the alias (today:
  // avatar-color.js + avatar-initials.js). A single-import rewrite silently
  // broke the fixture when Avatar gained its second '@/utils' import.
  const code = js.code.replace(
    /from\s*["']@\/([^"']+)\.js["']/g,
    (_match, mod: string) => `from ${JSON.stringify(`../../src/${mod}.ts`)}`
  );
  const avatarPath = join(OUT_DIR, 'avatar.mjs');
  writeFileSync(avatarPath, code);

  const cellColor = (i: number): string => (i % 2 ? 'geo-b' : 'geo-g');
  const entry = `import { mount } from '../../node_modules/svelte/src/index-client.js';
import Avatar from './avatar.mjs';
const cases = ${JSON.stringify(cases.map((c, i) => ({ s: c.tier, l: c.letter, color: cellColor(i) })))};
for (const c of cases) {
  mount(Avatar, { target: document.getElementById('c' + cases.indexOf(c)), props: { size: c.s, letter: c.l, color: c.color } });
}
globalThis.__mounted = true;`;
  const entryPath = join(OUT_DIR, 'entry.mjs');
  writeFileSync(entryPath, entry);

  // Bundle with Vite (Playwright workers run under Node, so Bun.build is not
  // available here). Plain-JS entry - the Svelte compiler already emitted JS.
  const build = await import('vite');
  const viteResult = (await build.build({
    root: ROOT,
    logLevel: 'silent',
    resolve: {
      alias: {
        // Compiled Svelte output imports 'svelte/internal/client'; keep the
        // alias explicit so Vite resolves it regardless of exports maps.
        'svelte/internal/client': join(ROOT, 'node_modules/svelte/src/internal/client/index.js'),
      },
    },
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: entryPath,
        output: { format: 'esm', entryFileNames: 'app.js' },
      },
    },
  })) as { output: Array<{ code?: string }> };
  const appJs = viteResult.output.find((o) => o.code)?.code ?? '';
  if (!appJs) throw new Error('Vite produced no bundle for the Avatar geometry page');

  const fontB64 = readFileSync(
    join(ROOT, 'tests/e2e/assets/roboto-latin-700-normal.woff2')
  ).toString('base64');
  const cellsHtml = cases
    .map((c, i) => `<div id="c${i}" data-size="${c.size}" data-letter="${c.letter}"></div>`)
    .join('');

  const pageHtml = (bodyFont: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family:'RobotoGeo'; font-style:normal; font-weight:700;
    src:url(data:font/woff2;base64,${fontB64}) format('woff2'); }
  body { background:#000; margin:0; font-family:${bodyFont}; }
  .flex{display:flex}.items-center{align-items:center}.justify-center{justify-content:center}
  .overflow-hidden{overflow:hidden}.rounded-full{border-radius:9999px}.relative{position:relative}
  .font-bold{font-weight:700}.uppercase{text-transform:uppercase}.leading-none{line-height:1}
  .select-none{user-select:none}.text-white{color:#fff}
  .geo-g{background:#2e7d32}.geo-b{background:#7b1fa2}
  #grid{display:flex;flex-wrap:wrap;gap:12px;padding:12px;align-content:flex-start}
</style></head><body><div id="grid">${cellsHtml}</div>
<script type="module">${appJs}</script></body></html>`;

  function measure(png: Buffer): Cell[] {
    const { width: W, height: H, data: d } = PNG.sync.read(png);
    const px = (x: number, y: number): [number, number, number] => {
      const i = (y * W + x) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    };
    const isColored = (x: number, y: number): boolean => {
      const [r, g, b] = px(x, y);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      return mx - mn > 60 && mx > 60 && mx < 245;
    };
    const isLetter = (x: number, y: number): boolean => {
      const [r, g, b] = px(x, y);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      return mx > 150 && mx - mn < 45;
    };

    // Connected components of the colored avatar discs.
    const seen = new Uint8Array(W * H);
    const discs: Array<{ minX: number; maxX: number; minY: number; maxY: number }> = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (seen[idx] || !isColored(x, y)) continue;
        const stack: Array<[number, number]> = [[x, y]];
        seen[idx] = 1;
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let n = 0;
        while (stack.length) {
          const [cx, cy] = stack.pop() as [number, number];
          n++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              const ni = ny * W + nx;
              if (!seen[ni] && isColored(nx, ny)) {
                seen[ni] = 1;
                stack.push([nx, ny]);
              }
            }
          }
        }
        if (n > 40) discs.push({ minX, maxX, minY, maxY });
      }
    }
    discs.sort((a, b) => a.minY - b.minY || a.minX - b.minX);
    if (discs.length < cases.length) {
      throw new Error(`Expected ${cases.length} avatar discs, measured ${discs.length}`);
    }

    const out: Cell[] = [];
    for (let i = 0; i < cases.length; i++) {
      const disc = discs[i];
      let lx0 = Number.POSITIVE_INFINITY;
      let lx1 = Number.NEGATIVE_INFINITY;
      let ly0 = Number.POSITIVE_INFINITY;
      let ly1 = Number.NEGATIVE_INFINITY;
      let ink = 0;
      for (let yy = disc.minY; yy <= disc.maxY; yy++) {
        for (let xx = disc.minX; xx <= disc.maxX; xx++) {
          if (isLetter(xx, yy)) {
            if (xx < lx0) lx0 = xx;
            if (xx > lx1) lx1 = xx;
            if (yy < ly0) ly0 = yy;
            if (yy > ly1) ly1 = yy;
            ink++;
          }
        }
      }
      if (ink === 0) {
        throw new Error(
          `No letter ink for ${cases[i].size}px '${cases[i].letter}' ` +
            `(disc x${disc.minX}-${disc.maxX} y${disc.minY}-${disc.maxY})`
        );
      }
      const ccx = (disc.minX + disc.maxX) / 2;
      const ccy = (disc.minY + disc.maxY) / 2;
      out.push({
        tier: cases[i].tier,
        size: cases[i].size,
        letter: cases[i].letter,
        dy: (ly0 + ly1) / 2 - ccy,
        dx: (lx0 + lx1) / 2 - ccx,
      });
    }
    return out;
  }

  const browser = await playwright[browserName].launch({
    headless: true,
    // Local env: the lockfile playwright expects chromium-1243, but this
    // machine has chromium-1234 (older build) and the browser CDN is
    // firewalled. Point at the installed build - protocol-stable for adjacent
    // Chromium builds. (Same pattern as the WebKit gate's PW_WEBKIT_EXEC.)
    ...(browserName === 'chromium' && process.env.PW_CHROMIUM_EXEC
      ? { executablePath: process.env.PW_CHROMIUM_EXEC }
      : {}),
  });
  try {
    const observations: string[] = [];
    const violations: string[] = [];

    for (const [fontLabel, fontStack] of [
      ['RobotoGeo', `'RobotoGeo',system-ui,sans-serif`],
      ['system-ui', 'system-ui,sans-serif'],
    ] as const) {
      const page = await browser.newPage({
        viewport: { width: 1800, height: 1400 },
        deviceScaleFactor: 1,
      });
      await page.setContent(pageHtml(fontStack));
      await page.evaluate(
        (sizes: number[]) =>
          document.fonts.ready.then(() =>
            Promise.all(sizes.map((s) => document.fonts.load(`700 ${s}px RobotoGeo`)))
          ),
        SIZES
      );
      await page.waitForFunction(() => (globalThis as MountedWindow).__mounted === true);
      // Let the pinned font swap in and re-layout before rasterizing.
      await page.waitForTimeout(150);

      // Guard the mechanism: this must exercise the production leading-trim
      // path, not the em-nudge fallback.
      const trimState = await page.evaluate(() => {
        const el = document.querySelector('#grid span');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          trim: cs.getPropertyValue('text-box-trim').trim(),
          transform: cs.getPropertyValue('transform').trim(),
        };
      });
      if (trimState === null) {
        throw new Error('No avatar span found to inspect text-box-trim state.');
      }
      const { trim, transform } = trimState;
      if (trim !== 'trim-both' || transform !== 'none') {
        throw new Error(
          `Expected the leading-trim geometry path (text-box-trim=trim-both, transform=none), ` +
            `got trim="${trim}", transform="${transform}"`
        );
      }

      const shot = await page.screenshot();
      await page.close();

      for (const cell of measure(shot)) {
        const line =
          `${fontLabel} ${cell.size}px '${cell.letter}': dy=${cell.dy >= 0 ? '+' : ''}${cell.dy.toFixed(2)} ` +
          `dx=${cell.dx >= 0 ? '+' : ''}${cell.dx.toFixed(2)}`;
        observations.push(line);
        if (Math.abs(cell.dy) > HALF_PX || Math.abs(cell.dx) > HALF_PX) {
          violations.push(
            `${line} - off-center by more than ±${HALF_PX}px. Check Avatar.svelte ` +
              'letter geometry (text-box-trim/edge, font-size ratio, flex centering).'
          );
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Avatar ink off-center by more than ±${HALF_PX}px:\n${violations.join('\n')}`
      );
    }
    console.log(`avatar geometry ok (${observations.length} cells):\n${observations.join('\n')}`);
  } finally {
    await browser.close();
  }
});

test('icon-only buttons center the Icon ink within ±0.5px (flex shell required)', async ({
  playwright,
  browserName,
}) => {
  test.setTimeout(120_000);

  // The row star button in MailboxView.svelte is a plain <button> with p-1
  // padding around a 20px Icon. Without a flex shell the inline SVG sits on
  // the text baseline (button line-height is ~1.4x font-size), pushing the
  // star ~2px low in its 28px box - the same class of optical bug as the
  // avatar letter. The production fix adds `flex items-center justify-center`;
  // this test pins that requirement with the REAL Icon component.
  const outDir = join(ROOT, '.wxt', 'avatar-geometry-e2e', 'icon');
  mkdirSync(outDir, { recursive: true });

  const entry = `import { mount } from 'svelte';
import Icon from '../../../src/ui/components/icons/Icon.svelte';
// The Icon gets its size entirely from its class prop (the app always passes
// w-5 h-5, e.g. <Icon name="star" class="w-5 h-5" />). Without a sizing
// class the SVG has no intrinsic size and paints no visible ink.
mount(Icon, { target: document.getElementById('star-flex'), props: { name: 'star', filled: false, class: 'w-5 h-5' } });
mount(Icon, { target: document.getElementById('star-noflex'), props: { name: 'star', filled: false, class: 'w-5 h-5' } });
globalThis.__mounted = true;`;
  const entryPath = join(outDir, 'entry.mjs');
  writeFileSync(entryPath, entry);

  const build = await import('vite');
  const sveltePlugin = await import('@sveltejs/vite-plugin-svelte');
  const viteConfig = {
    root: ROOT,
    logLevel: 'silent',
    plugins: sveltePlugin.svelte(),
    resolve: {
      alias: {
        '@': join(ROOT, 'src'),
        'svelte/internal/client': join(ROOT, 'node_modules/svelte/src/internal/client/index.js'),
      },
    },
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: entryPath,
        output: { format: 'esm', entryFileNames: 'app.js' },
      },
    },
  };
  // TS 7 exhausts its recursive structural comparison of Vite's PluginHook
  // types here. Keep this test's config inferred locally and bridge only the
  // `build` call; Vite still validates and executes the same config at runtime.
  const buildWithLocalConfig = build.build as unknown as (
    config: typeof viteConfig
  ) => Promise<{ output: Array<{ code?: string }> }>;
  const viteResult = await buildWithLocalConfig(viteConfig);
  const appJs = viteResult.output.find((o) => o.code)?.code ?? '';
  if (!appJs) throw new Error('Vite produced no bundle for the icon-button geometry page');

  const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { background:#000; margin:0; font-family:system-ui,sans-serif; }
  .flex{display:flex}.items-center{align-items:center}.justify-center{justify-content:center}
  .flex-shrink-0{flex-shrink:0}.self-center{align-self:center}.p-1{padding:4px}.rounded{border-radius:4px}
  .w-5{width:20px}.h-5{height:20px}
  #flex-row,#plain-row{display:flex;align-items:center;gap:8px;padding:16px;min-height:60px}
</style></head><body>
  <div id="flex-row"><button id="star-flex" type="button" class="flex flex-shrink-0 self-center items-center justify-center p-1 rounded" style="border:0;background:transparent;color:#fff;cursor:pointer"></button></div>
  <div id="plain-row"><button id="star-noflex" type="button" class="flex-shrink-0 self-center p-1 rounded" style="border:0;background:transparent;color:#fff;cursor:pointer"></button></div>
<script type="module">${appJs}</script></body></html>`;

  const browser = await playwright[browserName].launch({
    headless: true,
    ...(browserName === 'chromium' && process.env.PW_CHROMIUM_EXEC
      ? { executablePath: process.env.PW_CHROMIUM_EXEC }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 400 },
      deviceScaleFactor: 1,
    });
    await page.setContent(pageHtml);
    await page.waitForFunction(() => (globalThis as MountedWindow).__mounted === true);
    await page.waitForTimeout(100);

    const boxes = await page.evaluate(() => {
      const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
      for (const id of ['star-flex', 'star-noflex']) {
        const r = document.getElementById(id)?.getBoundingClientRect();
        if (r) out[id] = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
      return out;
    });
    const shot = await page.screenshot();

    const { width: W, height: H, data: d } = PNG.sync.read(shot);
    const px = (x: number, y: number): [number, number, number] => {
      const i = (y * W + x) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    };
    const measureInk = (b: { x: number; y: number; w: number; h: number }) => {
      const x0 = Math.max(0, Math.round(b.x));
      const y0 = Math.max(0, Math.round(b.y));
      const x1 = Math.min(W - 1, Math.round(b.x + b.w));
      const y1 = Math.min(H - 1, Math.round(b.y + b.h));
      let lx0 = Number.POSITIVE_INFINITY;
      let lx1 = Number.NEGATIVE_INFINITY;
      let ly0 = Number.POSITIVE_INFINITY;
      let ly1 = Number.NEGATIVE_INFINITY;
      let ink = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const [r, g, b] = px(xx, yy);
          if (r > 150 && g > 150 && b > 150) {
            if (xx < lx0) lx0 = xx;
            if (xx > lx1) lx1 = xx;
            if (yy < ly0) ly0 = yy;
            if (yy > ly1) ly1 = yy;
            ink++;
          }
        }
      }
      const ccx = (x0 + x1) / 2;
      const ccy = (y0 + y1) / 2;
      return {
        ink,
        dx: (lx0 + lx1) / 2 - ccx,
        dy: (ly0 + ly1) / 2 - ccy,
      };
    };

    const flex = measureInk(boxes['star-flex']);
    const plain = measureInk(boxes['star-noflex']);
    if (!flex.ink || !plain.ink) {
      throw new Error(`Missing star ink: flex=${flex.ink} plain=${plain.ink}`);
    }
    console.log(
      `star icon: flex dy=${flex.dy >= 0 ? '+' : ''}${flex.dy.toFixed(2)} ` +
        `dx=${flex.dx >= 0 ? '+' : ''}${flex.dx.toFixed(2)} | ` +
        `plain dy=${plain.dy >= 0 ? '+' : ''}${plain.dy.toFixed(2)} (baseline, expected off)`
    );
    if (Math.abs(flex.dy) > HALF_PX || Math.abs(flex.dx) > HALF_PX) {
      throw new Error(
        `Icon in the flex star button is off-center by more than ±${HALF_PX}px ` +
          `(dy=${flex.dy.toFixed(2)}, dx=${flex.dx.toFixed(2)}). Keep the button a flex ` +
          'shell (`flex items-center justify-center`) - without it the inline SVG ' +
          'sits on the text baseline and lands ~2px low.'
      );
    }
    if (Math.abs(plain.dy) <= 1) {
      throw new Error(
        `Baseline-aligned icon button measured dy=${plain.dy.toFixed(2)} - expected the ` +
          'inline SVG to sit noticeably off-center (>1px) inside a non-flex button. ' +
          'If Chromium changed baseline alignment, re-evaluate the flex-shell requirement.'
      );
    }
  } finally {
    await browser.close();
  }
});
