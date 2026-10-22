/**
 * scripts/e2e-firefox.ts
 *
 * Firefox E2E smoke suite for the 1Click Temp Mail extension, driven with
 * Selenium WebDriver (Marionette/geckodriver).
 *
 * Why Selenium instead of Playwright?
 *   Playwright cannot load Firefox add-ons (extensions work only in its
 *   Chromium builds), so Firefox coverage uses the officially supported
 *   WebDriver path: geckodriver + driver.installAddon().
 *
 * What this covers in a native Firefox session:
 *   1. Add-on installs and its content script injects into a real web page -
 *      the XPI packaging, MV3 manifest, background script, and content-script
 *      injection work in Firefox (asserted via the real in-field control's
 *      data-oc-pad-end padding reservation; host identifiers are randomized).
 *   2. The "autofill-form" command (the built manifest's shortcut) runs the full background ->
 *      content-script pipeline and fills the seeded email, names and matching
 *      password fields. An unchanged page cannot pass this assertion.
 *   3. Popup/app/sidepanel document mounts and the real storage-backed runtime
 *      handler, reached through Firefox's privileged UI navigation.
 *   Remaining limitations:
 *     - Firefox WebDriver forbids
 *       navigating to moz-extension:// URLs ("Navigation ... is not allowed
 *       in this context") through the ordinary content WebDriver session;
 *       this dedicated runner enables UI automation in its temporary profile.
 *       This runner seeds actual storage using a test-only background bootstrap
 *       in the temporary XPI, then loads unchanged production background.js.
 *       The XPI grants localhost injection only for the local fixture; the
 *       release manifest and build are never modified. Deep shared workflows
 *       run in the engine-preview matrix, with native UI/permission coverage
 *       still a separate remaining milestone.
 *
 * Prerequisites:
 *   - network for Selenium Manager (auto-downloads geckodriver AND Firefox
 *     into ~/.cache/selenium if not installed)
 *   - `bun run build:firefox` (the script builds it automatically when the
 *     build is missing or stale relative to sources - mtime-based, see
 *     check-stale-builds.ts)
 *   - the demo server on :5174 (the script starts it automatically;
 *     FIREFOX_E2E_PORT overrides it without borrowing the shared matrix server)
 *
 * Run: bun run test:e2e:firefox
 * Optional: FIREFOX_E2E_BINARY selects an installed executable (never its
 * personal profile); FIREFOX_E2E_OUTPUT_DIR isolates screenshots and results.
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import type { WebDriver, WebElement } from 'selenium-webdriver';
import { Builder, Key } from 'selenium-webdriver';
import type { Driver as FirefoxDriver } from 'selenium-webdriver/firefox.js';
import { Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { demoSeedStorage } from '../tests/e2e/seed';
import { staleness } from './check-stale-builds';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT_DIR = path.resolve(__dirname, '..');
const FIREFOX_BUILD_DIR = path.resolve(ROOT_DIR, '.output', 'firefox-mv3');
const EVIDENCE_DIR = path.resolve(
  ROOT_DIR,
  process.env.FIREFOX_E2E_OUTPUT_DIR || '.wxt/e2e-firefox'
);
const XPI_PATH = path.join(tmpdir(), '1click-temp-mail-e2e.xpi');
const DEMO_PORT = Number(process.env.FIREFOX_E2E_PORT || '5174');
if (!Number.isInteger(DEMO_PORT) || DEMO_PORT < 1 || DEMO_PORT > 65535) {
  throw new Error('FIREFOX_E2E_PORT must be an integer between 1 and 65535');
}
const DEMO_URL = `http://localhost:${DEMO_PORT}/demo/signup-checkout.html`;

// ── helpers ─────────────────────────────────────────────────────────────────

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll `fn` (an executeScript-style check) until truthy or timeout. */
async function waitFor(
  fn: () => Promise<unknown>,
  label: string,
  timeoutMs = 15_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for: ${label}${lastError ? ` (last error: ${String(lastError)})` : ''}`
  );
}

/** Build the Firefox add-on when `.output/firefox-mv3` is missing or stale. */
async function ensureFirefoxBuild(): Promise<void> {
  const status = staleness(ROOT_DIR, 'firefox');
  if (status.fresh) return;
  const missing = !(await Bun.file(path.join(FIREFOX_BUILD_DIR, 'manifest.json')).exists());
  console.log(
    `${missing ? 'Firefox build missing' : 'Firefox build is stale'} - ` +
      'running wxt build --browser firefox…'
  );
  const proc = Bun.spawn([process.execPath, 'x', 'wxt', 'build', '--browser', 'firefox'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exit = await proc.exited;
  if (exit !== 0) {
    throw new Error(`wxt build --browser firefox failed (exit ${exit ?? 'interrupted'})`);
  }
}

/** Pack the built add-on directory into an XPI (zip with manifest at root). */
async function buildXpi(): Promise<void> {
  const files: Record<string, Uint8Array> = {};
  const glob = new Bun.Glob('**/*');
  for await (const abs of glob.scan({ cwd: FIREFOX_BUILD_DIR, absolute: true })) {
    // Glob returns only files; guard against directories just in case
    const rel = path.relative(FIREFOX_BUILD_DIR, abs).split(path.sep).join('/');
    files[rel] = await Bun.file(abs).bytes();
  }
  // Change only the temporary test XPI. The release manifest stays untouched.
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  manifest.host_permissions = [
    ...new Set([...(manifest.host_permissions ?? []), 'http://localhost/*']),
  ];
  assert(
    manifest.background?.scripts?.includes('background.js'),
    'Expected Firefox event-page background build'
  );
  // Firefox WebDriver cannot seed via a popup fixture. Seed actual browser
  // storage before loading the unchanged production background event page.
  manifest.background.scripts = ['e2e-bootstrap.js'];
  const seed = {
    ...demoSeedStorage(),
    smartAutofillSettings: {
      dryRunPreview: false,
      humanLikeFilling: false,
      humanLikeTiming: false,
    },
  };
  files['e2e-bootstrap.js'] = new TextEncoder().encode(
    `browser.commands.onCommand.addListener(async (command) => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.startsWith('http://localhost:${DEMO_PORT}/demo/')) return;
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: (name) => document.documentElement.setAttribute('data-e2e-native-command', name),
        args: [command],
      });
    });
    browser.storage.local.set(${JSON.stringify(seed)}).then(() => {
      const script = document.createElement('script');
      script.src = browser.runtime.getURL('background.js');
      document.documentElement.appendChild(script);
    }).catch((error) => console.error('E2E storage bootstrap failed', error));`
  );
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  await Bun.write(XPI_PATH, zipSync(files, { level: 0 }));
}

/**
 * Find a Firefox already installed in Selenium Manager's cache
 * (~/.cache/selenium/firefox/<platform>/<version>/), if any. When a cached
 * copy exists we select its executable directly, so the suite can
 * run without re-downloading Firefox (e.g. offline or behind a firewall that
 * blocks ftp.mozilla.org). Returns undefined when nothing is cached, in
 * which case Selenium Manager downloads the latest Firefox as before.
 */
function findCachedFirefoxBinary(): string | undefined {
  const cacheRoot = path.join(homedir(), '.cache', 'selenium', 'firefox');
  if (!existsSync(cacheRoot)) return undefined;
  const binary = process.platform === 'win32' ? 'firefox.exe' : 'firefox';
  const versions: Array<{ version: string; binary: string }> = [];
  for (const platformDir of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!platformDir.isDirectory()) continue;
    const platformPath = path.join(cacheRoot, platformDir.name);
    for (const versionDir of readdirSync(platformPath, { withFileTypes: true })) {
      if (!versionDir.isDirectory()) continue;
      if (existsSync(path.join(platformPath, versionDir.name, binary))) {
        versions.push({
          version: versionDir.name,
          binary: path.join(platformPath, versionDir.name, binary),
        });
      }
    }
  }
  if (versions.length === 0) return undefined;
  versions.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  return versions[versions.length - 1].binary;
}

/** Use a separate port so a finishing matrix run cannot kill this fixture. */
async function ensureDemoServer(): Promise<ReturnType<typeof Bun.spawn> | null> {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(DEMO_URL);
      if (res.ok) return null;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  console.log('Starting demo server (scripts/demo-server.ts)…');
  const child = Bun.spawn([process.execPath, 'scripts/demo-server.ts'], {
    env: { ...process.env, DEMO_PORT: String(DEMO_PORT) },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(DEMO_URL);
      if (res.ok) return child;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  child.kill();
  throw new Error(`Demo server did not start on http://localhost:${DEMO_PORT}`);
}

// ── tests ───────────────────────────────────────────────────────────────────

async function testAddonLoadsAndInjects(driver: WebDriver): Promise<void> {
  console.log('  • add-on installs and content script injects on the demo page…');
  await driver.get(DEMO_URL);

  // The host is intentionally randomized. The real in-field control reserves
  // padding on the input; do not require a removed fingerprinting marker.
  await waitFor(
    () =>
      driver.executeScript(
        "return (document.querySelector('#email')?.hasAttribute('data-oc-pad-end') ?? false)"
      ),
    'in-field icon injection trace on #email'
  );
}

async function testNativeShell(
  driver: WebDriver,
  shell: 'popup' | 'app' | 'sidepanel'
): Promise<void> {
  const firefox = driver as FirefoxDriver;
  console.log(`  • native ${shell} document mounts and reads seeded storage…`);
  await firefox.setContext('chrome');
  try {
    await driver.executeScript(`
        const ids = JSON.parse(Services.prefs.getStringPref('extensions.webextensions.uuids'));
        const uuid = ids['1click-temp-mail@unarchive.tech'];
        if (!uuid) throw new Error('Installed Firefox extension UUID missing');
        gBrowser.selectedBrowser.loadURI(Services.io.newURI('moz-extension://' + uuid + '/${shell}.html'), {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
      `);
  } finally {
    await firefox.setContext('content');
  }
  await waitFor(
    () =>
      driver.executeScript(
        `return location.protocol === 'moz-extension:' && location.pathname === '/${shell}.html' && document.readyState === 'complete' && !!document.querySelector('#app nav, #app footer')`
      ),
    `native ${shell} shell controls`
  );
  // executeScript awaits this Promise, exercising Firefox's real runtime API.
  const valid = await driver.executeScript(
    "return browser.runtime.sendMessage({ type: 'getAddresses' }).then(result => result.success === true && result.addresses.some(address => address.address === 'demo.user@example.com'))"
  );
  assert(valid, `Native ${shell} could not read the seeded address through the background`);
  await Bun.write(
    path.join(EVIDENCE_DIR, `${shell}.png`),
    Buffer.from(await driver.takeScreenshot(), 'base64')
  );
}

async function testAutofillCommandPipeline(driver: WebDriver): Promise<void> {
  const manifest = await Bun.file(path.join(FIREFOX_BUILD_DIR, 'manifest.json')).json();
  const suggested = manifest.commands?.['autofill-form']?.suggested_key;
  const platform =
    process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';
  const shortcut =
    typeof suggested === 'string' ? suggested : suggested?.[platform] || suggested?.default;
  assert(typeof shortcut === 'string', 'Built manifest has no autofill shortcut');
  const match = /^Alt\+Shift\+([A-Z])$/.exec(shortcut);
  assert(match, `Unsupported autofill shortcut in the native runner: ${shortcut}`);
  const letter = match[1];
  console.log(`  • ${shortcut} command runs the background → content pipeline…`);
  // Content WebDriver input does not dispatch browser-owned shortcuts. Send
  // the real key sequence to the dedicated Firefox UI, then resume page checks.
  const firefox = driver as FirefoxDriver;
  await firefox.setContext('chrome');
  try {
    const bindings = await driver.executeScript(
      "return Array.from(document.querySelectorAll('keyset[id^=\"ext-keyset-id-\"] key')).map(key => ({ key: key.getAttribute('key'), keycode: key.getAttribute('keycode'), modifiers: key.getAttribute('modifiers') }))"
    );
    console.log('Native Firefox registered extension shortcuts:', bindings);
    assert(
      Array.isArray(bindings) &&
        bindings.some(
          (binding) =>
            binding.key === letter && binding.modifiers?.split(',').sort().join(',') === 'alt,shift'
        ),
      `Firefox did not register the built manifest's shortcut: ${shortcut}`
    );
    await driver.executeScript('window.focus();');
    await driver
      .actions()
      .keyDown(Key.ALT)
      .keyDown(Key.SHIFT)
      .sendKeys(letter)
      .keyUp(Key.SHIFT)
      .keyUp(Key.ALT)
      .perform();
  } finally {
    await firefox.setContext('content');
  }

  await waitFor(
    () =>
      driver.executeScript(
        "return document.documentElement.getAttribute('data-e2e-native-command') === 'autofill-form'"
      ),
    'Firefox dispatched the native autofill-form command'
  );

  // Assert actual form output. An unchanged page after a failed command cannot pass.
  await waitFor(
    () =>
      driver.executeScript(
        "return document.querySelector('#email')?.value === 'demo.user@example.com'"
      ),
    'command filled the seeded address'
  );
  const filled = await driver.executeScript(
    "return !!document.querySelector('#fn')?.value && !!document.querySelector('#ln')?.value && !!document.querySelector('#pw')?.value && document.querySelector('#pw')?.value === document.querySelector('#pw2')?.value"
  );
  assert(filled, 'Autofill command did not fill names and matching password fields');
}

async function testNativeAutofillControl(driver: WebDriver): Promise<void> {
  console.log('  • native closed-root Autofill All control fills the real signup page…');
  await testAddonLoadsAndInjects(driver);
  const host = (await driver.executeScript(
    "return Array.from(document.body.children).find(element => element.style.position === 'fixed' && element.style.width === '0px' && element.style.height === '0px')"
  )) as WebElement | null;
  assert(host, 'Native autofill shadow host was not found');
  // W3C WebDriver's shadow-root endpoint, not page JS or a production hook.
  const root = await host.getShadowRoot();
  let fillAll: WebElement | undefined;
  await waitFor(async () => {
    fillAll = await root.findElement({ css: 'button[title="Autofill all fields"]' });
    return true;
  }, 'native Autofill All control');
  assert(fillAll, 'Native Autofill All control was not found');
  // Firefox's element-click precheck retargets closed-root hit tests to the
  // host and calls it an obstruction. Use real viewport pointer input instead;
  // the filled-field assertions still fail if anything actually covers it.
  const rect = await fillAll.getRect();
  await driver
    .actions()
    .move({
      origin: 'viewport',
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
    })
    .click()
    .perform();
  await waitFor(
    () =>
      driver.executeScript(
        "return document.querySelector('#email')?.value === 'demo.user@example.com' && !!document.querySelector('#fn')?.value && !!document.querySelector('#ln')?.value && !!document.querySelector('#pw')?.value && document.querySelector('#pw')?.value === document.querySelector('#pw2')?.value"
      ),
    'native Autofill All filled the seeded email, names and matching passwords'
  );
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await ensureFirefoxBuild();
  await buildXpi();

  const demoServer = await ensureDemoServer();
  let driver: Awaited<ReturnType<Builder['build']>> | null = null;
  const checks: Array<{ name: string; status: 'passed' | 'failed'; error?: string }> = [];
  let fatalError: string | undefined;
  let browserVersion: string | undefined;
  const binary = process.env.FIREFOX_E2E_BINARY || findCachedFirefoxBinary();
  try {
    if (binary) {
      console.log(`Launching Firefox (headed) - using binary ${binary}…`);
    } else {
      console.log('Launching Firefox (headed)…');
    }
    // UI context is enabled only in this disposable test browser/profile.
    const profileRoot = path.join(EVIDENCE_DIR, 'profiles');
    mkdirSync(profileRoot, { recursive: true });
    const service = new ServiceBuilder().addArguments(
      '--allow-system-access',
      '--profile-root',
      profileRoot
    );
    const builder = new Builder().forBrowser('firefox').setFirefoxService(service);
    if (binary) builder.setFirefoxOptions(new Options().setBinary(binary));
    driver = await builder.build();
    browserVersion = String((await driver.getCapabilities()).get('browserVersion'));
    console.log(`Native Firefox version: ${browserVersion}`);
    await (driver as unknown as FirefoxDriver).installAddon(XPI_PATH, true);
    console.log('Add-on installed (temporary)');

    const activeDriver = driver;
    const check = async (name: string, run: () => Promise<void>) => {
      try {
        await run();
        checks.push({ name, status: 'passed' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        checks.push({ name, status: 'failed', error: message });
        console.error(`Native Firefox ${name} failed: ${message}`);
        try {
          await Bun.write(
            path.join(EVIDENCE_DIR, `failure-${name}.png`),
            Buffer.from(await activeDriver.takeScreenshot(), 'base64')
          );
        } catch (captureError) {
          console.error('Native Firefox failure capture failed:', captureError);
        }
      }
    };
    for (const shell of ['popup', 'app', 'sidepanel'] as const) {
      await check(shell, () => testNativeShell(activeDriver, shell));
    }
    await check('content-injection', () => testAddonLoadsAndInjects(activeDriver));
    await check('autofill-shortcut', () => testAutofillCommandPipeline(activeDriver));
    await check('autofill-control', () => testNativeAutofillControl(activeDriver));
    const failures = checks.filter((result) => result.status === 'failed');
    if (failures.length) throw new Error(`${failures.length} native Firefox checks failed`);

    console.log('\n✓ Firefox e2e suite passed');
  } catch (error) {
    fatalError = error instanceof Error ? error.message : String(error);
    if (driver) {
      try {
        // Demo data only. Report presence, never generated passwords or secrets.
        console.error(
          'Final native Firefox form state:',
          await driver.executeScript(
            "return { emailFilled: !!document.querySelector('#email')?.value, firstNameFilled: !!document.querySelector('#fn')?.value, lastNameFilled: !!document.querySelector('#ln')?.value, passwordFilled: !!document.querySelector('#pw')?.value, focused: document.hasFocus() }"
          )
        );
        await Bun.write(
          path.join(EVIDENCE_DIR, 'failure.png'),
          Buffer.from(await driver.takeScreenshot(), 'base64')
        );
      } catch (captureError) {
        console.error('Native Firefox failure capture failed:', captureError);
      }
    }
    throw error;
  } finally {
    try {
      await Bun.write(
        path.join(EVIDENCE_DIR, 'coverage.json'),
        JSON.stringify(
          {
            lane: 'native-firefox',
            browserVersion,
            binary: binary || 'selenium-manager',
            fullScenarioParity: false,
            status: fatalError ? 'failed' : 'passed',
            fatalError,
            checks,
          },
          null,
          2
        )
      );
    } finally {
      try {
        await driver?.quit();
      } catch {
        /* ignore */
      }
      try {
        demoServer?.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error('\n✗ Firefox e2e suite failed:', error instanceof Error ? error.message : error);
  console.error(
    'Prerequisites: network for Selenium Manager (auto-downloads Firefox + geckodriver),\n' +
      '  and `bun run build:firefox` (the script rebuilds automatically when stale).'
  );
  process.exitCode = 1;
});
