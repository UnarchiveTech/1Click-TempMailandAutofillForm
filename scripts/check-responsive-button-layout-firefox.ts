/**
 * scripts/check-responsive-button-layout-firefox.mjs
 *
 * Firefox verification of tests/visual/preview-responsive-button-layout.html (panels A-L), complementing
 * scripts/check-responsive-button-layout-visual.mjs (Chromium / Playwright WebKit).
 *
 * Why Selenium here: Playwright cannot drive a stock Firefox (it requires its
 * Juggler-patched build, and the browser CDN is firewalled on dev machines -
 * see tests/e2e-webkit/avatar-geometry.e2e.ts). So - same as
 * scripts/e2e-firefox.ts - Firefox coverage uses WebDriver/Marionette.
 *
 * Firefox resolution (same order as scripts/e2e-firefox.ts):
 *   1. RESPONSIVE_BUTTON_LAYOUT_FIREFOX_BIN → explicit path to a firefox.exe
 *   2. Selenium Manager cache (~/.cache/selenium/firefox/<platform>/<version>)
 *   3. Selenium Manager auto-download (requires network)
 *
 * Output matches scripts/check-responsive-button-layout-visual.mjs: a JSON dump of
 * { verdicts, rows } - the verdicts are the page's own hard assertions.
 * The preview page is served automatically on :8765 (RESPONSIVE_BUTTON_LAYOUT_PORT to
 * override) unless it is already reachable.
 *
 * Usage:
 *   bun scripts/check-responsive-button-layout-firefox.mjs
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Builder } from 'selenium-webdriver';
import { Options as FirefoxOptions } from 'selenium-webdriver/firefox.js';

const BASE =
  process.env.RESPONSIVE_BUTTON_LAYOUT_URL ??
  'http://127.0.0.1:8765/tests/visual/preview-responsive-button-layout.html';
const PANELS = 'ABCDEFGHIJKLMNOPQRSTUVWX';

/** Latest cached Firefox under ~/.cache/selenium/firefox/<platform>/<version>. */
function findCachedFirefoxBinary() {
  const cacheRoot = path.join(homedir(), '.cache', 'selenium', 'firefox');
  if (!existsSync(cacheRoot)) return undefined;
  const binary = 'firefox.exe';
  const versions = [];
  for (const platformDir of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!platformDir.isDirectory()) continue;
    const platformPath = path.join(cacheRoot, platformDir.name);
    for (const versionDir of readdirSync(platformPath, { withFileTypes: true })) {
      if (!versionDir.isDirectory()) continue;
      const candidate = path.join(platformPath, versionDir.name, binary);
      if (existsSync(candidate)) versions.push(candidate);
    }
  }
  if (versions.length === 0) return undefined;
  versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return versions[versions.length - 1];
}

const firefoxBinary = process.env.RESPONSIVE_BUTTON_LAYOUT_FIREFOX_BIN ?? findCachedFirefoxBinary();
if (!firefoxBinary) {
  console.error(
    'No Firefox found. Set RESPONSIVE_BUTTON_LAYOUT_FIREFOX_BIN to a firefox.exe path or run the\n' +
      'Selenium-based suite once (`bun run test:e2e:firefox`) to populate\n' +
      '~/.cache/selenium/firefox.'
  );
  process.exit(2);
}
console.log(`Launching Firefox (headless) - ${firefoxBinary}`);

/** Serve tests/visual/preview-responsive-button-layout.html on :8765 when nothing is answering RESPONSIVE_BUTTON_LAYOUT_URL yet. */
let serverProc: { kill(): void } | null = null;
async function ensurePreviewServer() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
    if (res.ok) return;
  } catch {
    /* not up yet */
  }
  serverProc = Bun.spawn(
    [
      process.execPath,
      'scripts/serve-static.ts',
      process.env.RESPONSIVE_BUTTON_LAYOUT_PORT ?? '8765',
    ],
    {
      stdout: 'ignore',
      stderr: 'ignore',
    }
  );
  for (let i = 0; i < 30; i += 1) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      /* keep waiting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`responsive fitting preview server did not start on ${BASE}`);
}

const driver = await new Builder()
  .forBrowser('firefox')
  .setFirefoxOptions(new FirefoxOptions().setBinary(firefoxBinary).addArguments('-headless'))
  .build();

try {
  await ensurePreviewServer();
  await driver.get(BASE);
  await driver.wait(
    async () =>
      (await driver.executeScript(
        "return typeof window.__responsiveButtonLayout !== 'undefined'"
      )) === true,
    20_000
  );

  // Marionette discards the value of an expression statement, so every
  // script must carry an explicit `return` (unlike Chromium/WebKit) - and it is
  // executed as plain JS, so the payload may not carry TYPE annotations (a
  // `const x: Record<string, string>` here was a SyntaxError that took the whole
  // Firefox check down before it read a single verdict).
  const dump = (await driver.executeScript(
    `return (() => {
      const verdicts = {};
      for (const id of '${PANELS}') {
        verdicts[id] = document.getElementById('v-' + id)?.textContent ?? '?';
      }
      const rows = {};
      for (const id of '${PANELS}') {
        const node = document.getElementById('row' + id);
        // Same selector the responsive fitting itself uses (getButtons): the About S
        // toolbar rows are anchor stacks - a buttons-only selector would crash
        // the dump on getComputedStyle(undefined).
        const buttons = [...node.querySelectorAll('button, a, [role="button"]')];
        const rects = buttons.map((b) => b.getBoundingClientRect());
        const gaps = [];
        for (let i = 0; i < rects.length - 1; i += 1) {
          // Facing-edge distance, direction-agnostic (see the responsive fitting's
          // measureGap) - the naive left−right diff spans AROUND both buttons
          // under RTL and reads as a huge negative gap.
          gaps.push(
            Math.round(
              Math.max(
                rects[i + 1].left - rects[i].right,
                rects[i].left - rects[i + 1].right
              ) * 10
            ) / 10
          );
        }
        const cs = getComputedStyle(buttons[0]);
        const svg = buttons[0].querySelector('svg');
        const label = buttons[0].querySelector('.btn-label') ?? buttons[0].querySelector('span');
        rows[id] = {
          state: node.dataset.responsiveButtonLayoutState ?? '-',
          font: Math.round(parseFloat(cs.fontSize) * 10) / 10,
          pad: Math.round(parseFloat(cs.paddingLeft) * 10) / 10,
          band: Math.round(parseFloat(cs.gap) * 10) / 10,
          icon: svg ? Math.round(parseFloat(getComputedStyle(svg).width) * 10) / 10 : null,
          heights: buttons.map((b) => Math.round(b.getBoundingClientRect().height * 10) / 10),
          widths: buttons.map((b) => Math.round(b.getBoundingClientRect().width * 10) / 10),
          gaps,
          rowWidth: Math.round(node.getBoundingClientRect().width * 10) / 10,
          sumPlusGaps:
            Math.round(
              (gaps.reduce((a, g) => a + g, 0) +
                buttons.reduce((a, b) => a + b.getBoundingClientRect().width, 0)) *
                10
            ) / 10,
          labelWrap: getComputedStyle(label).whiteSpace,
          labelOverflow: getComputedStyle(label).overflow,
          labelEllipsis: getComputedStyle(label).textOverflow,
        };
      }
      const navPanels = window.__navPanels ?? {};
      const nav = {};
      const navNotes = {};
      for (const id of Object.keys(navPanels)) {
        nav[id] = { verdict: navPanels[id].verdict, divergence: navPanels[id].divergence };
        navNotes[id] = navPanels[id].report ?? [];
      }
      const aboutPanels = window.__aboutPanels ?? {};
      const about = {};
      for (const [id, panel] of Object.entries(aboutPanels)) {
        about[id] = { verdict: panel.verdict, failures: panel.failures ?? [] };
      }
      return { verdicts, rows, nav, navNotes, about };
    })()`
  )) as {
    verdicts: Record<string, string>;
    rows: unknown;
    nav: Record<string, unknown>;
    navNotes: Record<string, string[]>;
    about: Record<string, { verdict: string; failures: string[] }>;
  };

  console.log(JSON.stringify(dump, null, 2));

  // The About panels' failures carry their reason - print them, not just ids.
  for (const [id, panel] of Object.entries(dump.about ?? {})) {
    if (panel.verdict !== 'PASS') {
      console.error(`✗ about panel ${id}: ${panel.failures.join('; ')}`);
    }
  }

  const failed = Object.entries(dump.verdicts)
    .filter(([, verdict]) => verdict !== 'PASS')
    .map(([id]) => id);
  if (failed.length > 0) {
    console.error(`✗ Firefox responsive fitting check FAILED: ${failed.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `✓ Firefox responsive fitting check passed (${PANELS.length}/${PANELS.length} panels)`
    );
  }
} finally {
  await driver.quit();
  // CFA narrows `serverProc` to null-only here - its only assignment lives
  // inside ensurePreviewServer(), which control-flow analysis cannot see.
  (serverProc as { kill(): void } | null)?.kill();
}
