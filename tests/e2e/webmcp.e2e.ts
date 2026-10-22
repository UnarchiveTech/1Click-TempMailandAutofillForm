/**
 * e2e/webmcp.e2e.ts
 *
 * Verifies the WebMCP surface end-to-end:
 *   1. The webmcp-bridge content script injects webmcp-page.js into a real
 *      http page, which registers all 9 tools on `document.modelContext`.
 *   2. Read-only tools execute through the postMessage bridge and the
 *      background implementations (get_active_email / get_latest_otp /
 *      get_email against seeded demo storage).
 *
 * WebMCP is experimental and gated behind Chrome flags, so this suite launches
 * its OWN persistent context with `--enable-features=WebMCPTesting` (the flag
 * behind chrome://flags/#enable-webmcp-testing). When the running Chromium
 * build has no WebMCP support the registration/execution assertions skip with
 * an explanatory message instead of failing the whole E2E suite. Set
 * WEBMCP_REQUIRE_SUPPORT=1 to turn that skip into a hard failure, so a coverage
 * run can PROVE the nine tools were really exercised instead of reporting a
 * green suite that asserted nothing.
 *
 * Requires the built extension at .output/chrome-mv3 (bun run build) and the
 * demo server started by playwright.config.ts.
 */

import { type BrowserContext, expect, type Page } from '@playwright/test';
import { test as base } from './fixtures';
import { extensionUrl } from './preview-harness';
import { demoSeedStorage } from './seed';

const DEMO_SIGNUP_URL = 'http://localhost:5173/demo/signup-checkout.html';

/** The feature flags behind chrome://flags/#enable-webmcp-testing. */
const WEBMCP_ARGS = [
  '--enable-experimental-web-platform-features',
  '--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
];

/** Every tool registered by src/entrypoints/webmcp-page.unlisted.ts. */
const EXPECTED_TOOLS = [
  'get_active_email',
  'create_temp_email',
  'get_latest_emails',
  'get_latest_otp',
  'get_otp_from',
  'search_emails',
  'list_addresses',
  'get_email',
  'burn_inbox',
];

/**
 * This suite is the ONLY e2e coverage for the WebMCP surface, and it is gated
 * behind a Chromium feature flag. Left as a plain `test.skip`, a browser
 * upgrade that drops the flag would turn it into a green run that asserts
 * nothing - the failure mode looks identical to success. WEBMCP_REQUIRE_SUPPORT=1
 * makes the unavailability a hard failure, so whoever is verifying WebMCP can
 * tell "the tools work" apart from "the tools were never called".
 */
const REQUIRE_WEBMCP_SUPPORT = process.env.WEBMCP_REQUIRE_SUPPORT === '1';

/**
 * Skip the calling test with an explanatory reason, or fail it outright when
 * the run declared WebMCP coverage mandatory.
 */
function requireWebmcpSurface(available: boolean, reason: string): void {
  if (available) return;
  if (REQUIRE_WEBMCP_SUPPORT) {
    throw new Error(
      `WEBMCP_REQUIRE_SUPPORT=1 but this build exposes no WebMCP surface: ${reason}. ` +
        'Run against a WebMCP-capable Chromium (Chrome 146+ / any build honouring ' +
        '--enable-features=WebMCPTesting), or unset the variable to skip instead.'
    );
  }
  console.warn(`[webmcp e2e] SKIPPED - ${reason}`);
  test.skip(true, reason);
}

/** Demo-mode storage seeded into every test page - 100% offline/deterministic.
 * NOTE: mail must be seeded in the CURRENT 3.0 email-storage shape - an
 * `emailStorageAddressIndex` mapping addressId → address plus one
 * `storedEmailsByAddress_<addressId>` bag per mailbox (+ derived metadata).
 * The legacy flat `storedEmails` key is no longer read by getEmailMaps(), so
 * seeding it produces an empty mailbox. See src/utils/storage/storage-keys.ts. */

export const test = base.extend<{
  webmcpContext: BrowserContext;
  extensionId: string;
  webmcpPage: Page;
}>({
  // Dedicated context so the experimental flags do not leak into the rest of
  // the E2E suite (extensions require headed mode in Playwright). Playwright
  // requires a destructured first argument, but an empty `{}` pattern trips
  // Biome's noEmptyPattern - depend on the real `browserName` fixture instead.
  chromiumArgs: WEBMCP_ARGS,
  webmcpContext: async ({ context }, use) => use(context),

  // An http(s) page (the bridge only runs there) with demo storage seeded.
  webmcpPage: async ({ webmcpContext, extensionId }, use) => {
    // chrome.storage is only reachable from extension pages / content worlds,
    // so seed demo state from a throwaway popup page first.
    const seeder = await webmcpContext.newPage();
    await seeder.goto(extensionUrl(extensionId, 'popup.html'));
    await seeder.evaluate(
      (seed) => {
        return new Promise<void>((resolve) => {
          chrome.storage.local.set(seed, () => resolve());
        });
      },
      { ...demoSeedStorage(), webmcpAccessList: ['localhost'] }
    );
    await seeder.close();

    const page = await webmcpContext.newPage();
    page.on('console', (msg) => {
      if (msg.text().includes('[1Click WebMCP]')) console.log(`[webmcp page] ${msg.text()}`);
    });
    await page.goto(DEMO_SIGNUP_URL);
    if (extensionId.startsWith('http:'))
      await page.addScriptTag({
        url: extensionUrl(extensionId, 'content-scripts/webmcp-bridge.js'),
      });
    await use(page);
    await page.close();
  },
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function modelContextAvailable(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Boolean(
      (document as unknown as { modelContext?: unknown }).modelContext ??
        (navigator as unknown as { modelContext?: unknown }).modelContext
    )
  );
}

async function getToolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const ctx =
      (
        document as unknown as {
          modelContext?: { getTools: () => Promise<Array<{ name?: string }>> };
        }
      ).modelContext ??
      (
        navigator as unknown as {
          modelContext?: { getTools: () => Promise<Array<{ name?: string }>> };
        }
      ).modelContext;
    if (!ctx) return [];
    const tools = await ctx.getTools();
    return tools.map((t) => t.name ?? '');
  });
}

/**
 * Execute a registered tool from the page's perspective and normalize the
 * reply. Prefers the tool's own `execute` callback (the agent-facing surface
 * per the spec - it runs the page script's postMessage bridge), with Chrome's
 * optional `executeTool` preview extension as a fallback. The page script
 * returns JSON strings, so parse them.
 */
async function callTool(
  page: Page,
  tool: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  return page.evaluate(
    async ({ tool, args }) => {
      const ctx = (
        document as unknown as {
          modelContext?: {
            getTools: () => Promise<Array<{ name?: string; execute?: (a: unknown) => unknown }>>;
            executeTool?: (t: unknown, a: unknown) => unknown;
          };
        }
      ).modelContext;
      if (!ctx) return { raw: 'modelContext missing' };
      const tools = await ctx.getTools();
      const registered = tools.find((t) => t.name === tool);
      if (!registered) return { raw: `tool ${tool} not registered` };

      let out: unknown;
      if (typeof ctx.executeTool === 'function') {
        // The current browser API accepts a JSON-serializable input OBJECT.
        // A descriptor's stringified inputSchema does not change that contract.
        // https://developer.chrome.com/docs/ai/webmcp/imperative-api
        out = await ctx.executeTool(registered, args);
      } else if (typeof registered.execute === 'function') {
        out = await registered.execute(args);
      } else {
        return { raw: 'no execute surface exposed by this build' };
      }

      if (typeof out === 'string') {
        try {
          return JSON.parse(out);
        } catch {
          return { raw: out };
        }
      }
      return out;
    },
    { tool, args }
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('registers all 9 WebMCP tools on an http page', async ({ webmcpPage: page }) => {
  const available = await modelContextAvailable(page);
  requireWebmcpSurface(
    available,
    'WebMCP is unavailable in this browser engine; registration coverage was not exercised'
  );

  // The page script injects at document_start and retries registration briefly,
  // so poll instead of assuming a fixed delay.
  await expect.poll(() => getToolNames(page), { timeout: 15_000 }).toHaveLength(9);

  const names = await getToolNames(page);
  expect(names.sort()).toEqual([...EXPECTED_TOOLS].sort());
});

test('read-only tools execute through the bridge and background', async ({ webmcpPage: page }) => {
  const available = await modelContextAvailable(page);
  requireWebmcpSurface(available, 'WebMCP is unavailable in this browser engine');

  await expect.poll(() => getToolNames(page), { timeout: 15_000 }).toHaveLength(9);

  // Agents invoke tools via the registered `execute` callback (or Chrome's
  // optional executeTool preview extension). Feature-detect either surface so
  // builds that only expose registration still pass.
  const hasExecuteSurface = await page.evaluate(async () => {
    const ctx = (
      document as unknown as {
        modelContext?: {
          getTools: () => Promise<Array<{ name?: string; execute?: unknown }>>;
          executeTool?: unknown;
        };
      }
    ).modelContext;
    if (!ctx) return false;
    const tools = await ctx.getTools();
    const reg = tools.find((t) => t.name === 'get_active_email');
    return Boolean(
      reg && (typeof reg.execute === 'function' || typeof ctx.executeTool === 'function')
    );
  });
  requireWebmcpSurface(
    hasExecuteSurface,
    'neither tool.execute nor modelContext.executeTool is exposed in this build'
  );

  const activeEmail = await callTool(page, 'get_active_email');
  expect(activeEmail).toMatchObject({ address: 'demo.user@example.com' });

  const otp = await callTool(page, 'get_latest_otp');
  expect(otp).toMatchObject({ otp: '482901' });

  const email = await callTool(page, 'get_email', { emailId: 'demo-seed-1' });
  expect(email).toMatchObject({
    subject: 'Your verification code',
    address: 'demo.user@example.com',
  });
});
