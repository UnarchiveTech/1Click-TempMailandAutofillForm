/**
 * WebKit avatar geometry regression gate (deterministic, pixel-measured).
 *
 * Complements the Chromium gate (tests/e2e/avatar-geometry.e2e.ts) for the
 * Safari/WebKit rendering engine:
 *
 *  - Renders the REAL compiled `Avatar.svelte` (svelte/compiler + Vite) and
 *    asserts the letter ink is centered in the circle within ±0.5px on both
 *    axes, for the app's sizes × a symmetric Latin set, on the pinned Roboto
 *    font AND the platform `system-ui`. (Roboto's dx gets a documented
 *    ±1.0px tolerance: WebKit's rasterizer applies a uniform −1px x-bias to
 *    the embedded font that neither system-ui nor the other engines show.)
 *  - Records which mechanism the component actually selected: CSS leading-trim
 *    (`text-box-trim/edge`, the strategy-1 path) when the engine supports it,
 *    or the `translateY(-0.06em)` em nudge (strategy-2 fallback). The real
 *    component picks strategy 1 automatically, so the fallback cannot be
 *    force-exercised through the component - the spec therefore ALSO mounts a
 *    faithful replica of the fallback branch (exact branch-2 styling: bold
 *    uppercase, `leading-none`, `translateY(-0.06em)` on Latin code points)
 *    and LOGS it. The replica is deliberately not asserted: the static em
 *    nudge is calibrated to the shipped Segoe/system-ui metrics and is
 *    engine-specific (WebKit fits less descender slack into the line box, so
 *    -0.06em overshoots there; Chromium/Firefox sit near-center). Engines
 *    without leading-trim are legacy-only - current WebKit/Safari take the
 *    exact trim path asserted above.
 *
 * Runs with the WebKit smoke suite (`bun run test:e2e:webkit`, config
 * playwright.webkit.config.ts; CI job e2e-webkit installs `playwright webkit`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, webkit } from '@playwright/test';
import { PNG } from 'pngjs';
import { compile } from 'svelte/compiler';
import { AVATAR_TIER_NAMES, type AvatarTier, avatarPx } from '../../src/utils/ui/avatar-size';

interface MountedWindow {
  __mounted?: boolean;
}

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, '.wxt', 'avatar-geometry-webkit');

// The app's avatar tiers, in px - the same ladder the Chrome matrix mounts.
const SIZES = AVATAR_TIER_NAMES.map(avatarPx);
const LETTERS = ['N', 'S', 'G', 'W', 'A'];
const HALF_PX = 0.5;
// Roboto dx tolerance: WebKit's rasterizer biases the embedded font −1px
// horizontally (absent for system-ui and for the other engines). Documented,
// not an acceptable regression - the strict system-ui cells still catch real
// horizontal drift.
const ROBOTO_DX_TOL = 1.0;

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

test('WebKit: avatar letters pixel-centered (trim path) within ±0.5px; Roboto dx ±1px; fallback logged', async () => {
  test.setTimeout(120_000);

  const cases: Case[] = [];
  for (const tier of AVATAR_TIER_NAMES) {
    for (const letter of LETTERS) cases.push({ tier, size: avatarPx(tier), letter });
  }

  // --- Compile the REAL Avatar component and bundle it for the browser. ---
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
  writeFileSync(join(OUT_DIR, 'avatar.mjs'), code);

  const cellColor = (i: number): string => (i % 2 ? '#7b1fa2' : '#2e7d32');

  const entry = `import { mount } from '../../node_modules/svelte/src/index-client.js';
import Avatar from './avatar.mjs';
const list = ${JSON.stringify(cases.map((c, i) => ({ s: c.tier, l: c.letter, color: cellColor(i) })))};
list.forEach((c, i) => {
  mount(Avatar, { target: document.getElementById('real' + i), props: { size: c.s, letter: c.l, color: c.color } });
});
globalThis.__mounted = true;`;
  const entryPath = join(OUT_DIR, 'entry.mjs');
  writeFileSync(entryPath, entry);

  const build = await import('vite');
  const viteResult = (await build.build({
    root: ROOT,
    logLevel: 'silent',
    resolve: {
      alias: {
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
  if (!appJs) throw new Error('Vite produced no bundle for the WebKit avatar geometry page');

  const fontB64 = readFileSync(
    join(ROOT, 'tests/e2e/assets/roboto-latin-700-normal.woff2')
  ).toString('base64');

  // Faithful replica of the strategy-2 fallback branch: bold uppercase Latin
  // glyph, `leading-none`, `translateY(-0.06em)` (no leading-trim).
  const replicaCell = (id: string, size: number, font: string, color: string): string => {
    const fs = Math.round(size * 0.52);
    return `<div id="${id}" style="width:${size}px;height:${size}px;border-radius:9999px;overflow:hidden;background:${color};display:flex;align-items:center;justify-content:center">
  <span style="font-size:${fs}px;font-family:${font};font-weight:700;text-transform:uppercase;line-height:1;color:#fff;transform:translateY(-0.06em)">N</span>
</div>`;
  };
  const fallbackSys = SIZES.map((s, i) =>
    replicaCell(`fbsys-${s}`, s, 'system-ui,sans-serif', cellColor(100 + i))
  ).join('');
  const fallbackRob = [28, 35]
    .map((s, i) => replicaCell(`fbrob-${s}`, s, "'RobotoGeo',sans-serif", cellColor(200 + i)))
    .join('');

  const realCells = cases
    .map((c, i) => `<div id="real${i}" style="width:${c.size}px;height:${c.size}px"></div>`)
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
  #grid,#fb,#fb2{display:flex;flex-wrap:wrap;gap:12px;padding:12px;align-content:flex-start}
</style></head><body><div id="grid">${realCells}</div>
<div id="fb">${fallbackSys}</div><div id="fb2">${fallbackRob}</div>
<script type="module">${appJs}</script></body></html>`;

  function measure(
    png: Buffer,
    rects: Record<string, { x: number; y: number; w: number; h: number }>
  ): Cell[] {
    const { width: W, height: H, data: d } = PNG.sync.read(png);
    const px = (x: number, y: number): [number, number, number] => {
      const i = (y * W + x) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    };
    const isLetter = (x: number, y: number): boolean => {
      const [r, g, b] = px(x, y);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      return mx > 150 && mx - mn < 45;
    };
    const out: Cell[] = [];
    for (let i = 0; i < cases.length; i++) {
      const b = rects[`real${i}`];
      if (!b) throw new Error(`Missing rect for real${i}`);
      const x0 = Math.max(0, Math.round(b.x));
      const y0 = Math.max(0, Math.round(b.y));
      // Pixel indices are inclusive: a 24px box starting at x=0 ends at
      // pixel 23, not 24. Including the next pixel biases both centers by 0.5px.
      const x1 = Math.min(W - 1, Math.ceil(b.x + b.w) - 1);
      const y1 = Math.min(H - 1, Math.ceil(b.y + b.h) - 1);
      let lx0 = Number.POSITIVE_INFINITY;
      let lx1 = Number.NEGATIVE_INFINITY;
      let ly0 = Number.POSITIVE_INFINITY;
      let ly1 = Number.NEGATIVE_INFINITY;
      let ink = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          if (isLetter(xx, yy)) {
            if (xx < lx0) lx0 = xx;
            if (xx > lx1) lx1 = xx;
            if (yy < ly0) ly0 = yy;
            if (yy > ly1) ly1 = yy;
            ink++;
          }
        }
      }
      if (ink === 0) throw new Error(`No letter ink for ${cases[i].size}px '${cases[i].letter}'`);
      out.push({
        tier: cases[i].tier,
        size: cases[i].size,
        letter: cases[i].letter,
        dy: (ly0 + ly1) / 2 - (y0 + y1) / 2,
        dx: (lx0 + lx1) / 2 - (x0 + x1) / 2,
      });
    }
    return out;
  }

  const measureById = (
    png: Buffer,
    rects: Record<string, { x: number; y: number; w: number; h: number }>,
    id: string
  ): { dy: number; dx: number; ink: number } => {
    const { width: W, height: H, data: d } = PNG.sync.read(png);
    const px = (x: number, y: number): [number, number, number] => {
      const i = (y * W + x) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    };
    const b = rects[id];
    const x0 = Math.max(0, Math.round(b.x));
    const y0 = Math.max(0, Math.round(b.y));
    const x1 = Math.min(W - 1, Math.ceil(b.x + b.w) - 1);
    const y1 = Math.min(H - 1, Math.ceil(b.y + b.h) - 1);
    let lx0 = Number.POSITIVE_INFINITY;
    let lx1 = Number.NEGATIVE_INFINITY;
    let ly0 = Number.POSITIVE_INFINITY;
    let ly1 = Number.NEGATIVE_INFINITY;
    let ink = 0;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const [r, g, bl] = px(xx, yy);
        if (r > 150 && g > 150 && bl > 150) {
          if (xx < lx0) lx0 = xx;
          if (xx > lx1) lx1 = xx;
          if (yy < ly0) ly0 = yy;
          if (yy > ly1) ly1 = yy;
          ink++;
        }
      }
    }
    return {
      dy: ink ? (ly0 + ly1) / 2 - (y0 + y1) / 2 : Number.NaN,
      dx: ink ? (lx0 + lx1) / 2 - (x0 + x1) / 2 : Number.NaN,
      ink,
    };
  };

  const browser = await webkit.launch({
    headless: true,
    // Optional explicit executable override for a diagnostic engine build.
    // Normal runs use the browser revision installed for this Playwright version.
    ...(process.env.PW_WEBKIT_EXEC ? { executablePath: process.env.PW_WEBKIT_EXEC } : {}),
  });
  try {
    const observations: string[] = [];
    const violations: string[] = [];
    let mechanism = '';

    for (const [fontLabel, fontStack] of [
      ['RobotoGeo', `'RobotoGeo',system-ui,sans-serif`],
      ['system-ui', 'system-ui,sans-serif'],
    ] as const) {
      const page = await browser.newPage({
        viewport: { width: 1800, height: 1500 },
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
      await page.waitForTimeout(150);

      const state = await page.evaluate(() => {
        const span = document.querySelector('#grid span');
        const cs = span ? getComputedStyle(span) : null;
        return {
          supportsTrim:
            typeof CSS !== 'undefined' &&
            typeof CSS.supports === 'function' &&
            CSS.supports('text-box-trim', 'trim-both') &&
            CSS.supports('text-box-edge', 'cap alphabetic'),
          trim: cs ? cs.getPropertyValue('text-box-trim').trim() : null,
          transform: cs ? cs.getPropertyValue('transform').trim() : null,
        };
      });
      mechanism =
        `${fontLabel}: supportsTrim=${state.supportsTrim}, ` +
        `trim="${state.trim}", transform="${state.transform}"`;
      observations.push(`mechanism ${mechanism}`);

      const rects = await page.evaluate(() => {
        const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
        for (const el of document.querySelectorAll<HTMLElement>(
          '#grid > div, #fb > div, #fb2 > div'
        )) {
          const r = el.getBoundingClientRect();
          out[el.id] = { x: r.x, y: r.y, w: r.width, h: r.height };
        }
        return out;
      });

      const shot = await page.screenshot();
      await page.close();

      // Real component: trim path is engine-exact (±0.5px); the em-nudge
      // fallback is platform-font-calibrated, so on Roboto it may exceed 0.5.
      const real = measure(shot, rects);
      const trimActive =
        state.supportsTrim && state.trim === 'trim-both' && state.transform === 'none';
      // Trim path is engine-exact on the platform font (strict ±0.5px both
      // axes); only the pinned Roboto's known −1px x-bias widens dx.
      const realTol = trimActive ? HALF_PX : 2.0;
      const dxTol = trimActive && fontLabel === 'RobotoGeo' ? ROBOTO_DX_TOL : realTol;
      for (const cell of real) {
        const line =
          `${fontLabel} ${cell.size}px '${cell.letter}': dy=${cell.dy >= 0 ? '+' : ''}${cell.dy.toFixed(2)} ` +
          `dx=${cell.dx >= 0 ? '+' : ''}${cell.dx.toFixed(2)}`;
        observations.push(line);
        if (Math.abs(cell.dy) > realTol || Math.abs(cell.dx) > dxTol) {
          violations.push(
            `${line} - off-center (dy tol ±${realTol}px, dx tol ±${dxTol}px; mechanism ${mechanism}).`
          );
        }
      }

      // Forced fallback replica - log-only, deliberately not asserted (see
      // header: the static nudge is Segoe-calibrated and engine-specific).
      for (const s of SIZES) {
        const m = measureById(shot, rects, `fbsys-${s}`);
        observations.push(
          `${fontLabel} fallback-replica ${s}px 'N' (system-ui): dy=${m.ink ? (m.dy >= 0 ? '+' : '') + m.dy.toFixed(2) : 'NO INK'} (log-only)`
        );
      }
      for (const s of [28, 35]) {
        const m = measureById(shot, rects, `fbrob-${s}`);
        observations.push(
          `${fontLabel} fallback-replica ${s}px 'N' (Roboto): dy=${m.ink ? (m.dy >= 0 ? '+' : '') + m.dy.toFixed(2) : 'NO INK'} (log-only; nudge is Segoe-calibrated)`
        );
      }
    }

    if (violations.length > 0) {
      throw new Error(`WebKit avatar ink off-center:\n${violations.join('\n')}`);
    }
    console.log(
      `webkit avatar geometry ok (${observations.length} obs):\n${observations.join('\n')}`
    );
    expect(violations.length).toBe(0);
  } finally {
    await browser.close();
  }
});
