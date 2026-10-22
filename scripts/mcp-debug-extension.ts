/**
 * mcp-debug-extension.ts - launch the extension for chrome-devtools-mcp.
 *
 * chrome-devtools-mcp disables extensions by default and branded Chrome no
 * longer accepts --load-extension, so the reliable pattern is: launch an
 * extension-capable Chromium ourselves with the unpacked build loaded and
 * remote debugging on, then point the MCP server at it with --browser-url
 * (see .mcp.json).
 *
 * Usage:
 *   bun scripts/mcp-debug-extension.ts          # picks the best Chromium
 *   MCP_DEBUG_PORT=9333 bun scripts/mcp-debug-extension.ts
 *
 * It resolves, in order: $MCP_CHROME_PATH → Playwright's bundled Chromium
 * (extension-capable) → system Chrome → Edge. Prints the CDP URL for the MCP
 * config and the loaded extension id once the debug endpoint answers.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.env.MCP_DEBUG_PORT || 9222);
const EXT_DIR = resolve(ROOT, '.output', 'chrome-mv3');
const PROFILE_DIR = join(ROOT, '.wxt', 'mcp-profile');

if (!existsSync(join(EXT_DIR, 'manifest.json'))) {
  console.error(`Extension build not found at ${EXT_DIR}. Run "bun run build" first.`);
  process.exit(1);
}

function newestPlaywrightChromium(baseDir: string): string | null {
  try {
    const dirs = readdirSync(baseDir)
      .filter((d) => d.startsWith('chromium-'))
      .sort();
    for (let i = dirs.length - 1; i >= 0; i--) {
      const exe = join(baseDir, dirs[i], 'chrome-win64', 'chrome.exe');
      if (existsSync(exe)) return exe;
    }
  } catch {
    /* dir missing */
  }
  return null;
}

const pwBase = join(homedir(), 'AppData', 'Local', 'ms-playwright');
// Producers return null (newestPlaywrightChromium, env lookup) or undefined
// (platform ternaries); the find() below only needs truthiness.
const candidates: (string | null | undefined)[] = [
  process.env.MCP_CHROME_PATH,
  newestPlaywrightChromium(pwBase),
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : undefined,
  process.platform === 'win32'
    ? join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe')
    : undefined,
  process.platform === 'win32'
    ? join(
        process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)',
        'Microsoft/Edge/Application/msedge.exe'
      )
    : undefined,
];

const chromePath = candidates.find((p) => p && existsSync(p));
if (!chromePath) {
  console.error(
    'No extension-capable Chromium found. Install one and set MCP_CHROME_PATH, ' +
      'or run "npx @puppeteer/browsers install chrome@stable --path ~/chrome-for-testing".'
  );
  process.exit(1);
}

mkdirSync(PROFILE_DIR, { recursive: true });

const args = [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE_DIR}`,
  `--load-extension=${EXT_DIR}`,
  `--disable-extensions-except=${EXT_DIR}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate',
  'about:blank',
];

console.log(`Launching ${chromePath}`);
const child = spawn(chromePath, args, {
  detached: true,
  stdio: 'ignore',
});
child.unref();

// Poll the CDP endpoint until it answers.
const deadline = Date.now() + 15_000;
(async () => {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (res.ok) {
        const targets = (await res.json()) as Array<{ type?: string; url?: string }>;
        const extTarget = targets.find(
          (t) => t.type === 'service_worker' || (t.url || '').startsWith('chrome-extension://')
        );
        console.log(`\nChrome debug endpoint: http://127.0.0.1:${PORT}`);
        console.log(
          extTarget
            ? `Extension loaded: ${(extTarget.url || '').split('/')[2] || 'yes'}`
            : 'Extension target not visible yet - check chrome://extensions in that window (enable Developer mode once).'
        );
        console.log(
          '\nMCP config already points here via .mcp.json (--browser-url). ' +
            'Restart the MCP server / client if it was already running.'
        );
        process.exit(0);
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  console.error('Timed out waiting for the Chrome debug endpoint. Is port 9222 free?');
  process.exit(1);
})();
