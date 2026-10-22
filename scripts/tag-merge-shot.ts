/**
 * One-off: prove the one-click case-variant tag merge on the REAL built extension.
 *
 * The merge is a chain - detection in the helper, a card that offers it, the
 * confirm, the address write and the catalog collapse - and a unit test can only
 * cover its two ends. This drives the shipped build: headed Chromium with
 * `.output/chrome-mv3` loaded, a `banking` / `Banking` split seeded, the popup
 * opened, Organize → Tags reached through the More menu, the button clicked and
 * the confirm accepted. Then it reads storage back and asserts the split is gone
 * from BOTH schemas.
 *
 * Usage: bun scripts/tag-merge-shot.ts
 *
 * It also reads back what the tag chips SHOW - the hub's chips and the address
 * list's chips - asserting each one's count equals the number of addresses its
 * hover names, that the hub's tag grid prints no address of its own (the card is
 * the chip plus its actions, not a second copy of the hover), and that every chip
 * showing a tag paints the SAME color - the seed stores the tag's two spellings in
 * two different colors (#EC4899 / #6366F1), so a spelling-keyed color map shows up
 * here as one tag painted two ways.
 *
 * A second scenario then reseeds a COLOR split with no spelling split (three
 * addresses, two of them writing #6366F1 and one #EC4899) and drives its cleanup:
 * the hub must offer that one, not a spelling merge, and the color that survives
 * must be the most-used one - not the first seen.
 *
 * A third reseeds that same split and picks a color in the TAG DIALOG on the
 * address holding the minority color, choosing Emerald, which no address writes
 * for this tag: the pick has to be written to all three, because a tag's color is
 * the tag's. It also compares the dialog's live PREVIEW against the chip the app
 * then paints - fill, ink and count - since a preview that can disagree with the
 * chip is exactly what a palette next to a hand-rolled chip produces.
 *
 * Output: `.nav-shot/tag-merge-{before,confirm,after}.png`,
 * `.nav-shot/tag-usage-addresses.png`, and a JSON report on stdout. Exits non-zero
 * when the split survives or a chip's count disagrees with its own tooltip.
 *
 * NOTE: `popup/index.html` pins `<meta name="viewport" content="width=360">`, so
 * the document lays out at 360 whatever window size is asked for.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import type { Address } from '../src/utils/types.js';

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

/** The tag both spellings belong to, and the split the merge has to resolve. */
const TAG = 'banking';
/**
 * A REAL case split: one address tagged `banking` (and `shopping`), another
 * tagged `Banking`. Same tag, two spellings - the state the merge exists for.
 */
const CASE_SPLIT_SEED = {
  demoMode: true,
  onboardingComplete: true,
  language: 'en',
  locale: 'en',
  addresses: [
    {
      id: 'demo-inbox-1',
      address: 'demo.user@example.com',
      provider: 'demo',
      status: 'active',
      accountStatus: 'active',
      createdAt: 1_700_000_000_000,
      expiresAt: 1_900_000_000_000,
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
      createdAt: 1_700_000_000_000,
      expiresAt: 1_900_000_000_000,
      tag: 'Banking',
      tagColor: '#6366F1',
      tags: [{ name: 'Banking', color: '#6366F1' }],
    },
  ],
};

/**
 * A COLOR split with no spelling split: every address writes `banking`, but two of
 * the three write it in #6366F1 and one in #EC4899. The casing cannot be blamed
 * here, so the only cleanup the hub can offer is the color one - and the color that
 * must survive is the one the MOST addresses write (#6366F1), not the first seen
 * (#EC4899), which is what makes this read tell "majority" apart from "first".
 */
const COLOR_SPLIT_SEED = {
  demoMode: true,
  onboardingComplete: true,
  language: 'en',
  locale: 'en',
  addresses: [
    {
      id: 'demo-inbox-1',
      address: 'demo.user@example.com',
      provider: 'demo',
      status: 'active',
      accountStatus: 'active',
      createdAt: 1_700_000_000_000,
      expiresAt: 1_900_000_000_000,
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
      createdAt: 1_700_000_000_000,
      expiresAt: 1_900_000_000_000,
      tag: 'banking',
      tagColor: '#6366F1',
      tags: [{ name: 'banking', color: '#6366F1' }],
    },
    {
      id: 'demo-inbox-3',
      address: 'third.inbox@example.com',
      provider: 'demo',
      status: 'active',
      accountStatus: 'active',
      createdAt: 1_700_000_000_000,
      expiresAt: 1_900_000_000_000,
      tag: 'banking',
      tagColor: '#6366F1',
      tags: [{ name: 'banking', color: '#6366F1' }],
    },
  ],
};

/**
 * The color scenario 3 picks in the dialog: Emerald. `banking` is written in no
 * such color in the seed, so "the tag is now Emerald everywhere" cannot come about
 * by accident - and Emerald is the color the pill's retired ink rule got WRONG
 * (it wanted white ink; the readable one is dark), so the preview-vs-chip ink check
 * has something to catch.
 */
const PICKED_COLOR = '#10B981';

/** The seed's majority color - what the chips paint before any pick. */
const SEEDED_COLOR = '#6366F1';

/** How many seeded addresses carry `TAG` - the reach the dialog has to disclose. */
const BANKING_CARRIERS = 3;

/** The `rgb(r, g, b)` form the browser reports for a hex color. */
function rgbCss(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** Read the persisted addresses back out of the extension. */
function readAddresses(page: Page): Promise<Address[]> {
  return page.evaluate(
    () =>
      new Promise<Address[]>((resolve) => {
        (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.get(
          ['addresses'],
          (result: { addresses?: Address[] }) => {
            resolve(result.addresses ?? []);
          }
        );
      })
  );
}

/** The spellings of `TAG` this address writes in `tags[]` (exact, not trimmed away). */
function tagEntries(account: Address): { name: string; color: string }[] {
  return (account.tags ?? []).filter(
    (entry) => (entry.name ?? '').trim().toLowerCase() === TAG
  ) as { name: string; color: string }[];
}

/**
 * Click by DOM, not by hit test.
 *
 * The floating nav and every menu/dialog keep a full-screen click-away backdrop
 * ABOVE the thing it belongs to (z-100 for the nav menus, `PORTAL_Z.dialog` for
 * modals), so Playwright's hit-tested click is intercepted by the backdrop and
 * retries forever. Dispatching the event straight at the node is what the app's
 * own `onclick` handler sees anyway.
 */
function domClick(page: Page, selector: string, last = false): Promise<boolean> {
  return page.evaluate(
    ({ selector, last }) => {
      const nodes = [...document.querySelectorAll(selector)];
      const target = (last ? nodes[nodes.length - 1] : nodes[0]) as HTMLElement | undefined;
      if (!target) return false;
      target.click();
      return true;
    },
    { selector, last }
  );
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
      '--lang=en',
    ],
  });

  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = background.url().split('/')[2];

  const page = await context.newPage();
  await page.setViewportSize({ width: 420, height: 720 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.evaluate(
    (seed) =>
      new Promise<void>((resolve) => {
        (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set(seed, () =>
          resolve()
        );
      }),
    CASE_SPLIT_SEED
  );
  await page.reload();
  await page.waitForSelector('#app > *', { timeout: 15000 });
  await page.waitForSelector('.footer-float', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);

  const MERGE_SELECTOR = 'button[aria-label^="Merge the spellings of"]';
  const COLOR_SELECTOR = 'button[aria-label^="Unify the colors of"]';

  /** Switch views through the floating nav pill, by the item's aria-label. */
  const gotoNav = async (label: string): Promise<void> => {
    await page.evaluate((name) => {
      const target = [...document.querySelectorAll('.nav-item')].find(
        (item) => item.getAttribute('aria-label') === name
      ) as HTMLElement | undefined;
      target?.click();
    }, label);
  };

  /** Reach Organize → Tags, which the pill keeps behind its More menu. */
  const openOrganizeTags = async (): Promise<void> => {
    await page.evaluate(() => {
      const more = [...document.querySelectorAll('.nav-item')].find(
        (item) => item.getAttribute('aria-label') === 'More'
      );
      // The menu opens on hover, and a synthetic mouseenter is what the handler reads.
      more?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });
    await page.waitForSelector('.more-menu-nav', { timeout: 10000 });
    await page.evaluate(() => {
      const organize = [...document.querySelectorAll('.more-menu-item')].find((item) =>
        (item.textContent ?? '').includes('Organize')
      ) as HTMLElement | undefined;
      organize?.click();
    });
    await page.waitForTimeout(400);
    // The Tags tab is the hub's default; click it if the app opened elsewhere.
    if ((await page.locator(MERGE_SELECTOR).count()) === 0) {
      await page.evaluate(() => {
        const tagsTab = [...document.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === 'Tags'
        ) as HTMLElement | undefined;
        tagsTab?.click();
      });
    }
  };

  /** Visible text, hover detail and PAINTED color of every tag chip on screen. */
  type ChipRead = { text: string; hover: string; bg: string; ink: string };
  /**
   * Every LIVE tag chip on screen: its text, its hover detail, and the two colors
   * it paints - the fill and the ink. Both colors are read because a chip can be
   * filled correctly and still disagree with the chip next to it: `ink` is what the
   * dialog's preview and the app's own chip must match on.
   */
  const readChips = (): Promise<ChipRead[]> =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-tag-chip]')].map((chip) => ({
        text: (chip.textContent ?? '').replace(/\s+/g, ' ').trim(),
        hover: chip.getAttribute('title') ?? '',
        bg: getComputedStyle(chip).backgroundColor,
        ink: getComputedStyle(chip).color,
      }))
    );

  /** Everything the run found wrong; reported together at the end. */
  const problems: string[] = [];

  /**
   * The address list: the ONE surface that paints a chip from each address's OWN
   * tag entry, so it is the read that can show a single tag twice.
   */
  const openAddressList = async (): Promise<ChipRead[]> => {
    await gotoNav('Addresses');
    // The address-list chip is NOT a `.tag-pill` (it lives inside a button, so it
    // must stay a span) - that shape is how this knows the view swapped. Polled
    // rather than hard-waited: a view that never appears must be REPORTED (as an
    // empty read) instead of thrown, so the verdict says what was missing.
    const selector = '[data-tag-chip]:not(.tag-pill)';
    for (let attempt = 0; attempt < 40 && (await page.locator(selector).count()) === 0; attempt++) {
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(400);
    return readChips();
  };

  await openOrganizeTags();
  const mergeButton = page.locator(MERGE_SELECTOR);
  await mergeButton.first().waitFor({ state: 'visible', timeout: 15000 });

  const before = await readAddresses(page);
  const hubBefore = {
    mergeLabels: await mergeButton.evaluateAll((buttons) =>
      buttons.map((button) => button.textContent?.trim() ?? '')
    ),
    ariaLabels: await mergeButton.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label') ?? '')
    ),
  };
  await page.screenshot({ path: join(OUT_DIR, 'tag-merge-before.png') });

  const hubChips = await readChips();

  // The hub card is the chip plus its actions - never the usage the chip's hover
  // already carries. If an address is printed in the tag grid, the card is
  // restating the tooltip one line per address and cannot stay compact. The card's
  // own box is measured too, because "compact" is a size, not a feeling.
  const hubGrid = await page.evaluate(() => {
    let node: Element | null = document.querySelector('[data-tag-chip]');
    while (node && getComputedStyle(node).display !== 'grid') node = node.parentElement;
    const card = (node?.firstElementChild as HTMLElement | null) ?? null;
    const box = card?.getBoundingClientRect();
    return {
      text: node?.textContent ?? '',
      columns: node ? getComputedStyle(node).gridTemplateColumns.split(' ').length : 0,
      cardWidth: Math.round(box?.width ?? 0),
      cardHeight: Math.round(box?.height ?? 0),
    };
  });

  // Read the address list while the SPLIT IS STILL LIVE - after the merge every
  // address writes one spelling in one color, which a spelling-keyed color map
  // would render correctly by accident. This is the read with teeth.
  const listChipsBefore = await openAddressList();
  await page.screenshot({ path: join(OUT_DIR, 'tag-usage-addresses-before.png') });

  // ── The one click ─────────────────────────────────────────────────────────
  // Back to the hub: the read above left us on the address list.
  await openOrganizeTags();
  await mergeButton.first().waitFor({ state: 'visible', timeout: 15000 });
  await domClick(page, MERGE_SELECTOR);
  await page.waitForSelector('button[aria-label="Confirm"]', { state: 'visible', timeout: 10000 });
  const dialogMessage = await page.evaluate(() => {
    const paragraph = [...document.querySelectorAll('p')].find((el) =>
      /spellings/.test(el.textContent ?? '')
    );
    return paragraph?.textContent ?? null;
  });
  await page.screenshot({ path: join(OUT_DIR, 'tag-merge-confirm.png') });
  await domClick(page, 'button[aria-label="Confirm"]', true);

  // The write goes through storage; wait for it to land rather than guessing.
  let after = before;
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.waitForTimeout(150);
    after = await readAddresses(page);
    const second = after[1];
    if (second && tagEntries(second).every((entry) => entry.name === TAG)) break;
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT_DIR, 'tag-merge-after.png') });

  // ── The same two surfaces after the merge: the split is gone ─────────────
  const listChips = await openAddressList();
  await page.screenshot({ path: join(OUT_DIR, 'tag-usage-addresses.png') });

  // ── The mailbox surface: header pill + the address-selector drawer rows ──
  await gotoNav('Mailbox');
  await page.waitForSelector('#button-open-dropdown', { timeout: 15000 });
  await domClick(page, '#button-open-dropdown');
  await page.waitForSelector('.tag-pill', { timeout: 15000 });
  await page.waitForTimeout(500);
  const mailboxChips = await readChips();
  await page.screenshot({ path: join(OUT_DIR, 'tag-usage-mailbox.png') });

  // ── Scenario 2: a COLOR split, with no spelling split at all ─────────────
  const reseed = (seed: object): Promise<void> =>
    page.evaluate(
      (next) =>
        new Promise<void>((resolve) => {
          (globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set(next, () =>
            resolve()
          );
        }),
      seed
    );
  await reseed(COLOR_SPLIT_SEED);
  await page.reload();
  await page.waitForSelector('#app > *', { timeout: 15000 });
  await page.waitForSelector('.footer-float', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await openOrganizeTags();

  const colorButton = page.locator(COLOR_SELECTOR);
  // Poll instead of hard-waiting: a MISSING offer has to come back as a reported
  // failure, not as a 15s timeout that says nothing about the feature.
  for (let attempt = 0; attempt < 40 && (await colorButton.count()) === 0; attempt++) {
    await page.waitForTimeout(250);
  }
  const colorOffers = {
    labels: await colorButton.evaluateAll((buttons) =>
      buttons.map((button) => button.textContent?.trim() ?? '')
    ),
    ariaLabels: await colorButton.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label') ?? '')
    ),
    // A color split is NOT a spelling split: no spelling merge may be offered for it.
    spellingOffers: await mergeButton.count(),
  };
  const colorChipsBefore = await readChips();
  await page.screenshot({ path: join(OUT_DIR, 'tag-color-split-before.png') });
  let colorConfirm: string | null = null;
  let afterColor: Address[] = [];
  if (colorOffers.labels.length > 0) {
    await domClick(page, COLOR_SELECTOR);
    await page.waitForSelector('button[aria-label="Confirm"]', {
      state: 'visible',
      timeout: 10000,
    });
    colorConfirm = await page.evaluate(() => {
      const paragraph = [...document.querySelectorAll('p')].find((el) =>
        /#[0-9a-f]{6}/i.test(el.textContent ?? '')
      );
      return paragraph?.textContent ?? null;
    });
    await page.screenshot({ path: join(OUT_DIR, 'tag-color-split-confirm.png') });
    await domClick(page, 'button[aria-label="Confirm"]', true);

    // The write goes through storage; wait for one color to land on every carrier.
    for (let attempt = 0; attempt < 40; attempt++) {
      await page.waitForTimeout(150);
      const now = await readAddresses(page);
      const colors = new Set(
        now.flatMap((account) => tagEntries(account).map((entry) => entry.color))
      );
      const carriers = now.filter((account) => tagEntries(account).length > 0).length;
      if (colors.size === 1 && carriers === 3) break;
    }
    await page.waitForTimeout(400);
    afterColor = await readAddresses(page);
    await page.screenshot({ path: join(OUT_DIR, 'tag-color-split-after.png') });
  }
  const colorOffersAfter = await colorButton.count();
  const colorListChips = await openAddressList();
  await page.screenshot({ path: join(OUT_DIR, 'tag-color-split-list.png') });

  // ── Scenario 3: a color pick in the DIALOG changes the tag ────────────────
  await reseed(COLOR_SPLIT_SEED);
  await page.reload();
  await page.waitForSelector('#app > *', { timeout: 15000 });
  await page.waitForSelector('.footer-float', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await gotoNav('Mailbox');
  await page.waitForSelector('[data-tag-chip]', { timeout: 15000 });
  // The mailbox header pill opens the dialog for THIS address - which stores the
  // MINORITY color, so the pick has to travel to the two it does not name.
  const dialogBefore = await readAddresses(page);
  await domClick(page, '[data-tag-chip]');
  for (
    let attempt = 0;
    attempt < 40 && (await page.locator('#button-save-tag').count()) === 0;
    attempt++
  ) {
    await page.waitForTimeout(250);
  }
  const dialogOpen = (await page.locator('#button-save-tag').count()) > 0;
  let afterDialog: Address[] = [];
  let dialogListChips: ChipRead[] = [];
  // Read while the dialog is OPEN - the hint and the preview are gone once it closes.
  let hintShown = false;
  let previewBeforePick: ChipRead | null = null;
  let previewAfterPick: ChipRead | null = null;
  let tickedBeforePick: string[] = [];
  let tickedAfterPick: string[] = [];

  /**
   * The palette swatches carrying the "chosen" tick, as the user sees them.
   *
   * The tick is the one thing on that row that claims a color, so it has to be on
   * the tag's OWN color when the dialog opens and on the pick afterwards - a bare
   * ring said neither (it reads as hover or focus just as well).
   */
  const readTickedSwatches = async (): Promise<string[]> =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-tag-swatch][data-chosen]')].map((el) =>
        (el.getAttribute('data-tag-swatch') ?? '').toUpperCase()
      )
    );

  /**
   * The chip the dialog is about to write, read from its preview.
   *
   * The dialog's removable selected chip is the preview. Scope the query to the
   * dialog so the mailbox row's hidden width-measurement pills cannot win it.
   */
  const readPreview = async (): Promise<ChipRead | null> =>
    page.evaluate(() => {
      const el = document.querySelector(
        '[role="dialog"][data-activity-dialog-key="dialog:tag"] [data-tag-chip-preview]'
      );
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        hover: el.getAttribute('title') ?? '',
        bg: style.backgroundColor,
        ink: style.color,
      };
    });
  if (!dialogOpen) {
    problems.push('the mailbox tag chip did not open the tag dialog');
  } else {
    // The reach has to be disclosed, not just implemented: picking a color here
    // changes the tag on addresses this dialog never mentions.
    // The disclosure has to name the REACH, not only the fact: the pick lands on
    // every address carrying the tag, so the hint's number has to be that number.
    const hintText = await page.evaluate(() => {
      const el = [...document.querySelectorAll('p')].find((p) =>
        /Recolors this tag on/.test(p.textContent ?? '')
      );
      return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    });
    const reach = Number(
      /Recolors this tag on (\d+) of your addresses/.exec(hintText)?.[1] ?? Number.NaN
    );
    hintShown = reach === BANKING_CARRIERS;
    if (!hintShown)
      problems.push(
        `the dialog did not disclose the reach (${BANKING_CARRIERS} addresses) - hint: “${hintText}”`
      );
    // Previewed BEFORE the pick: a preview that is only correct after saving is not
    // a preview. The pick then has to move it - and the palette's tick with it.
    tickedBeforePick = await readTickedSwatches();
    previewBeforePick = await readPreview();
    await domClick(page, 'button[role="radio"][aria-label="Emerald"]');
    tickedAfterPick = await readTickedSwatches();
    previewAfterPick = await readPreview();
    await page.screenshot({ path: join(OUT_DIR, 'tag-dialog-color.png') });
    await domClick(page, '#button-save-tag', true);
    // The write goes through storage; wait for the picked color to reach every carrier.
    for (let attempt = 0; attempt < 40; attempt++) {
      await page.waitForTimeout(150);
      const now = await readAddresses(page);
      const carriers = now.filter((account) => tagEntries(account).length > 0);
      if (
        carriers.length === 3 &&
        carriers.every((account) => tagEntries(account).every((e) => e.color === PICKED_COLOR))
      ) {
        break;
      }
    }
    await page.waitForTimeout(400);
    afterDialog = await readAddresses(page);
    dialogListChips = await openAddressList();
    await page.screenshot({ path: join(OUT_DIR, 'tag-dialog-color-list.png') });
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  //
  // One tag, one color: a tag is one tag regardless of casing, so every chip
  // showing it - hub card, address-list row, mailbox drawer - must paint the SAME
  // color. The seed writes `banking` in #EC4899 and `Banking` in #6366F1, which is
  // exactly the split a spelling-keyed color map turns into two colors.
  /** tag name → the distinct colors painted across these chips. */
  const colorsByTag = (chips: ChipRead[]): Map<string, Set<string>> => {
    const map = new Map<string, Set<string>>();
    for (const chip of chips) {
      const name = chip.text
        .replace(/\s*\d+\s*$/, '')
        .trim()
        .toLowerCase();
      if (!name) continue;
      const seen = map.get(name) ?? new Set<string>();
      seen.add(chip.bg);
      map.set(name, seen);
    }
    return map;
  };

  // PER SCENARIO, never across them: the two seeds resolve the tag to different
  // colors on purpose (a tie keeps #EC4899, a 2-1 majority keeps #6366F1), so only
  // a single state is evidence about "one tag, one color".
  const splitColors = colorsByTag([...hubChips, ...listChipsBefore, ...listChips, ...mailboxChips]);
  const cleanedColors = colorsByTag([...colorChipsBefore, ...colorListChips]);
  // A third state, after the dialog picked a color: still one tag, one color.
  const dialogColors = colorsByTag(dialogListChips);

  const report = {
    hubBefore,
    dialogMessage,
    hubChips,
    hubCard: {
      columns: hubGrid.columns,
      cardWidth: hubGrid.cardWidth,
      cardHeight: hubGrid.cardHeight,
      printsAddress: hubGrid.text.includes('@'),
    },
    listChipsBefore,
    listChips,
    mailboxChips,
    chipColors: {
      spellingSplit: Object.fromEntries([...splitColors].map(([name, set]) => [name, [...set]])),
      colorSplit: Object.fromEntries([...cleanedColors].map(([name, set]) => [name, [...set]])),
      dialogPick: Object.fromEntries([...dialogColors].map(([name, set]) => [name, [...set]])),
    },
    dialogColor: {
      opened: dialogOpen,
      hintShown,
      tickedBeforePick,
      tickedAfterPick,
      previewBeforePick,
      previewAfterPick,
      paintedChip: dialogListChips.find((chip) => /banking/i.test(chip.text)) ?? null,
      before: dialogBefore.map((account) =>
        tagEntries(account).map((entry) => `${entry.name}${entry.color}`)
      ),
      after: afterDialog.map((account) =>
        tagEntries(account).map((entry) => `${entry.name}${entry.color}`)
      ),
    },
    colorSplit: {
      offers: colorOffers,
      offersAfter: colorOffersAfter,
      confirm: colorConfirm,
      stored: afterColor.map((account) =>
        tagEntries(account).map((entry) => `${entry.name}${entry.color}`)
      ),
    },
    mergeButtonsAfter: await mergeButton.count(),
    addresses: after.map((account) => ({
      address: account.address,
      tags: (account.tags ?? []).map((entry) => `${entry.name}${entry.color}`),
      legacyTag: account.tag ?? null,
    })),
  };
  console.log(JSON.stringify(report, null, 2));

  if (hubBefore.mergeLabels.length !== 1)
    problems.push(
      `expected exactly one card to offer the merge, got ${hubBefore.mergeLabels.length}`
    );
  if (!hubBefore.ariaLabels[0]?.includes(TAG))
    problems.push('the merge was offered for a spelling other than the most-used one');
  if (!dialogMessage?.includes('Banking') || !dialogMessage.includes(TAG))
    problems.push('the confirm did not name both spellings');
  if (hubGrid.text.includes('@'))
    problems.push('the hub card still prints addresses its chip hover already names');
  if (report.mergeButtonsAfter !== 0)
    problems.push(`the merge offer survived the merge (${report.mergeButtonsAfter} left)`);

  for (const account of after) {
    const entries = tagEntries(account);
    const legacy = (account.tag ?? '').trim();
    if (entries.length === 0 && legacy.toLowerCase() !== TAG) continue;
    // One entry, spelled the canonical way - a second casing is the bug.
    if (entries.length > 1)
      problems.push(`${account.address} kept ${entries.length} entries for one tag`);
    for (const entry of entries) {
      if (entry.name !== TAG)
        problems.push(`${account.address} still writes the tag as ${entry.name}`);
    }
    if (entries.length === 0) problems.push(`${account.address} lost the tag from tags[]`);
    // The legacy mirror follows tags[0], so it must agree with it.
    else if (legacy !== entries[0]?.name)
      problems.push(`${account.address} legacy tag ${legacy} disagrees with tags[0]`);
  }

  const carriers = after.filter(
    (account) => tagEntries(account).length > 0 || (account.tag ?? '').trim().toLowerCase() === TAG
  );
  if (carriers.length !== 2)
    problems.push(`expected 2 addresses to keep the tag, got ${carriers.length}`);
  // The merge writes the tag's ONE color, so the two spellings cannot come out of
  // it still stored in two colors.
  const mergedColors = new Set(
    carriers.flatMap((account) => tagEntries(account).map((e) => e.color))
  );
  if (mergedColors.size !== 1)
    problems.push(`the merged tag is still stored in ${mergedColors.size} colors`);

  // ...and no chip paints the tag two ways, in either state, on any surface.
  for (const [where, byTag] of [
    ['spelling split', splitColors],
    ['color split', cleanedColors],
    ['dialog pick', dialogColors],
  ] as const) {
    for (const [name, colors] of byTag) {
      if (colors.size > 1)
        problems.push(
          `${where}: tag “${name}” is painted ${colors.size} colors: ${[...colors].join(' / ')}`
        );
    }
  }

  // ── The color cleanup, offered and applied on its own ─────────────────────
  if (colorOffers.labels.length !== 1)
    problems.push(`expected one color cleanup offer, got ${colorOffers.labels.length}`);
  if (!colorOffers.ariaLabels[0]?.includes(TAG))
    problems.push(`the color cleanup was offered for “${colorOffers.ariaLabels[0] ?? ''}”`);
  if (colorOffers.spellingOffers !== 0)
    problems.push('a color-only split was offered as a spelling merge');
  if (colorOffersAfter !== 0)
    problems.push(`the color offer survived the cleanup (${colorOffersAfter} left)`);
  if (!colorConfirm?.includes('#6366F1'))
    problems.push(`the color confirm did not name the color in use: ${colorConfirm}`);
  // Most-used wins - NOT first seen, which here would keep #EC4899.
  // ── A pick in the dialog is the tag's color ───────────────────────────────
  // The pick has to reach the addresses the message did NOT name: the two that
  // wrote the old majority color, not only the one the dialog was opened from.
  if (dialogOpen) {
    const picked = afterDialog.flatMap((account) => tagEntries(account).map((e) => e.color));
    const pickedCarriers = afterDialog.filter((account) => tagEntries(account).length > 0).length;
    if (pickedCarriers !== 3 || new Set(picked).size !== 1 || picked[0] !== PICKED_COLOR)
      problems.push(
        `the dialog pick reached ${pickedCarriers} addresses, colors ${[...new Set(picked)].join(' / ')}`
      );
  }

  // ── The palette TICKS the tag’s current color ─────────────────────────────
  //
  // The chip behind the dialog paints `buildTagColors`'s answer, not the color of
  // the one row the dialog was opened from - so the tick has to be there too, and
  // exactly one swatch may carry it. A palette with no mark at all reads as "this
  // tag has no color here", which is a different claim.
  if (dialogOpen) {
    if (tickedBeforePick.length !== 1 || tickedBeforePick[0] !== SEEDED_COLOR)
      problems.push(
        `the palette ticked ${JSON.stringify(tickedBeforePick)} instead of the tag’s color ${SEEDED_COLOR}`
      );
    if (tickedAfterPick.length !== 1 || tickedAfterPick[0] !== PICKED_COLOR)
      problems.push(
        `the palette ticked ${JSON.stringify(tickedAfterPick)} after picking Emerald (${PICKED_COLOR})`
      );
  }

  // ── The dialog's preview IS the chip the app will paint ───────────────────
  //
  // Pinned on both colors and the count, because a preview can match on the fill
  // and still disagree on the ink - that is exactly what two ink rules did.
  const paintedBanking = dialogListChips.find((chip) => /banking/i.test(chip.text));
  if (!previewBeforePick || !previewAfterPick) {
    problems.push('the tag dialog showed no preview of the chip it would change');
  } else {
    if (previewBeforePick.bg !== rgbCss(SEEDED_COLOR))
      problems.push(`the preview opened on ${previewBeforePick.bg}, not the tag’s own color`);
    if (previewAfterPick.bg === previewBeforePick.bg)
      problems.push(`the preview did not follow the palette (still ${previewAfterPick.bg})`);
    if (previewAfterPick.bg !== rgbCss(PICKED_COLOR))
      problems.push(`the preview shows ${previewAfterPick.bg} after picking Emerald`);
  }
  if (previewAfterPick && !paintedBanking) {
    problems.push('the address list painted no chip to compare the preview against');
  } else if (previewAfterPick && paintedBanking) {
    if (previewAfterPick.bg !== paintedBanking.bg)
      problems.push(
        `the preview and the painted chip disagree on the fill: ${previewAfterPick.bg} vs ${paintedBanking.bg}`
      );
    if (previewAfterPick.ink !== paintedBanking.ink)
      problems.push(
        `the preview and the painted chip disagree on the ink: ${previewAfterPick.ink} vs ${paintedBanking.ink}`
      );
    const previewCount = Number(previewAfterPick.text.match(/(\d+)\s*$/)?.[1] ?? '');
    const paintedCount = Number(paintedBanking.text.match(/(\d+)\s*$/)?.[1] ?? '');
    if (!Number.isFinite(previewCount) || previewCount !== paintedCount)
      problems.push(
        `the preview counts “${previewAfterPick.text}” while the chip counts “${paintedBanking.text}”`
      );
  }

  // ── The hub's own color cleanup ─────────────────────────────────
  if (afterColor.length > 0) {
    const unifiedColors = new Set(
      afterColor.flatMap((account) => tagEntries(account).map((entry) => entry.color))
    );
    if (unifiedColors.size !== 1 || !unifiedColors.has('#6366F1'))
      problems.push(
        `the color cleanup kept ${[...unifiedColors].join(' / ')} instead of the most-used #6366F1`
      );
  }

  // A chip's number and the addresses it hovers to name are ONE fact: the count
  // must equal the number of emails in the tooltip. Counting '@' makes the check
  // locale-proof (every email has exactly one, the label's prose has none).
  for (const [where, chips] of [
    ['hub', hubChips],
    ['address list (split live)', listChipsBefore],
    ['address list', listChips],
    ['mailbox', mailboxChips],
    ['hub (color split)', colorChipsBefore],
    ['address list (colors unified)', colorListChips],
    ['address list (dialog pick)', dialogListChips],
  ] as const) {
    if (chips.length === 0) problems.push(`${where} rendered no tag chip at all`);
    for (const chip of chips) {
      const count = Number(chip.text.match(/(\d+)\s*$/)?.[1] ?? '');
      const named = (chip.hover.match(/@/g) ?? []).length;
      if (!Number.isFinite(count) || count <= 0)
        problems.push(`${where} chip “${chip.text}” shows no address count`);
      else if (named !== count)
        problems.push(
          `${where} chip “${chip.text}” claims ${count} but hovers to name ${named} addresses`
        );
    }
  }
  // banking is on 2 addresses, shopping on 1 - in the hub and in the list.
  for (const [where, chips] of [
    ['hub', hubChips],
    ['address list (split live)', listChipsBefore],
    ['address list', listChips],
  ] as const) {
    const banking = chips.filter((chip) => /banking/.test(chip.text));
    if (banking.length === 0 || banking.some((chip) => !/(^|\D)2$/.test(chip.text)))
      problems.push(`${where} did not count “banking” on its 2 addresses`);
  }
  if (!hubChips.some((chip) => /shopping\s*1$/.test(chip.text) && chip.hover.includes('@')))
    problems.push('the hub did not count “shopping” on its single address');

  await context.close();
  if (problems.length > 0) {
    console.error(`\n✗ tag merge check failed\n  - ${problems.join('\n  - ')}`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ tag merge check passed - one spelling left, both schemas in step');
  }
}

await main();
