/**
 * Real-extension probe: no rendered icon is blank.
 *
 * The static gates prove a REFERENCE resolves (`check-icon-references` - the
 * catalog defines every name, whether reached through the attribute, a table
 * literal, or a same-file binding) and a catalog unit test proves every name has
 * geometry. Neither can see the thing the user sees, which is what this probe is
 * for: the built extension, loaded into Chromium, walked surface by surface.
 *
 * Two failure modes, and one handle for each:
 *
 *   1. A glyph that RENDERS but paints nothing - an empty `d`, a `{className}`
 *      placeholder left unreplaced, geometry in the wrong coordinate space
 *      (`0 0 24 24` under a `0 -960 960 960` viewBox draws sub-pixel), a CSS
 *      regression that zeroes or transparents the box. Measured here.
 *   2. A name that resolves to NOTHING - the class that actually shipped five
 *      blank icons when the catalog was renamed (`trash` → `delete`, `bell` →
 *      `notifications`, …). `Icon.svelte` returns `''` for an unknown name, so
 *      no node exists to measure; with `__ICON_PROBE__` set before the bundle
 *      runs the component tags every glyph it DOES render (`data-icon="<name>"`)
 *      and leaves a zero-size `data-icon-missing="<name>"` marker where it
 *      renders nothing. The flag is off in production, and this probe asserts
 *      that too (a page loaded without it carries no `[data-icon]` at all).
 *
 * The surfaces come from the source of truth, so neither can silently shrink:
 * every view id in `VIEW_LIST` (`src/features/types/view-types.ts`) is opened
 * through the app's own `?view=` handoff, and the icon-heavy overlays (More
 * menu, command palette, tag dialog) are opened the way a user opens them. A
 * surface that could not be opened FAILS the probe rather than quietly
 * subtracting itself.
 *
 * ALL THREE ENTRYPOINTS are walked, because sharing `AppLayout` does not make
 * them the same page. The layout ladder is width-driven
 * (`src/utils/ui/breakpoints.ts`), so `app.html` at popup width renders the
 * popup's nav island and More menu - a walk that only appended `app.html` to a
 * URL list would keep measuring the same chrome three times and the sidebar rail
 * would stay unseen. Each shell is therefore walked at a viewport where ITS
 * chrome renders: the popup at 360×640 and the sidepanel at 420×820 (both
 * narrow → floating nav island + Footer + More menu), the app shell at 1440×900
 * (≥ `LAYOUT_WIDE_MIN` → the sidebar rail, ≥ `LAYOUT_SPLIT_MIN` → the true
 * list|detail split). The rail's icon-only state - a separate render path with
 * its own buttons - is reached the way a user reaches it, by clicking the rail's
 * own collapse control, and the app walk asserts the rail is really there before
 * it claims to have covered it.
 *
 * One test per entrypoint, not one loop over all three: each shell walks ~30
 * page loads, and a single test made the whole walk a single verdict that named
 * no entrypoint - a hang or a failure in one shell read as the other two failing
 * with it, and there was no way to re-run just the shell under repair. Split,
 * every shell reports its own counts, keeps its own budget, and runs alone with
 * `-g "app:"` while iterating.
 *
 * An icon the user can only see under the pointer is PROVED, not excused. This
 * design language hides some controls until hover - `.split-collapse-btn` in
 * `SplitViewShell.svelte` is `opacity: 0` because it "appears on hover for
 * discoverability" - and the page cannot tell that from a glyph a CSS regression
 * faded out. So a faded icon is reported rather than judged, its own control is
 * hovered with a real mouse move, and the surface is measured again: one that
 * comes back is counted as revealed on hover, and one that does not is a blank.
 *
 * One case is reported but NOT failed, and named so it cannot hide: an icon the
 * open modal's scrim covers is `unproven`. It is hidden by the same hover
 * affordance as everywhere else, but the hover that would prove it cannot reach
 * it, so the probe says "not judged" and counts it rather than calling it either
 * way - the run's report prints the number, and an icon that is invisible for
 * real is still caught on the surface where nothing covers it.
 *
 * What this probe cannot see, stated because it is evidence and not a proof: an
 * icon inside a `display:none` subtree is SKIPPED (it is not rendered, so it has
 * no box to measure - an inactive panel is not a blank icon); ink is measured as
 * geometry clipped to the icon's own box, not as pixels, so a glyph that paints
 * the WRONG shape, or one clipped by an ancestor's `overflow`, passes here and
 * is a screenshot's business (`scripts/nav-shot.ts`); the rail's own flyouts (the
 * provider-create menu, the account selector) are not opened; and the app shell
 * must be online, because a wide layout that has not dismissed the offline
 * banner renders that banner INSTEAD of the rail (asserted, not assumed).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { extensionUrl } from './preview-harness';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Narrow shell: the popup's own 360×600 frame plus its chrome. */
const POPUP_VIEWPORT = { width: 360, height: 640 } as const;
/** Narrow shell: fluid width, below `LAYOUT_WIDE_MIN` (800), so the island renders. */
const SIDEPANEL_VIEWPORT = { width: 420, height: 820 } as const;
/**
 * Wide shell: above `LAYOUT_SPLIT_MIN` (1280), so the rail AND the 3-column
 * list|detail split both render - the widest layout the app has.
 */
const APP_VIEWPORT = { width: 1440, height: 900 } as const;
const SETTLE_MS = 400;

/**
 * The three entrypoints, each with the viewport where its own chrome renders and
 * the overlay surfaces it actually offers. A shell that renders no floating
 * Footer (the wide app shell replaces it with the rail) declares no `more-menu`,
 * and each shell's expected surface count is derived from this table, so the walk
 * cannot quietly drop a surface it promised.
 */
const SHELLS = [
  {
    id: 'popup',
    file: 'popup.html',
    viewport: POPUP_VIEWPORT,
    overlays: ['more-menu', 'command-palette', 'tag-dialog'],
  },
  {
    id: 'sidepanel',
    file: 'sidepanel.html',
    viewport: SIDEPANEL_VIEWPORT,
    overlays: ['more-menu', 'command-palette', 'tag-dialog'],
  },
  {
    id: 'app',
    file: 'app.html',
    viewport: APP_VIEWPORT,
    overlays: ['command-palette', 'tag-dialog', 'rail-icon-only'],
  },
] as const;

type Shell = (typeof SHELLS)[number];
type ShellId = Shell['id'];
type OverlayId = 'more-menu' | 'command-palette' | 'tag-dialog' | 'rail-icon-only';

/** The two detail panes, walked per shell with a selection live. */
const DETAIL_SURFACES = [
  { surface: 'detail:mail', view: 'mailView' },
  { surface: 'detail:address', view: 'addressView' },
] as const;

/** Content so every view renders its real icon set instead of an empty state. */
const PROBE_SEED = {
  demoMode: true,
  onboardingComplete: true,
  // The app shell's rail state, pinned so the wide walk starts from the LABELED
  // sidebar (whose collapse control then reaches the icon-only strip) rather
  // than from whatever density a previous run persisted.
  uiDensity: 'expanded',
  sidebarCollapsed: false,
  addresses: [
    {
      id: 'probe-inbox-1',
      address: 'probe.user@example.com',
      provider: 'demo',
      status: 'active',
      accountStatus: 'active',
      autoExtend: true,
      createdAt: Date.now() - 86_400_000,
      expiresAt: Date.now() + 86_400_000,
      token: 'probe-token-1',
      tags: [{ name: 'Shopping', color: '#7c4dff' }],
    },
    {
      id: 'probe-inbox-2',
      address: 'probe.checkout@example.com',
      provider: 'demo',
      status: 'active',
      accountStatus: 'active',
      autoExtend: false,
      createdAt: Date.now() - 172_800_000,
      expiresAt: Date.now() + 3_600_000,
      token: 'probe-token-2',
      tags: [{ name: 'Trials', color: '#0b8043' }],
    },
  ],
  emailStorageAddressIndex: {
    'probe-inbox-1': 'probe.user@example.com',
    'probe-inbox-2': 'probe.checkout@example.com',
  },
  'storedEmailsByAddress_probe-inbox-1': [
    {
      id: 'probe-mail-1',
      from: 'security@github.com',
      from_name: 'GitHub',
      subject: 'Your verification code',
      body_plain: 'Your verification code is 482901.',
      body_html: '<p>Your verification code is 482901.</p>',
      received_at: Date.now() - 60_000,
      unread: true,
      otp: '482901',
      isOtp: true,
      original_inbox: 'probe.user@example.com',
    },
  ],
  'storedEmailsByAddress_probe-inbox-2': [
    {
      id: 'probe-mail-2',
      from: 'noreply@shop.example',
      from_name: 'Shop',
      subject: 'Welcome code',
      body_plain: 'Welcome! Your code is WELCOME10.',
      body_html: '<p>Welcome! Your code is <b>WELCOME10</b>.</p>',
      received_at: Date.now() - 120_000,
      unread: false,
      original_inbox: 'probe.checkout@example.com',
    },
  ],
  emailStorageMetadata: {
    'probe-inbox-1': {
      messageCount: 1,
      unreadCount: 1,
      latestReceivedAt: Date.now() - 60_000,
      latestOtpAt: Date.now() - 60_000,
      hasMagicLink: false,
      revision: 2,
    },
    'probe-inbox-2': {
      messageCount: 1,
      unreadCount: 0,
      latestReceivedAt: Date.now() - 120_000,
      latestOtpAt: 0,
      hasMagicLink: false,
      revision: 1,
    },
  },
  readEmails: {},
  activeAddressId: 'probe-inbox-1',
  selectedEmail: 'probe.user@example.com',
  identities: [
    {
      id: 'probe-identity-1',
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'probe.user@example.com',
      phone: '+1 555 0100',
      address: { line1: '1 Example St', city: 'Seattle', region: 'WA', postalCode: '98101' },
      country: 'US',
      city: 'Seattle',
      isDefault: true,
      createdAt: Date.now() - 172_800_000,
    },
  ],
  selectedIdentityId: 'probe-identity-1',
  loginInfo: [
    {
      id: 'probe-login-1',
      domain: 'github.com',
      timestamp: Date.now() - 86_400_000,
      email: 'probe.user@example.com',
      username: 'alex.rivera92',
      password: 'ProbePass!234',
      website: 'https://github.com/signup',
      filledFields: ['email', 'password'],
      verified: true,
      verifiedAt: Date.now() - 86_000_000,
    },
  ],
  activityEvents: [
    {
      id: 'probe-act-1',
      type: 'address_created',
      timestamp: Date.now() - 3_600_000,
      data: { address: 'probe.user@example.com' },
    },
    {
      id: 'probe-act-2',
      type: 'otp_detected',
      timestamp: Date.now() - 60_000,
      data: { address: 'probe.user@example.com', otp: '482901' },
    },
  ],
  analytics: {
    createdAt: Date.now() - 604_800_000,
    accountsCreated: 2,
    emailsReceived: 2,
    otpsDetected: 1,
    notificationsSent: 1,
    extensionOpens: 5,
    emailsRead: 1,
    pageVisits: { mailbox: 4, addresses: 2 },
    performance: {
      emailFetchTimes: [180, 240],
      providerLatency: { demo: [320] },
      uiRenderTimes: [18, 22],
    },
  },
  mailboxTagCatalog: [
    { tag: 'Shopping', color: '#7c4dff' },
    { tag: 'Trials', color: '#0b8043' },
  ],
  mailboxRules: [
    {
      id: 'probe-rule-1',
      name: 'Silence store promos',
      enabled: true,
      field: 'sender',
      contains: 'shop.example',
      silenceNotifications: true,
      createdAt: Date.now() - 86_400_000,
      updatedAt: Date.now() - 86_400_000,
    },
  ],
  emailLabelCatalog: [{ name: 'Receipts', color: '#0b8043' }],
  savedSearchFilters: [
    {
      id: 'probe-filter-1',
      name: 'OTP only',
      searchQuery: '',
      hasOTP: true,
      senderDomain: '',
      selectedSenders: [],
      dateFrom: '',
      dateTo: '',
      createdAt: Date.now() - 86_400_000,
    },
  ],
  siteRules: [
    {
      id: 'probe-site-1',
      name: 'GitHub uses Alex Rivera',
      enabled: true,
      domainPattern: 'github.com',
      identityId: 'probe-identity-1',
      createdAt: Date.now() - 86_400_000,
      updatedAt: Date.now() - 86_400_000,
    },
  ],
};

/**
 * How a chrome surface is opened: `setup` loads the page it lives on, `open`
 * does the user action, `ready` is the element that proves it opened (so an
 * overlay that failed to appear is a failure, not a smaller walk), and `close`
 * restores the page for the next surface.
 */
interface ChromeWalk {
  setup?: () => Promise<void>;
  open: () => Promise<void>;
  ready: () => Promise<void>;
  close?: () => Promise<void>;
}

/** A locally reported icon that rendered but paints nothing. */
interface IconProblem {
  surface: string;
  name: string;
  problems: string[];
}

/** One surface's verdict. */
interface Scan {
  /** `<shell>:<surface>`, e.g. `app:view:mailbox`. */
  surface: string;
  /** The entrypoint the surface was measured in, for the per-shell report. */
  shell: ShellId;
  /** The names seen on this surface, for the run's coverage report. */
  names: string[];
  /** Icons the probe tagged - 0 means the flag never reached the bundle. */
  tagged: number;
  /** Tagged icons that are rendered and paint ink. */
  painted: number;
  /**
   * Tagged icons the user cannot see on this surface: inside a not-rendered
   * subtree (inactive panel, closed menu) or painted over (a modal's scrim).
   */
  skipped: number;
  /** Names that resolved to no glyph at all - the blank-icon failure. */
  missing: string[];
  /**
   * Names inside an `opacity:0` subtree on this pass - neither painted nor
   * skipped, because the page cannot tell a hover-revealed control from a
   * regression. Empty on a surface whose second pass revealed them all.
   */
  blind: string[];
  /** Of `blind`, the ones something else is painted over - see `unproven`. */
  blocked: string[];
  /** How many faded icons the hover pass brought into view on this surface. */
  revealed: number;
  /**
   * Of `blind`, the ones left unjudged because a modal's scrim covers them: the
   * glyph is hidden by the same hover affordance as everywhere else, but the
   * thing that would prove it (a hover) cannot reach it. Not a failure - see the
   * header - and not silent either: every one is named in the run's report.
   */
  unproven: number;
  problems: IconProblem[];
}

/** Read English copy from the shipped locale so a copy edit cannot break the walk. */
function en(key: string): string {
  const dict = JSON.parse(
    readFileSync(join(PROJECT_ROOT, 'src/locales/en.json'), 'utf8')
  ) as Record<string, unknown>;
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      dict
    );
  expect(typeof value, `en.json has no ${key}`).toBe('string');
  return String(value);
}

/**
 * Every view id the union declares, read from the runtime registry rather than
 * hand-listed, so a view added to `VIEW_LIST` is walked by the next run.
 */
function declaredViews(): string[] {
  const source = readFileSync(join(PROJECT_ROOT, 'src/features/types/view-types.ts'), 'utf8');
  const block = /const VIEW_LIST = \[([\s\S]*?)\] as const satisfies/.exec(source)?.[1] ?? '';
  const views = [...block.matchAll(/'([A-Za-z0-9_]+)'/g)].map((match) => match[1] as string);
  // A silent parse failure would walk nothing and pass.
  expect(views.length, 'VIEW_LIST could not be read from view-types.ts').toBeGreaterThan(15);
  return views;
}

/** Every view id the walk opens, read once so the surfaces and counts agree. */
const VIEWS = declaredViews();

/**
 * Exactly how many surfaces a shell's walk must produce: every declared view plus
 * both detail panes, the cold shell, and that shell's own overlays. Derived from
 * the tables the walk itself iterates, so it cannot drift out of step with them -
 * a shell or a surface that silently stopped being walked fails this count
 * instead of quietly shrinking the run.
 */
function expectedSurfaces(shell: Shell): number {
  return VIEWS.length + DETAIL_SURFACES.length + 1 + shell.overlays.length;
}

/**
 * Non-vacuity floors, each far below what a shell measures today. A single
 * aggregate floor would pass while one entrypoint rendered the other shell's
 * chrome, which is the failure this walk was widened to catch.
 */
const PAINTED_FLOOR = 40;
const GLYPH_FLOOR = 15;

/**
 * Measure every icon the probe tagged on the page that is currently loaded.
 *
 * The label is `<shell>:<surface>` - the shell is part of the label so a failure
 * names the entrypoint, and it is carried back as its own field so the run can
 * report (and floor) coverage per shell instead of in one aggregate.
 */
async function scanIcons(page: Page, shell: ShellId, surface: string): Promise<Scan> {
  const label = `${shell}:${surface}`;
  return page.evaluate(
    ({ label: surfaceLabel, shellId }: { label: string; shellId: ShellId }) => {
      const GEOMETRY = 'path,circle,rect,line,polygon,polyline,ellipse';

      /** A paint that shows: `none`, `transparent` and alpha 0 do not. */
      const paints = (color: string): boolean => {
        if (!color || color === 'none' || color === 'transparent') return false;
        const args = /rgba?\(([^)]+)\)/.exec(color)?.[1];
        if (!args) return true;
        const parts = args.split(',').map((part) => Number.parseFloat(part));
        return parts.length < 4 || (parts[3] ?? 1) > 0;
      };

      /** Is the icon rendered at all? An icon in a closed panel is not. */
      const rendered = (el: Element): boolean => {
        const box = el.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return false;
        const style = getComputedStyle(el);
        return style.visibility !== 'hidden' && style.visibility !== 'collapse';
      };

      /**
       * Is something else painted over the icon's own centre?
       *
       * The command palette's scrim covers the whole shell behind it, so the
       * split-pane chevron underneath is not an icon the user can see - it is a
       * glyph a layout sits on top of, which is a layout question, not a glyph
       * one (and the same chevron IS measured on the surfaces where nothing
       * covers it).
       *
       * The point resolving INTO the icon counts as visible, and so does an
       * ANCESTOR of it: a decorative glyph is routinely `pointer-events: none`,
       * so `elementFromPoint` answers with the button around it - still this
       * icon's own box being painted. Leniency in that direction is deliberate:
       * a wrongly-skipped icon is a hole in the walk, while a wrongly-measured
       * one is simply measured.
       */
      const obscured = (el: Element): boolean => {
        const box = el.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        // Off-viewport: there is nothing to hit-test. A row in a scrolled list is
        // still rendered content, and every icon there has to be measured once
        // (that list is the only surface that carries it), so it is NOT skipped.
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
        const top = document.elementFromPoint(x, y);
        if (!top) return false;
        return !(top === el || el.contains(top) || top.contains(el));
      };

      const tagged = [...document.querySelectorAll('[data-icon]')];
      const missing = [...document.querySelectorAll('[data-icon-missing]')].map(
        (el) => el.getAttribute('data-icon-missing') ?? ''
      );
      const problems: IconProblem[] = [];
      // A previous measurement's markers are cleared first, so the markers always
      // describe THIS pass.
      for (const stale of document.querySelectorAll('[data-icon-blind]')) {
        stale.removeAttribute('data-icon-blind');
        stale.removeAttribute('data-icon-blocked');
      }
      const blind: string[] = [];
      const blocked: string[] = [];
      let painted = 0;
      let skipped = 0;

      for (const svg of tagged) {
        const name = svg.getAttribute('data-icon') ?? '';
        if (!rendered(svg)) {
          skipped += 1;
          continue;
        }

        const issues: string[] = [];
        const box = svg.getBoundingClientRect();
        const viewBox = (svg as SVGSVGElement).viewBox?.baseVal;
        if (!viewBox || viewBox.width <= 0 || viewBox.height <= 0) issues.push('no viewBox');

        const kids = [...svg.querySelectorAll(GEOMETRY)];
        if (kids.length === 0) issues.push('no geometry');
        // Drawn = has geometry IS drawn: an empty `d`, or a path whose bbox has no
        // extent, is the "catalog entry with no glyph" case.
        const drawn = kids.filter((kid) => {
          if (kid.tagName.toLowerCase() === 'path' && !(kid.getAttribute('d') ?? '').trim()) {
            return false;
          }
          const bbox = (kid as SVGGraphicsElement).getBBox();
          return bbox.width > 0 && bbox.height > 0;
        });
        if (kids.length > 0 && drawn.length === 0) issues.push('geometry has no extent');

        // Ink = the area a drawn child actually occupies inside the icon's own box
        // (an SVG clips to its viewport). Summed, with a 1px² floor: a glyph drawn
        // in the wrong coordinate space lands far below it.
        let inkPx = 0;
        for (const kid of drawn) {
          const style = getComputedStyle(kid);
          if (!paints(style.fill) && !paints(style.stroke)) continue;
          const child = kid.getBoundingClientRect();
          const width = Math.min(child.right, box.right) - Math.max(child.left, box.left);
          const height = Math.min(child.bottom, box.bottom) - Math.max(child.top, box.top);
          if (width > 0 && height > 0) inkPx += width * height;
        }
        if (drawn.length > 0 && inkPx < 1) {
          issues.push(`no ink inside the icon box (${inkPx.toFixed(2)}px²)`);
        }

        // Opacity does not change the box, so a faded-out ancestor needs its own
        // walk - and it is NOT judged here: this design language hides some
        // controls until hover (`.split-collapse-btn` in `SplitViewShell.svelte`
        // "appears on hover for discoverability"), so the page cannot tell a hover
        // affordance from a regression. It marks the element and reports the name;
        // the driver hovers its control and measures again.
        let faded = false;
        for (let node: Element | null = svg; node; node = node.parentElement) {
          if (Number(getComputedStyle(node).opacity) === 0) {
            faded = true;
            break;
          }
        }
        if (faded) {
          svg.setAttribute('data-icon-blind', name);
          // Only a FADED icon needs a hover to be judged, so only a faded icon is
          // hit-tested. Measuring every icon this way would drop the ones a
          // sticky header happens to cover as it scrolls - icons no other surface
          // carries - while for a faded one the answer decides whether proving it
          // is even possible.
          if (obscured(svg)) {
            svg.setAttribute('data-icon-blocked', '1');
            blocked.push(name);
          }
          blind.push(name);
          continue;
        }

        if (issues.length > 0) problems.push({ surface: surfaceLabel, name, problems: issues });
        else painted += 1;
      }

      return {
        surface: surfaceLabel,
        shell: shellId,
        names: tagged.map((svg) => svg.getAttribute('data-icon') ?? ''),
        tagged: tagged.length,
        painted,
        skipped,
        missing,
        blind,
        blocked,
        revealed: 0,
        unproven: 0,
        problems,
      };
    },
    { label, shellId: shell }
  );
}

/** A hover-revealed control fades in over 150ms; give the transition time to land. */
const REVEAL_SETTLE_MS = 250;

/**
 * Prove the icons the last page-side pass reported as faded.
 *
 * Each is addressed through its own control - the nearest `button` ancestor, or
 * the icon itself when there is none - and hovered with a real mouse move, which
 * is what fires `:hover` in CSS. Returns the ones that could not be hovered at
 * all, so a failure there is reported as its cause rather than as "invisible".
 */
async function revealFadedIcons(page: Page): Promise<string[]> {
  const stuck: string[] = [];
  const faded = page.locator('[data-icon-blind]');
  const count = await faded.count();
  let attempted = 0;
  for (let index = 0; index < count; index += 1) {
    const icon = faded.nth(index);
    // Covered by a modal's scrim: nothing to prove, so nothing is attempted.
    if ((await icon.getAttribute('data-icon-blocked')) === '1') continue;
    const name = (await icon.getAttribute('data-icon-blind')) ?? '';
    attempted += 1;
    try {
      const control = icon.locator('xpath=ancestor::button[1]');
      if ((await control.count()) > 0) await control.first().hover();
      else await icon.hover();
    } catch (error) {
      stuck.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (attempted > 0) await page.waitForTimeout(REVEAL_SETTLE_MS);
  return stuck;
}

/** A shell's walk, collected so the test can assert on it in one place. */
interface ShellWalk {
  scans: Scan[];
  /** Surfaces the walk promised but could not open. */
  unreached: string[];
  /** Uncaught page errors the walk saw. */
  pageErrors: string[];
  /** Probe artifacts the production markup carried BEFORE the flag was installed. */
  productionTrace: number;
}

/**
 * Walk one entrypoint end to end: seed storage, prove the production markup
 * carries no probe trace, install the trace, then open every view, both detail
 * panes, the cold shell and that shell's overlays.
 *
 * `go()` - and so every surface here - is bound to ONE shell, because the shell
 * is what decides the viewport, and the viewport is what decides which chrome
 * renders. That binding is the whole point of walking three entrypoints, so it
 * lives here rather than in a per-surface parameter a caller could get wrong.
 */
async function walkShell(page: Page, shell: Shell, origin: string): Promise<ShellWalk> {
  const scans: Scan[] = [];
  const unreached: string[] = [];
  const pageErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));

  // Every interaction is bounded. Playwright's default ACTION timeout is 0 -
  // unbounded - so a click on a control an open dialog is covering retries until
  // the test's own 900s budget expires and the run reports nothing: exactly how
  // this walk first failed, hanging on the collapsed rail behind a tag dialog
  // nobody had closed. Ten seconds is far more than a real control needs, and a
  // control that really is unreachable now fails naming itself.
  page.setDefaultTimeout(10_000);

  const fail = (label: string, error: unknown): string =>
    `${label}: ${error instanceof Error ? error.message : String(error)}`;

  /**
   * Open one page of this shell: the viewport its chrome needs, the entrypoint,
   * and a settle long enough for the layout measurement to land.
   */
  const go = async (url: string): Promise<void> => {
    await page.setViewportSize(shell.viewport);
    // Finish the current document's network replies before replacing it.
    // WebKit reports cross-origin requests canceled by navigation as errors,
    // even when the fixture has already supplied a valid CORS response.
    if (page.context().browser()?.browserType().name() === 'webkit') {
      await page.waitForLoadState('networkidle');
    }
    await page.goto(url);
    await page.waitForSelector('#app > *', { timeout: 10_000 });
    // The first child may still be the locale skeleton. Do not record a
    // zero-icon surface while the shell or its lazy view is still loading.
    await page.locator('.view-crossfade').first().waitFor({ state: 'visible' });
    await expect(page.locator('.view-crossfade [aria-busy="true"]')).toHaveCount(0);
    await expect(page.locator('#app svg').first()).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);
  };

  /**
   * The chrome surfaces, each opened the way the user opens it. The copy these
   * controls carry is read from the shipped locale, so a copy edit cannot
   * silently retire a selector and shrink the walk.
   *
   * Named `chromeSurfaces`, not `chrome`: inside `page.evaluate` the global
   * `chrome` API is what seeds storage, and a local of that name would shadow it.
   */
  const chromeSurfaces: Record<OverlayId, ChromeWalk> = {
    'more-menu': {
      open: async () => {
        await page
          .getByRole('navigation', { name: en('nav.mainNav') })
          .getByRole('button', { name: en('nav.more') })
          .first()
          .press('Enter');
      },
      ready: async () => {
        await page.locator('[role="menu"]').first().waitFor({ state: 'visible' });
      },
      close: async () => {
        await page.keyboard.press('Escape');
      },
    },
    'command-palette': {
      open: async () => {
        await page.keyboard.press('Control+k');
      },
      ready: async () => {
        await page.locator('[role="listbox"]').first().waitFor({ state: 'visible' });
      },
      close: async () => {
        await page.keyboard.press('Escape');
      },
    },
    // Reached from the Organize hub's own edit button - the hub the tag chips
    // live on - whose accessible name comes from the shipped locale.
    'tag-dialog': {
      setup: async () => {
        await go(`${origin}/${shell.file}?view=organize`);
      },
      open: async () => {
        const editTagLabel = en('tagManagement.editTag').replace('{name}', 'Shopping');
        await page.locator(`[aria-label="${editTagLabel}"]`).first().click();
      },
      ready: async () => {
        await page.locator('[role="dialog"]').first().waitFor({ state: 'visible' });
      },
      // A modal dialog left open covers the whole page, so a later surface in the
      // same shell could not be opened at all (the rail's collapse control sits
      // behind its backdrop). Escape is the user's own way out.
      close: async () => {
        await page.keyboard.press('Escape');
        await page.locator('[role="dialog"]').first().waitFor({ state: 'hidden' });
      },
    },
    // The compact icon-only sidebar, a separate render path from the labeled
    // one. Collapsing is a real user action; expanding again afterwards leaves
    // the persisted density as the run found it.
    'rail-icon-only': {
      open: async () => {
        await page
          .getByRole('button', { name: en('common.collapseSidebar') })
          .first()
          .click();
      },
      ready: async () => {
        await page
          .getByRole('button', { name: en('common.expandSidebar') })
          .first()
          .waitFor({ state: 'visible' });
      },
      close: async () => {
        await page
          .getByRole('button', { name: en('common.expandSidebar') })
          .first()
          .click();
      },
    },
  };

  // Seed before the first real load: every entrypoint reads the same
  // `chrome.storage.local`, so one seed covers all three shells.
  await page.setViewportSize(shell.viewport);
  await page.evaluate(
    (seed) =>
      new Promise<void>((resolve) => {
        chrome.storage.local.set(seed, () => resolve());
      }),
    PROBE_SEED
  );

  // The probe trace must not exist where nobody asked for it. Checked on the
  // production payload BEFORE the flag is installed, because the flag would
  // otherwise mask exactly the leak this asserts against.
  await go(`${origin}/${shell.file}`);
  const productionTrace = await page
    .locator('[data-icon], [data-icon-missing], [data-icon-blind]')
    .count();

  // From here on every navigation in this shell runs with the trace on.
  await page.addInitScript(() => {
    (globalThis as { __ICON_PROBE__?: boolean }).__ICON_PROBE__ = true;
  });

  /**
   * Per-surface progress: a walk that stalls names the surface it stalled on
   * instead of leaving a silent gap in the transcript, and a surface that found
   * something names WHAT it found - the failure counts alone mean another run to
   * learn which icon and why.
   */
  const report = (scan: Scan): void => {
    const detail = [
      ...scan.missing.map((name) => `UNRESOLVED ${name}`),
      ...scan.problems.map((found) => `BLANK ${found.name} (${found.problems.join('; ')})`),
    ];
    console.log(
      `[icon-render] ${scan.surface}: ${scan.painted}/${scan.tagged} painted` +
        (scan.revealed > 0 ? ` · ${scan.revealed} revealed on hover` : '') +
        (scan.unproven > 0 ? ` · ${scan.unproven} unproven (behind a modal)` : '') +
        (detail.length > 0 ? ` · ${detail.join(' · ')}` : '')
    );
  };

  /**
   * Measure one surface.
   *
   * A surface the page reported faded icons on is measured TWICE: once to find
   * them, then once after hovering each one's control. That is what makes the
   * verdict honest in both directions - a control this design language reveals on
   * hover (the split-pane collapse chevron, `opacity: 0` until you reach for it)
   * is PROVED visible instead of failed, and an icon no hover brings back stays a
   * finding instead of being waved through as "hidden by design".
   */
  const measure = async (surface: string): Promise<Scan> => {
    const first = await scanIcons(page, shell.id, surface);
    if (first.blind.length === 0) return first;

    const stuck = await revealFadedIcons(page);
    const second = await scanIcons(page, shell.id, surface);
    const provable = (scan: Scan): number => scan.blind.length - scan.blocked.length;
    second.revealed = provable(first) - provable(second);
    second.unproven = second.blocked.length;
    for (const name of second.blind) {
      // Covered by a modal: reported as unproven rather than failed.
      if (second.blocked.includes(name)) continue;
      const failure = stuck.find((entry) => entry.startsWith(`${name}:`));
      second.problems.push({
        surface: second.surface,
        name,
        problems: [
          failure
            ? `invisible after hover (${failure.slice(failure.indexOf(':') + 1).trim()})`
            : 'invisible (opacity:0 subtree, no hover reveal)',
        ],
      });
    }
    return second;
  };

  const show = async (surface: string, url: string): Promise<void> => {
    await go(url);
    const scan = await measure(surface);
    scans.push(scan);
    report(scan);
  };

  /** Do something the user does (open a menu, press a shortcut) and measure what appears. */
  const openThenScan = async (overlay: OverlayId, walk: ChromeWalk): Promise<void> => {
    const label = `${shell.id}:overlay:${overlay}`;
    try {
      await walk.setup?.();
      await walk.open();
      await walk.ready();
    } catch (error) {
      unreached.push(fail(label, error));
      return;
    }
    await page.waitForTimeout(SETTLE_MS);
    const scan = await measure(`overlay:${overlay}`);
    scans.push(scan);
    report(scan);
    if (walk.close) {
      try {
        await walk.close();
        await page.waitForTimeout(SETTLE_MS);
      } catch (error) {
        unreached.push(fail(`${label} (close)`, error));
      }
    }
  };

  // The rail is the app shell's chrome, so a wide walk that never rendered it
  // would report the same island three times under three names. Asserted BEFORE
  // the views, because a failure here means this shell's premise is wrong.
  if (shell.id === 'app') {
    await go(`${origin}/${shell.file}`);
    expect(
      await page.locator('aside.sidebar-nav').count(),
      `app at ${APP_VIEWPORT.width}x${APP_VIEWPORT.height} must render its sidebar rail ` +
        '(a wide layout with an undismissed offline banner renders that banner instead)'
    ).toBe(1);
  }

  // Every declared view through the app's own `?view=` handoff, both detail
  // panes with a selection live, the cold shell (no params - the real entry
  // path), and the overlays this shell offers.
  for (const view of VIEWS) {
    await show(`view:${view}`, `${origin}/${shell.file}?view=${view}`);
  }
  for (const detail of DETAIL_SURFACES) {
    await show(detail.surface, `${origin}/${shell.file}?view=${detail.view}`);
  }
  await show('shell:home', `${origin}/${shell.file}`);
  for (const id of shell.overlays) {
    await openThenScan(id, chromeSurfaces[id]);
  }

  return { scans, unreached, pageErrors, productionTrace };
}

test.describe('Icon render probe', () => {
  for (const shell of SHELLS) {
    test(`${shell.id}: every icon the built extension renders paints`, async ({
      extensionPage,
      extensionId,
    }) => {
      // Every declared view, both detail panes, the cold shell and this shell's
      // overlays - roughly 30 page loads, so the per-test default of 30s is far
      // too short and CI machines are slow.
      test.setTimeout(900_000);
      const walk = await walkShell(
        extensionPage,
        shell,
        extensionUrl(extensionId).replace(/\/$/, '')
      );

      // ── Verdicts ──────────────────────────────────────────────────────────
      const blanks = walk.scans.flatMap((scan) => scan.problems);
      const missing = walk.scans.flatMap((scan) =>
        scan.missing.map((name) => `${scan.surface}: ${name}`)
      );
      const vacuous = walk.scans.filter((scan) => scan.tagged === 0).map((scan) => scan.surface);
      const sum = (field: 'tagged' | 'painted' | 'skipped' | 'revealed' | 'unproven'): number =>
        walk.scans.reduce((total, scan) => total + scan[field], 0);
      const tagged = sum('tagged');
      const painted = sum('painted');
      const skipped = sum('skipped');
      const revealed = sum('revealed');
      const unproven = sum('unproven');
      const glyphs = new Set(walk.scans.flatMap((scan) => scan.names));

      // The verdict as the run actually found it - evidence in the transcript,
      // not only on failure.
      console.log(
        `[icon-render] ${shell.id}: ${walk.scans.length} surfaces · ${painted}/${tagged} icons painted · ` +
          `${glyphs.size} distinct glyphs · ${skipped} not rendered · ` +
          `${revealed} revealed on hover · ${unproven} unproven (behind a modal) · ` +
          `${missing.length} unresolved · ${blanks.length} blank`
      );

      expect(walk.productionTrace, `${shell.id} production markup must carry no probe trace`).toBe(
        0
      );
      expect(walk.unreached, 'a surface the walk promised could not be opened').toEqual([]);
      expect(
        walk.scans.length,
        `walked ${walk.scans.length} surfaces, expected ${expectedSurfaces(shell)} - ` +
          'a view or an overlay dropped out'
      ).toBe(expectedSurfaces(shell));
      expect(vacuous, 'surfaces with no tagged icon - the probe trace never arrived').toEqual([]);
      expect(missing, 'icon names that resolved to no glyph').toEqual([]);
      expect(blanks, 'icons that rendered but paint nothing').toEqual([]);
      // Non-vacuity: a run that measured almost nothing is the same silence as a
      // bug. The floors sit well under what each shell measures today, so they
      // catch a walk that stopped reaching surfaces rather than pinning counts.
      expect(
        painted,
        `${shell.id} painted only ${painted} of ${tagged} tagged icons`
      ).toBeGreaterThan(PAINTED_FLOOR);
      expect(
        glyphs.size,
        `${shell.id} rendered only ${glyphs.size} distinct glyphs`
      ).toBeGreaterThan(GLYPH_FLOOR);
      expect(walk.pageErrors, 'the app threw while the probe walked it').toEqual([]);
    });
  }
});
