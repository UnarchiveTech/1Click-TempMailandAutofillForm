/**
 * Headless verification of tests/visual/preview-responsive-button-layout.html via Playwright.
 *
 * Usage (browser defaults to chromium):
 *   bun scripts/check-responsive-button-layout-visual.mjs [chromium|webkit|firefox]
 *
 * The preview page is served automatically on :8765 (RESPONSIVE_BUTTON_LAYOUT_PORT to
 * override) unless it is already reachable - `bun scripts/serve-static.ts`
 * does the same thing manually.
 *
 * Environment:
 *   RESPONSIVE_BUTTON_LAYOUT_CDP=http://127.0.0.1:9223  → connect to a system Chrome (or any
 *     CDP endpoint) instead of launching a Playwright build. Only for
 *     chromium; wins over everything else.
 *   RESPONSIVE_BUTTON_LAYOUT_BROWSER=webkit|firefox     → same as the positional argument.
 *   PW_WEBKIT_EXEC / PW_FIREFOX_EXEC / PW_CHROMIUM_EXEC → explicit
 *     executable path. Otherwise the newest matching build already in the
 *     Playwright cache is used (this machine's browser CDN is firewalled, so
 *     the lockfile's build number may be absent - adjacent builds are
 *     protocol-stable, see tests/e2e-webkit/avatar-geometry.e2e.ts).
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const typeName = process.argv[2] ?? process.env.RESPONSIVE_BUTTON_LAYOUT_BROWSER ?? 'chromium';
const base =
  process.env.RESPONSIVE_BUTTON_LAYOUT_URL ??
  'http://127.0.0.1:8765/tests/visual/preview-responsive-button-layout.html';
const cdp = process.env.RESPONSIVE_BUTTON_LAYOUT_CDP;

/** `window.__responsiveButtonLayout` / `window.__navPanels` / `window.__aboutPanels` (set by the preview page) on the preview page. */
type AboutPanelDump = {
  lang: string;
  row: string;
  dir: string;
  verdict: string;
  failures: string[];
  /** The panel's measured row dump (geometry), for diagnosing failures. */
  measured?: unknown;
};
type ResponsiveButtonLayoutWindow = Window &
  typeof globalThis & {
    __responsiveButtonLayout?: unknown;
    __navPanels?: Record<string, { verdict: string; report: string[]; divergence: string[] }>;
    __aboutPanels?: Record<string, AboutPanelDump>;
  };

/** Newest cached Playwright build for a browser family, or undefined. */
function findCachedPlaywrightBuild(family: string) {
  const root =
    process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
      : path.join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(`${family}-`))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (dirs.length === 0) return undefined;
  const latest = dirs[dirs.length - 1];
  const win = process.platform === 'win32';
  if (family === 'webkit') {
    return path.join(root, latest, win ? 'Playwright.exe' : 'pw_run.sh');
  }
  if (family === 'firefox') {
    return path.join(root, latest, 'firefox', win ? 'firefox.exe' : 'firefox');
  }
  // chromium: layout differs per platform (chrome-win64 / chrome-linux / chrome-mac)
  const sub = win ? 'chrome-win64' : process.platform === 'darwin' ? 'chrome-mac' : 'chrome-linux';
  return path.join(
    root,
    latest,
    sub,
    win ? 'chrome.exe' : process.platform === 'darwin' ? 'Chromium' : 'chrome'
  );
}

/** Serve tests/visual/preview-responsive-button-layout.html on :8765 when nothing is answering RESPONSIVE_BUTTON_LAYOUT_URL yet. */
let serverProc: { kill(): void } | null = null;
async function ensurePreviewServer() {
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(1500) });
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
      const res = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      /* keep waiting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`responsive fitting preview server did not start on ${base}`);
}

const execOverride =
  (typeName === 'webkit'
    ? process.env.PW_WEBKIT_EXEC
    : typeName === 'firefox'
      ? process.env.PW_FIREFOX_EXEC
      : process.env.PW_CHROMIUM_EXEC) ?? findCachedPlaywrightBuild(typeName);

const browser = cdp
  ? await chromium.connectOverCDP(cdp)
  : await (typeName === 'firefox'
      ? firefox.launch(execOverride ? { executablePath: execOverride } : {})
      : typeName === 'webkit'
        ? webkit.launch(execOverride ? { executablePath: execOverride } : {})
        : chromium.launch(execOverride ? { executablePath: execOverride } : {}));
const context = cdp
  ? browser.contexts()[0]
  : await browser.newContext({ viewport: { width: 1500, height: 1400 } });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  await ensurePreviewServer();
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(
    () =>
      (window as ResponsiveButtonLayoutWindow).__responsiveButtonLayout !== undefined &&
      (window as ResponsiveButtonLayoutWindow).__navPanels !== undefined &&
      (window as ResponsiveButtonLayoutWindow).__aboutPanels !== undefined,
    { timeout: 6000 }
  );

  const dump = await page.evaluate(
    (panels) => {
      const verdicts: Record<string, string> = {};
      for (const id of panels) {
        verdicts[id] = document.getElementById(`v-${id}`)?.textContent ?? '?';
      }
      const nav = (window as ResponsiveButtonLayoutWindow).__navPanels ?? {};
      // The nav panels' divergence lines are what the rule-8 discussion reads, so
      // they are printed with the verdict rather than hidden in the page.
      const navNotes: Record<string, string[]> = {};
      for (const [id, panel] of Object.entries(
        (window as ResponsiveButtonLayoutWindow).__navPanels ?? {}
      )) {
        navNotes[id] = (panel as { report?: string[] }).report ?? [];
      }
      return {
        verdicts,
        rows: (window as ResponsiveButtonLayoutWindow).__responsiveButtonLayout,
        nav: Object.fromEntries(
          Object.keys(nav).map((id) => [
            id,
            (nav as Record<string, { verdict: string; divergence: string[] }>)[id],
          ])
        ),
        navNotes,
        about: Object.fromEntries(
          Object.entries((window as ResponsiveButtonLayoutWindow).__aboutPanels ?? {}).map(
            ([id, panel]) => [
              id,
              { verdict: panel.verdict, failures: panel.failures, measured: panel.measured },
            ]
          )
        ),
      };
    },
    [...'ABCDEFGHIJKLMNOPQR', 'S', 'T', 'U', 'V', 'W', 'X']
  );
  console.log(JSON.stringify(dump, null, 2));

  // The About panels' failures carry their reason (fit overflow, fattened
  // interior, off-tier font) - print them, not just the panel id.
  for (const [id, panel] of Object.entries(dump.about)) {
    if (panel.verdict !== 'PASS') {
      console.error(`✗ about panel ${id}: ${panel.failures.join('; ')}`);
    }
  }
  const failed = Object.entries(dump.verdicts)
    .filter(([, verdict]) => verdict !== 'PASS')
    .map(([id]) => id);
  const total = Object.keys(dump.verdicts).length;
  if (failed.length > 0) {
    console.error(`✗ ${typeName} responsive fitting check FAILED: ${failed.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${typeName} responsive fitting check passed (${total}/${total} panels)`);
  }

  const shotPath = `tests/visual/preview-responsive-button-layout-shot-${typeName}.png`;
  await page.screenshot({ path: shotPath, fullPage: true });
  console.log(`screenshot saved: ${shotPath}`);
} finally {
  await browser.close();
  // CFA narrows `serverProc` to null-only here - its only assignment lives
  // inside ensurePreviewServer(), which control-flow analysis cannot see.
  (serverProc as { kill(): void } | null)?.kill();
}
