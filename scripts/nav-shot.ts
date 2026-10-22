/**
 * One-off: shoot the REAL floating navbar out of the built extension.
 *
 * The harness page mirrors the pill's CSS, so it can only ever be as honest as
 * that mirror. This drives the shipped build instead - headed Chromium with
 * `.output/chrome-mv3` loaded, demo state seeded, popup opened - and reports
 * what the browser actually painted: every label's own advance vs the box it was
 * given, the glyph ink the clip box cuts off, the fit's inputs (font, padding,
 * reserved end padding, over-budget flag) and the pill/FAB/container widths.
 *
 * Usage: bun scripts/nav-shot.ts [width] [height] [lang]
 *   bun scripts/nav-shot.ts 360 640 de
 *
 * NOTE on `width`: `popup/index.html` pins `<meta name="viewport"
 * content="width=360">`, so the DOCUMENT lays out at 360 no matter what window
 * size is asked for - `docScrollWidth` stays 360 and an element screenshot of the
 * fixed `.footer-float` then runs past the emulated viewport and captures a black
 * band. That is why the shots are clipped to the viewport here, and why the
 * narrow-shell case (real 320/344px group widths, wide locales, 99+ counts) is
 * checked in the responsive fitting harness nav panels instead of from this script.
 *
 * Output: .nav-shot/nav-<w>.png (the navbar box) and .nav-shot/popup-<w>.png
 * (the whole popup), plus the metrics JSON on stdout.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

/**
 * The Playwright build actually on disk. `chromium.launch()` looks for the
 * revision this package pins, which is not necessarily what was downloaded - the
 * responsive fitting checks resolve the newest cached build the same way.
 */
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

/**
 * The demo state the e2e suite seeds. Copied rather than imported so this script
 * cannot be broken by a fixture refactor - it is throwaway tooling.
 */
const DEMO_SEED = {
  demoMode: true,
  onboardingComplete: true,
  addresses: [
    {
      id: 'demo-inbox-1',
      address: 'demo.user@example.com',
      provider: 'demo',
      status: 'active',
      accountStatus: 'active',
      autoExtend: true,
      createdAt: Date.now() - 3600_000,
      expiresAt: Date.now() + 86400_000,
      tag: 'banking',
      tagColor: '#EC4899',
      tags: [
        { name: 'banking', color: '#EC4899' },
        { name: 'shopping', color: '#10B981' },
      ],
    },
    {
      id: 'demo-inbox-2',
      address: 'second.inbox@example.com',
      provider: 'demo',
      status: 'active',
      accountStatus: 'active',
      autoExtend: true,
      createdAt: Date.now() - 7200_000,
      expiresAt: Date.now() + 172800_000,
      tags: [{ name: 'Banking', color: '#6366F1' }],
    },
  ],
};

const width = Number(process.argv[2] ?? 360);
const height = Number(process.argv[3] ?? 640);
const lang = process.argv[4] ?? 'en';
/**
 * How many unread messages to seed in the first demo mailbox. `> 0` puts the
 * unread count on the navbar, which the pill pays for with the badge's own box
 * (up to 25px for `99+`) - the case the fit is tightest against, and the one a
 * seatbelt-less shot would miss entirely.
 */
const unreadCount = Number(process.argv[5] ?? 0);

/** Raw email bags, seeded the way `getLogicalEmailMaps` reads them. */
function unreadEmailSeed(count: number): Record<string, unknown> {
  if (count <= 0) return {};
  const address = 'demo.user@example.com';
  return {
    emailStorageAddressIndex: { 'demo-inbox-1': address },
    'storedEmailsByAddress_demo-inbox-1': Array.from({ length: count }, (_, i) => ({
      id: `nav-shot-unread-${i}`,
      from: 'sender@example.com',
      from_name: 'Sender',
      subject: `Unread ${i}`,
      body: '',
      date: new Date().toISOString(),
      original_inbox: address,
    })),
  };
}

async function main() {
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
      `--lang=${lang}`,
    ],
  });

  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = background.url().split('/')[2];

  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  // The in-app language is a preference, not the browser's - pin it before the
  // reload so the labels (and therefore the fit) are the locale under test.
  await page.evaluate(
    ({ seed, locale, unread }) =>
      new Promise<void>((resolve) => {
        (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set(
          { ...seed, ...unread, language: locale, locale },
          () => resolve()
        );
      }),
    { seed: DEMO_SEED, locale: lang, unread: unreadEmailSeed(unreadCount) }
  );
  await page.reload();
  await page.waitForSelector('#app > *', { timeout: 15000 });
  await page.waitForSelector('.floating-nav', { timeout: 15000 });
  // Layout + the indicator's rAF re-measure have to settle before we look.
  await page.waitForTimeout(1200);

  const metrics = await page.evaluate(() => {
    const nav = document.querySelector('.floating-nav');
    if (!nav) return { error: 'no .floating-nav' };
    const container = nav.parentElement;
    const fab = document.querySelector('.fab-btn');
    const cs = getComputedStyle(nav);
    const labels = [...nav.querySelectorAll('.nav-label')].map((label) => {
      const range = document.createRange();
      range.selectNodeContents(label);
      const ink = range.getBoundingClientRect();
      const box = label.getBoundingClientRect();
      const item = label.closest('.nav-item')?.getBoundingClientRect();
      return {
        text: label.textContent,
        fontPx: parseFloat(getComputedStyle(label).fontSize),
        advance: +ink.width.toFixed(2),
        boxW: +box.width.toFixed(2),
        // Positive = the browser is hiding that many px of the label's ink.
        hiddenInkPx: +Math.max(0, ink.right - box.right, box.left - ink.left).toFixed(2),
        outsideItemPx: item
          ? +Math.max(0, ink.right - item.right, item.left - ink.left).toFixed(2)
          : null,
        labelOverflowX: getComputedStyle(label).overflowX,
        itemOverflow: label.closest('.nav-item')
          ? getComputedStyle(label.closest('.nav-item') as Element).overflow
          : null,
      };
    });
    const badge = nav.querySelector('.nav-badge');
    // What the FIT measured vs what the row paints. The fit measures through a
    // canvas with the resolved family; if those two faces differ, the fit hands
    // back sizes that do not fit, and the flexbox shaves the difference off
    // every label instead of overflowing.
    const canvasMetrics = labels.map((entry) => {
      const label = [...nav.querySelectorAll('.nav-label')].find(
        (l) => l.textContent === entry.text
      );
      if (!label) return null;
      const style = getComputedStyle(label);
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return null;
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const measured = ctx.measureText(entry.text).width;
      return {
        text: entry.text,
        font: `${style.fontWeight} ${style.fontSize}`,
        family: style.fontFamily,
        canvasWidth: +measured.toFixed(2),
        domAdvance: entry.advance,
        delta: +(entry.advance - measured).toFixed(2),
      };
    });
    return {
      canvasMetrics,
      locale: document.documentElement.lang,
      navWidth: +nav.getBoundingClientRect().width.toFixed(2),
      floatRect: (() => {
        const f = document.querySelector('.footer-float');
        if (!f) return null;
        const r = f.getBoundingClientRect();
        return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), width: +r.width.toFixed(2) };
      })(),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      docScrollWidth: document.documentElement.scrollWidth,
      floatOverflowsViewportPx: (() => {
        const f = document.querySelector('.footer-float');
        if (!f) return null;
        const r = f.getBoundingClientRect();
        return +Math.max(0, r.right - window.innerWidth, -r.left).toFixed(2);
      })(),
      containerWidth: container ? +container.getBoundingClientRect().width.toFixed(2) : null,
      containerPadX: container ? getComputedStyle(container).paddingInlineStart : null,
      fabWidth: fab ? +fab.getBoundingClientRect().width.toFixed(2) : null,
      navFontSize: cs.fontSize,
      navPadX: getComputedStyle(nav.querySelector('.nav-item') as Element).paddingLeft,
      navPadBlockStart: getComputedStyle(nav.querySelector('.nav-item') as Element)
        .paddingBlockStart,
      itemCount: nav.querySelectorAll('.nav-item').length,
      dataNavOverflow: nav.getAttribute('data-nav-overflow'),
      badgeText: badge?.textContent ?? null,
      labels,
    };
  });

  // The More menu fits through a SECOND fitter (`fitLabelFontSize`), so it needs
  // its own probe: hovering the More item opens it via the app's own handler.
  const more = await page.evaluate(async () => {
    const items = [...document.querySelectorAll('.nav-item')];
    const moreBtn = items[items.length - 1] as HTMLElement | undefined;
    if (!moreBtn) return { error: 'no items' };
    moreBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    const menu = document.querySelector('.more-menu-nav');
    if (!menu) return { error: 'menu did not open' };
    return {
      itemCount: menu.querySelectorAll('.more-menu-item').length,
      labels: [...menu.querySelectorAll('.nav-label')].map((label) => {
        const range = document.createRange();
        range.selectNodeContents(label);
        const ink = range.getBoundingClientRect();
        const box = label.getBoundingClientRect();
        const item = label.closest('.more-menu-item')?.getBoundingClientRect();
        return {
          text: label.textContent,
          fontPx: parseFloat(getComputedStyle(label).fontSize),
          advance: +ink.width.toFixed(2),
          boxW: +box.width.toFixed(2),
          hiddenInkPx: +Math.max(0, ink.right - box.right, box.left - ink.left).toFixed(2),
          outsideItemPx: item
            ? +Math.max(0, ink.right - item.right, item.left - ink.left).toFixed(2)
            : null,
        };
      }),
    };
  });

  // The unread count is part of the shot's identity: without it the badge case
  // overwrites the clean case and the sheet can only show one of them.
  const suffix = unreadCount > 0 ? `-u${unreadCount}` : '';
  const navShot = join(OUT_DIR, `nav-${width}-${lang}${suffix}.png`);
  const popupShot = join(OUT_DIR, `popup-${width}-${lang}${suffix}.png`);
  // An element screenshot of a fixed row that is WIDER than the viewport
  // captures the region beyond the paint surface as a black band, which is what
  // the 320px shots used to look like. Clip to the viewport instead - the row's
  // own overflow is reported by `floatOverflowsViewportPx`.
  const floatBox = await page.evaluate(() => {
    const f = document.querySelector('.footer-float');
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (floatBox) {
    const vw = await page.evaluate(() => window.innerWidth);
    const vh = await page.evaluate(() => window.innerHeight);
    const x = Math.max(0, floatBox.x);
    const y = Math.max(0, floatBox.y);
    await page.screenshot({
      path: navShot,
      clip: {
        x,
        y,
        width: Math.min(floatBox.width, vw - x),
        height: Math.min(floatBox.height, vh - y),
      },
    });
  }
  await page.screenshot({ path: popupShot });

  console.log(JSON.stringify({ ...metrics, moreMenu: more }, null, 2));
  console.log(`\nnavbar → ${navShot}`);
  console.log(`popup  → ${popupShot}`);
  writeIndex();
  console.log(`index  → ${join(OUT_DIR, 'index.html')}`);
  await context.close();
}

/**
 * Rewrite `.nav-shot/index.html` with every shot taken so far, at 2× so the last
 * letters of a label can be judged by EYE. The whole point of this script is that
 * geometry numbers can look fine while the paint is wrong, so the deliverable is
 * something to look at - and it lives beside the PNGs it shows. Serve it with
 * `bun scripts/serve-static.ts` and open `/.nav-shot/index.html`.
 */
function writeIndex(): void {
  const shots = readdirSync(OUT_DIR)
    .filter((f) => /^nav-\d+-[a-z]{2}(-u\d+)?\.png$/.test(f))
    .sort();
  const figures = shots
    .map((f) => {
      const [, w, lang, unread] = /^nav-(\d+)-([a-z]{2})(?:-u(\d+))?\.png$/.exec(f) ?? [];
      const badge = unread ? ` · ${unread}+ unread` : ' · no unread';
      return `    <figure>\n      <figcaption>${lang} · ${w}px viewport${badge}</figcaption>\n      <img src="/.nav-shot/${f}" alt="${lang} navbar" />\n    </figure>`;
    })
    .join('\n');
  writeFileSync(
    join(OUT_DIR, 'index.html'),
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8" />\n<title>Real navbar shots</title>\n<style>\n  body { margin: 0; padding: 16px; background: #f6f4f8; font: 13px/1.4 system-ui, sans-serif; color: #222; }\n  h1 { font-size: 15px; margin: 0 0 4px; }\n  p { margin: 0 0 16px; color: #666; }\n  figure { margin: 0 0 18px; background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 10px; }\n  figcaption { font: 11px/1.4 ui-monospace, monospace; color: #555; margin-bottom: 6px; }\n  img { display: block; width: 100%; image-rendering: pixelated; }\n</style></head><body>\n<h1>Real floating navbar - built extension</h1>\n<p>From <code>bun scripts/nav-shot.ts</code>: headed Chromium with <code>.output/chrome-mv3</code> loaded, demo state seeded. 2× pixelated so the last letters are visible by eye. Generated - do not hand-edit.</p>\n${figures}\n</body></html>\n`
  );
}

await main();
