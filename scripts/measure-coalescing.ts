/**
 * Measure the content→background read coalescers on a REAL page load.
 *
 * What it does: loads the real built extension (dev-mode build - production
 * compiles the counters to no-ops) into headed Chromium, opens the repo's demo
 * signup page (http://localhost:5173/signup-social.html, served by
 * `bun run dev:demo`) and lets the content script do its natural page-load
 * work - form scan, autofill button injection, the wizard resume triage. That
 * load is exactly the read burst the coalescers were built for.
 *
 * The report is read through the EXISTING dev diagnostics channel: an
 * extension page (popup) asks the SW `getPerfReport`, which merges the
 * active tab's content-script ring (`collectPerfMarks`) and per-type send
 * counters. Two protocol facts shape the mechanics:
 *  - `chrome.runtime.sendMessage` from the SW never reaches the SW's own
 *    listener, and a web page's main world has no `chrome.runtime` - so the
 *    read MUST be mediated by an extension page.
 *  - The injected autofill buttons live in a closed shadow root with
 *    session-randomized classes - unreachable from a main-world evaluate, so
 *    there is no deterministic out-of-page click; the natural load is the
 *    measured workload.
 *
 * Popup-induced SW marks are excluded by a WINDOW, not just a cutoff: SW-ring
 * marks count only between pageOpenAt (the demo page navigation) and
 * popupOpenAt (before the reporting popup starts loading). Content-side marks
 * and counters are page-scoped by construction and need only the lower bound.
 *
 * The A/B per read type:
 *    before (pre-coalescer) background runs = sends
 *    hits  = bg.readCoalesced marks (served from in-flight/TTL-retained run)
 *    after (derived)  = sends − hits
 *    after (measured) = bg.readRun marks (the task actually started)
 * Derived and measured agree when every call is accounted for; a mismatch
 * flags a sender the content counters miss or marks outside the window.
 *
 * Usage:
 *   1. NODE_ENV=development bun run build   (keeps perf instrumentation)
 *   2. bun run dev:demo                     (background server on :5173)
 *   3. bun scripts/measure-coalescing.ts
 *
 * Output: a JSON report on stdout. Exits 0 even when counts are 0 - a
 * zero-reuse run is a valid measurement, not an error.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

/** The Playwright build actually on disk (same convention as nav-shot.ts). */
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

const EXTENSION_PATH =
  process.env.EXTENSION_PATH ?? join(import.meta.dir, '..', '.output', 'chrome-mv3-dev');
const DEMO_URL = process.env.DEMO_URL ?? 'http://localhost:5173/signup-social.html';
/**
 * ms to wait before reading the SW ring. The storage-read burst starts ~5s
 * after load (form detection → autofill buttons → reads) and ends ~+9s -
 * but the SW ring holds only the LAST 200 marks and every runtime message
 * marks too, so the early burst is evicted if we read too late. Read just
 * after the burst ends; the OTP/watch tail past this point is cut (bounded
 * window by design).
 */
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 9_000);

/**
 * The coalesced read types the report cares about most - kept for callers
 * that want to filter `perType` down to the intentionally-coalesced families.
 */
export const COALESCED_TYPES = [
  'loadSmartAutofillSettings',
  'getWizardSession',
  'getActiveAddressMeta',
  'getFieldMap',
  'getStorageViaBg',
  'getProvider',
  'getProviderDisplayName',
  'shouldPreferReplay',
];

/** Encoded coalescer key prefix → the message type whose burst it belongs to. */
function coalescerTypeOfKey(key: string): string {
  if (key.startsWith('settings')) return 'loadSmartAutofillSettings';
  if (key.startsWith('session|')) return 'getWizardSession';
  if (key.startsWith('active-meta')) return 'getActiveAddressMeta';
  if (key.startsWith('map|')) return 'getFieldMap';
  if (key.startsWith('ext|') || key.startsWith('content|')) return 'getStorageViaBg';
  if (key.startsWith('providerName|')) return 'getProviderDisplayName';
  if (key.startsWith('provider')) return 'getProvider';
  if (key.startsWith('replay|')) return 'shouldPreferReplay';
  return '(other)';
}

type SwMark = { name: string; at: number; durMs: number; meta?: Record<string, unknown> };
type CountReport = {
  page?: string;
  total?: number;
  entries?: Array<{ type: string; count: number }>;
};
interface RawReport {
  swMarks?: SwMark[];
  tabMarks?: Array<{ context: string; mark: SwMark }>;
  tabCounts?: CountReport;
  isDevBuild?: boolean;
}

/** A minimal demo-mode seed: one live address so autofill flows have data. */
const SEED = {
  demoMode: true,
  onboardingComplete: true,
  language: 'en',
  locale: 'en',
  activeAddressId: 'demo-inbox-1',
  addresses: [
    {
      id: 'demo-inbox-1',
      address: 'demo.user@example.com',
      provider: 'demo',
      status: 'active',
      accountStatus: 'active',
      createdAt: 1_700_000_000_000,
      expiresAt: 1_900_000_000_000,
    },
  ],
};

async function main(): Promise<void> {
  if (!existsSync(join(EXTENSION_PATH, 'manifest.json'))) {
    console.error(
      `No built extension at ${EXTENSION_PATH} - run: bun x wxt build --browser chrome --mode development`
    );
    process.exit(1);
  }

  const executablePath = chromiumExecutable();
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    ...(executablePath ? { executablePath } : {}),
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--lang=en',
    ],
  });

  try {
    let [background] = context.serviceWorkers();
    if (!background) background = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = background.url().split('/')[2];

    // 1) Seed storage through a first popup (extension context), then close
    //    it - its own loads must not pollute the demo page's window.
    const seeder = await context.newPage();
    await seeder.setViewportSize({ width: 380, height: 700 });
    await seeder.goto(`chrome-extension://${extensionId}/popup.html`);
    await seeder.waitForSelector('#app > *', { timeout: 15000 });
    await seeder.evaluate(
      (seed) =>
        new Promise<void>((resolve) => {
          (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set(seed, () =>
            resolve()
          );
        }),
      SEED
    );
    await seeder.close();

    // 2) Open the REAL page - the content script runs its natural load work.
    //    Everything the page's reads emit lands at or after this instant (SW
    //    and Node share the machine clock).
    const pageOpenAt = Date.now();
    const page = await context.newPage();
    await page.goto(DEMO_URL, { waitUntil: 'load' });

    // Natural settle: form scan, button injection, wizard triage.
    await page.waitForTimeout(SETTLE_MS);

    // 3) Read the report through a SECOND popup (extension context → the SW
    //    listener actually receives runtime.sendMessage). The SW's
    //    getPerfReport merges whichever tab is ACTIVE - the popup itself once
    //    it opens - so instead the popup addresses the demo tab DIRECTLY:
    //    tabs.query by URL, then collectPerfMarks to that tab. popupOpenAt
    //    bounds the SW-ring window (this popup's own load marks land after
    //    it and are excluded; the demo page's happened before it).
    const popupOpenAt = Date.now();
    const reporter = await context.newPage();
    await reporter.goto(`chrome-extension://${extensionId}/popup.html`);
    await reporter.waitForSelector('#app > *', { timeout: 15000 });

    /** One popup-mediated read: the SW ring AND the demo tab's own report. */
    const readOnce = (): Promise<RawReport & { lastError?: string | null }> =>
      reporter.evaluate(
        (demoUrl) =>
          new Promise<RawReport & { lastError?: string | null }>((resolve) => {
            const api = (globalThis as unknown as { chrome: typeof chrome }).chrome;
            const out: RawReport & { lastError?: string | null } = {};
            // 1) The SW's own ring (bg.readCoalesced / bg.readRun marks).
            api.runtime.sendMessage({ type: 'getPerfReport' }, (sw?: RawReport) => {
              out.swMarks = sw?.swMarks ?? [];
              out.isDevBuild = sw?.isDevBuild;
              // 2) The demo tab's per-type send counters (direct-to-tab -
              //    the SW's active-tab merge would find the popup instead).
              api.tabs.query({}, (tabs?: Array<{ id?: number; url?: string }>) => {
                const demo = (tabs ?? []).find((t) => (t.url ?? '').startsWith(demoUrl));
                if (!demo?.id) {
                  out.lastError = 'demo tab not found';
                  resolve(out);
                  return;
                }
                api.tabs.sendMessage(
                  demo.id,
                  { type: 'collectPerfMarks' },
                  (r?: { ok?: boolean; marks?: SwMark[]; counts?: CountReport }) => {
                    out.lastError = api.runtime.lastError?.message ?? null;
                    if (r?.ok) {
                      out.tabMarks = (r.marks ?? []).map((mark) => ({ context: 'content', mark }));
                      out.tabCounts = r.counts;
                    }
                    resolve(out);
                  }
                );
              });
            });
          }),
        DEMO_URL
      );

    // The FIRST read races the SW (a message sent as the worker spins up can
    // be answered with undefined + lastError); retry until the tab actually
    // answers or attempts run out.
    let raw: RawReport & { lastError?: string | null } = {};
    for (let attempt = 0; attempt < 6; attempt++) {
      raw = await readOnce();
      if ((raw.tabCounts?.total ?? 0) > 0 || (raw.tabMarks?.length ?? 0) > 0) break;
      await page.waitForTimeout(1_000);
    }
    await reporter.close();

    // 4) Page-scoped marks: SW ring inside [pageOpenAt, popupOpenAt); the
    //    tab ring is per-page by construction but needs the lower bound.
    //    The SW marks are the GROUND TRUTH for coalescing: the content script
    //    runs in ALL frames (allFrames), each with its own counters, but the
    //    SW coalescer serves every frame - its hit/run marks count every
    //    request exactly once (hit + run = requests, run = background work).
    const pageSwMarks = (raw.swMarks ?? []).filter((m) => m.at >= pageOpenAt && m.at < popupOpenAt);
    const pageTabMarks = (raw.tabMarks ?? [])
      .map((e) => e?.mark)
      .filter((m): m is SwMark => !!m && m.at >= pageOpenAt);
    const swMarks = [...pageSwMarks, ...pageTabMarks];
    const tabCounts = raw.tabCounts ?? { page: 'unknown', total: 0, entries: [] };

    // 5) Per-cache-family A/B from the marks alone:
    //      before (pre-coalescer) = hits + runs (each request would have run)
    //      after                  = runs (what the task actually did)
    const hits = new Map<string, number>();
    const runs = new Map<string, number>();
    for (const m of swMarks) {
      if (m.name !== 'bg.readCoalesced' && m.name !== 'bg.readRun') continue;
      const key = String((m.meta as { key?: string } | undefined)?.key ?? '');
      const type = coalescerTypeOfKey(key);
      const target = m.name === 'bg.readCoalesced' ? hits : runs;
      target.set(type, (target.get(type) ?? 0) + 1);
    }

    let beforeTotal = 0;
    let afterTotal = 0;
    const rows: Array<{
      type: string;
      requests: number;
      bgRunsBefore: number;
      hits: number;
      bgRunsAfter: number;
      reductionPct: number;
    }> = [];
    const allTypes = [...new Set([...hits.keys(), ...runs.keys()])].sort();
    for (const type of allTypes) {
      const hitCount = hits.get(type) ?? 0;
      const runCount = runs.get(type) ?? 0;
      const requests = hitCount + runCount;
      beforeTotal += requests;
      afterTotal += runCount;
      rows.push({
        type,
        requests,
        bgRunsBefore: requests,
        hits: hitCount,
        bgRunsAfter: runCount,
        reductionPct: requests > 0 ? Math.round((hitCount / requests) * 100) : 0,
      });
    }
    const output = {
      url: DEMO_URL,
      page: tabCounts.page ?? 'unknown',
      settleMs: SETTLE_MS,
      markWindow: { from: pageOpenAt, to: popupOpenAt },
      totalCoalescedRequests: beforeTotal,
      totalBgRunsBefore: beforeTotal,
      totalBgRunsAfter: afterTotal,
      saved: beforeTotal - afterTotal,
      reductionPct:
        beforeTotal > 0 ? Math.round(((beforeTotal - afterTotal) / beforeTotal) * 100) : 0,
      perType: rows,
      // Context only: the TOP frame's per-type send counters (each iframe
      // counts its own; the SW marks above count every frame's requests).
      topFrameSends: tabCounts.entries ?? [],
      isDevBuild: raw.isDevBuild ?? null,
      pageMarkCount: swMarks.length,
      readLastError: raw.lastError ?? null,
      // Diagnostics: the FULL unfiltered SW ring at read time (names + times
      // + keys) - shows restarts (bg.swStart), eviction, and where the
      // page's marks landed relative to the window.
      rawSwRing: (raw.swMarks ?? []).map((m) => ({
        n: m.name,
        at: m.at,
        k: String((m.meta as { key?: string } | undefined)?.key ?? ''),
      })),
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
