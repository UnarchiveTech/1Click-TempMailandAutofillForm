<script lang="ts">
import { onDestroy, onMount, tick, untrack } from 'svelte';
import { cubicOut } from 'svelte/easing';
import { SvelteSet } from 'svelte/reactivity';
import { slide } from 'svelte/transition';
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import ButtonGroup from '@/ui/components/composites/ButtonGroup.svelte';
import FloatingAction from '@/ui/components/composites/FloatingAction.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import Avatar from '@/ui/components/primitives/Avatar.svelte';
import Badge from '@/ui/components/primitives/Badge.svelte';
import Btn from '@/ui/components/primitives/Btn.svelte';
import { CONSTANTS } from '@/utils/constants.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { AVATAR_BOX } from '@/utils/ui/avatar-size.js';
import { useReducedMotion } from '@/utils/ui/reduced-motion.svelte.js';

interface Props {
  version: string;
  /** Contextual FAB back action → navigate to the page shown before About. */
  onBack?: () => void;
  onStartProductTour?: () => void;
  onOpenKeyboardShortcuts?: () => void;
  onOpenDiagnostics?: () => void;
}
let {
  version,
  onBack = () => {},
  onStartProductTour,
  onOpenKeyboardShortcuts,
  onOpenDiagnostics,
}: Props = $props();
let sourceCodeOpen = $state(false);

const FAQ_IDS = [
  'otp',
  'autofill',
  'export',
  'privacy',
  'renew',
  'tour',
  'autofillHelp',
  'identityRouting',
  'loginExport',
] as const;
let openFaq = $state<string | null>('otp');
/** When true, every FAQ answer is expanded */
let faqExpandAll = $state(false);
const motionPreference = useReducedMotion();

function isFaqOpen(id: string): boolean {
  return faqExpandAll || openFaq === id;
}

function toggleFaqItem(id: string) {
  if (faqExpandAll) {
    // Leaving expand-all: collapse all then open only this one (or leave closed)
    faqExpandAll = false;
    openFaq = id;
    return;
  }
  openFaq = openFaq === id ? null : id;
}

function setExpandAllFaqs(expand: boolean) {
  faqExpandAll = expand;
  if (!expand) openFaq = null;
}

/**
 * FAQ grid columns (1-3). Chosen by measuring each localized question’s
 * natural single-line width (padding + label + expand icon) against the
 * container - language-agnostic, no font shrinking / wrapping / ellipsis.
 */
/** Number of FAQ columns that fit (1 … N); no hard cap at 3 */
let faqCols = $state(1);
/**
 * The grid starts at 1 column until the first measurement lands; painting that
 * state would flash a 1-column layout that immediately reflows to N (a visible
 * shift). The grid stays invisible until the measured count is applied.
 */
let faqLayoutReady = $state(false);
let faqGridEl = $state<HTMLElement | null>(null);
let faqMeasureRowEl = $state<HTMLElement | null>(null);
let faqMeasureTextEl = $state<HTMLElement | null>(null);
let faqMeasureRaf = 0;

/** Matches .faq-grid gap-2 (0.5rem). Read from computed style when possible. */
const FAQ_GAP_FALLBACK_PX = 8;

type GhContributor = { login: string; html_url: string; avatar_url: string; contributions: number };

const CONTRIBUTORS_CACHE_KEY = 'githubContributorsCache_v1';
const CACHE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

/**
 * Fallback when the API is unavailable. Logins are real GitHub handles (they
 * key the avatar URL and resolve to the same profile as html_url), not
 * display names - an avatar built from 'Tejas Mate' hashes differently from
 * github.com/tejas-mate's own.
 */
const FALLBACK_CONTRIBUTORS: GhContributor[] = [
  {
    login: 'tejas-mate',
    html_url: 'https://github.com/tejas-mate',
    avatar_url: '',
    contributions: 0,
  },
  {
    login: 'enzo-davico',
    html_url: 'https://github.com/enzo-davico',
    avatar_url: '',
    contributions: 0,
  },
];

let contributors = $state<GhContributor[]>(FALLBACK_CONTRIBUTORS);
/**
 * Resolves async (chrome.management.getSelf). Null until known - the badge is
 * hidden in the meantime so no placeholder ever paints. detectInstallType
 * always resolves to at least 'Other', so the badge always appears.
 */
let installationType = $state<string | null>(null);
/** GitHub avatars can fail (rate-limit placeholder / offline); recover by falling back to the letter avatar. */
let brokenAvatars = $state(new SvelteSet<string>());

/**
 * Measure natural width of one FAQ question row using a hidden probe that
 * mirrors the real button chrome (padding, gap, icon size, font).
 */
function measureFaqQuestionWidth(question: string): number {
  if (!faqMeasureRowEl || !faqMeasureTextEl) return 0;
  faqMeasureTextEl.textContent = question;
  // scrollWidth/offsetWidth both work; ceil avoids subpixel under-fit
  return Math.ceil(faqMeasureRowEl.getBoundingClientRect().width);
}

function faqGapPx(grid: HTMLElement): number {
  const cs = getComputedStyle(grid);
  const gap = parseFloat(cs.columnGap || cs.gap || '');
  return Number.isFinite(gap) && gap >= 0 ? gap : FAQ_GAP_FALLBACK_PX;
}

/**
 * Highest column count (up to item count) where every measured question fits
 * in one grid track without wrapping. Language-agnostic: only measured widths.
 */
function pickFaqColumns(containerWidth: number, questionWidths: number[]): number {
  if (containerWidth <= 0 || questionWidths.length === 0) return 1;
  const grid = faqGridEl;
  const gap = grid ? faqGapPx(grid) : FAQ_GAP_FALLBACK_PX;
  // .faq-item uses 1px border + border-box → content (button) is 2px narrower than track
  const cardBorderInset = 2;
  const epsilon = 0.5;
  const maxCols = Math.max(1, questionWidths.length);
  for (let cols = maxCols; cols >= 1; cols--) {
    const track = (containerWidth - gap * (cols - 1)) / cols;
    const contentBox = track - cardBorderInset;
    if (questionWidths.every((w) => w <= contentBox + epsilon)) {
      return cols;
    }
  }
  return 1;
}

async function recomputeFaqColumns() {
  if (typeof document === 'undefined') return;
  await tick();
  const grid = faqGridEl;
  if (!grid || !faqMeasureRowEl || !faqMeasureTextEl) return;

  const containerWidth = grid.clientWidth;
  if (containerWidth <= 0) return;

  // Read each localized string through $t so locale changes re-run this path
  const widths = FAQ_IDS.map((id) => {
    const q = String($t(`about.faq.${id}.q`) ?? '');
    return measureFaqQuestionWidth(q);
  });

  const next = pickFaqColumns(containerWidth, widths);
  if (next !== faqCols) faqCols = next;
  faqLayoutReady = true;
}

function scheduleFaqRecompute() {
  if (typeof window === 'undefined') return;
  if (faqMeasureRaf) cancelAnimationFrame(faqMeasureRaf);
  faqMeasureRaf = requestAnimationFrame(() => {
    faqMeasureRaf = 0;
    void recomputeFaqColumns();
  });
}

function mapInstallType(raw: string | undefined): string {
  switch ((raw || '').toLowerCase()) {
    case 'development':
      return $t('about.installTypeDevelopment') as string;
    case 'normal':
      return $t('about.installTypeNormal') as string;
    case 'sideload':
      return $t('about.installTypeSideload') as string;
    case 'admin':
      return $t('about.installTypeAdmin') as string;
    default:
      return raw ? String(raw) : ($t('about.installTypeOther') as string);
  }
}

async function detectInstallType(): Promise<string> {
  // chrome.management.getSelf → installType: development | normal | sideload | admin
  try {
    const mgmt = (
      globalThis as unknown as {
        chrome?: {
          management?: { getSelf?: (cb: (info: { installType?: string }) => void) => void };
        };
      }
    ).chrome?.management;
    if (mgmt?.getSelf) {
      const getSelf = mgmt.getSelf;
      const info = await new Promise<{ installType?: string }>((resolve) => {
        try {
          getSelf((i) => resolve(i || {}));
        } catch {
          /* ignore */
          resolve({});
        }
      });
      if (info?.installType) return mapInstallType(info.installType);
    }
  } catch {
    /* fall through */
  }
  try {
    // Browser API (some WXT builds expose management)
    const anyBrowser = browser as unknown as {
      management?: { getSelf?: () => Promise<{ installType?: string }> };
    };
    if (anyBrowser.management?.getSelf) {
      const info = await anyBrowser.management.getSelf();
      if (info?.installType) return mapInstallType(info.installType);
    }
  } catch {
    /* fall through */
  }
  return mapInstallType(undefined);
}

/**
 * Real Chrome Web Store listing. Firefox / Safari / Edge are not published
 * yet, so their buttons are rendered DISABLED (no href) instead of linking to
 * ghost URLs that 404 - the '(coming soon)' label already says why.
 */
const CHROME_WEB_STORE_URL =
  'https://chromewebstore.google.com/detail/1click-temp-mail-with-aut/oilafkncmnboohnekbnokkifjbnjeecn';

function storeUrl(): { label: string; href: string | null; icon: KnownIconName } {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Edg\//i.test(ua)) {
    return {
      label: $t('about.storeEdge') as string,
      href: null,
      icon: 'edge',
    };
  }
  if (/Firefox\//i.test(ua)) {
    return {
      label: $t('about.storeFirefox') as string,
      href: null,
      icon: 'firefox',
    };
  }
  // Safari (extension page in Safari UI often still uses WebKit UA)
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua) && !/Chromium\//i.test(ua)) {
    return {
      label: $t('about.storeSafari') as string,
      href: null,
      icon: 'safari',
    };
  }
  return {
    label: $t('about.storeChrome') as string,
    href: CHROME_WEB_STORE_URL,
    icon: 'chrome',
  };
}

interface ContributorsCacheEntry {
  at: number;
  list: GhContributor[];
  /** GitHub cache validators from the last successful response. */
  etag?: string;
  lastModified?: string;
}

async function fetchContributors(repoPath: string): Promise<GhContributor[]> {
  const url = `https://api.github.com/repos/${repoPath}/contributors?per_page=12`;
  const cached = (await browser.storage.local.get([CONTRIBUTORS_CACHE_KEY])) as {
    [CONTRIBUTORS_CACHE_KEY]?: ContributorsCacheEntry;
  };
  const entry = cached[CONTRIBUTORS_CACHE_KEY];
  const validators: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (entry?.etag) validators['If-None-Match'] = entry.etag;
  if (entry?.lastModified) validators['If-Modified-Since'] = entry.lastModified;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      // Linear backoff; 403/429 responses honor Retry-After when present.
      const retryAfter =
        lastError instanceof GithubRateLimitedError ? lastError.retryAfterMs : null;
      await new Promise((r) => setTimeout(r, retryAfter ?? attempt * 1000));
    }
    try {
      const res = await fetch(url, { headers: validators });
      if (res.status === 304) {
        if (entry?.list?.length) return entry.list;
        // 304 without a usable cache - treat as a miss and fall through.
        lastError = new Error('304 without cached list');
        continue;
      }
      if (res.status === 403 || res.status === 429) {
        const retryAfterHeader = res.headers.get('Retry-After');
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
        lastError = new GithubRateLimitedError(retryAfterMs);
        continue;
      }
      if (!res.ok) {
        lastError = new Error(String(res.status));
        continue;
      }
      const data = (await res.json()) as Array<{
        login: string;
        html_url: string;
        avatar_url: string;
        contributions: number;
      }>;
      if (!Array.isArray(data) || data.length === 0) {
        lastError = new Error('empty contributors response');
        continue;
      }
      // Persist the validators so next launch can revalidate (304 = free).
      const fresh: ContributorsCacheEntry = {
        at: Date.now(),
        list: data.map((c) => ({
          login: c.login,
          html_url: c.html_url,
          avatar_url: c.avatar_url,
          contributions: c.contributions,
        })),
        etag: res.headers.get('ETag') ?? undefined,
        lastModified: res.headers.get('Last-Modified') ?? undefined,
      };
      try {
        await writeWithRetry({ [CONTRIBUTORS_CACHE_KEY]: fresh });
      } catch {
        /* ignore */
      }
      return fresh.list;
    } catch (err) {
      // Network/parse failure - retry, then give up.
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('contributors fetch failed');
}

/** Thrown on 403/429 so the backoff can honor GitHub's Retry-After. */
class GithubRateLimitedError extends Error {
  retryAfterMs: number | null;
  constructor(retryAfterMs: number | null) {
    super('rate limited');
    this.retryAfterMs = retryAfterMs;
  }
}

async function loadContributors() {
  // Serve the cache immediately (stale-while-revalidate), then revalidate.
  try {
    const cached = (await browser.storage.local.get([CONTRIBUTORS_CACHE_KEY])) as {
      [CONTRIBUTORS_CACHE_KEY]?: ContributorsCacheEntry;
    };
    const entry = cached[CONTRIBUTORS_CACHE_KEY];
    if (entry?.list?.length && Date.now() - entry.at < CACHE_MS) {
      contributors = entry.list;
    }
  } catch {
    /* ignore */
  }

  try {
    const repoPath = CONSTANTS.GITHUB_REPO_URL.replace(/^https?:\/\/github\.com\//, '').replace(
      /\/$/,
      ''
    );
    contributors = await fetchContributors(repoPath);
  } catch {
    /* ignore */
    contributors = FALLBACK_CONTRIBUTORS;
  }
}

onMount(() => {
  void detectInstallType().then((v) => {
    installationType = v;
  });
  void loadContributors(); // stale-while-revalidate: cached list renders first, 304 refresh keeps it fresh
  // After fonts load, widths can change (CJK / variable fonts)
  try {
    void document.fonts?.ready?.then(() => scheduleFaqRecompute());
  } catch {
    /* ignore */
  }
});

onDestroy(() => {
  if (faqMeasureRaf) cancelAnimationFrame(faqMeasureRaf);
});

// Observe container width (viewport / sidepanel / split layout resize)
$effect(() => {
  const el = faqGridEl;
  if (!el || typeof ResizeObserver === 'undefined') {
    scheduleFaqRecompute();
    return;
  }
  const ro = new ResizeObserver(() => scheduleFaqRecompute());
  ro.observe(el);
  scheduleFaqRecompute();
  return () => ro.disconnect();
});

// Recalculate when language changes - depend on each localized question string
$effect(() => {
  void $locale;
  for (const id of FAQ_IDS) {
    void $t(`about.faq.${id}.q`);
  }
  untrack(() => scheduleFaqRecompute());
});

let store = $derived(storeUrl());
</script>

{#snippet externalLink(label: string, href: string, icon: KnownIconName)}
  <a
    {href}
    target="_blank"
    rel="noopener noreferrer"
    class="md-action inline-flex items-center justify-center rounded-xl border border-md-outline bg-transparent text-md-on-surface font-medium transition-colors"
  >
    <Icon name={icon} class="shrink-0" />
    <span class="leading-tight">{label}</span>
  </a>
{/snippet}

<div class="scroll-body flex flex-col h-full min-h-0 overflow-y-auto">
    <div class="flex flex-col items-center gap-4 py-5">
      <h2 class="font-bold text-base text-center">{$t('about.title')}</h2>
      <div class="flex items-center justify-center gap-2 -mt-2 flex-wrap">
        <Badge variant="primary" size="sm">v{version}</Badge>
        {#if installationType !== null}
          <Badge variant="neutral" size="sm" class="capitalize">
            {$t('about.installationType')}: {installationType}
          </Badge>
        {/if}
      </div>
      <p class="text-sm text-md-on-surface/60 text-center leading-relaxed">
        {$t('about.description')}
      </p>

      <div class="w-full max-w-[520px] mx-auto space-y-2" role="group" aria-label={$t('about.linksToolbar')} data-about-actions>
        <ButtonGroup>
          <Btn variant="primaryOutline" icon="info" label={$t('productTour.replay')} disabled={!onStartProductTour} onclick={() => onStartProductTour?.()} />
          {@render externalLink($t('about.demo'), CONSTANTS.DEMO_URL, 'monitor')}
        </ButtonGroup>
        <ButtonGroup>
          {@render externalLink($t('about.website'), CONSTANTS.WEBSITE_URL, 'globe')}
          {@render externalLink($t('about.documentation'), CONSTANTS.DOCS_URL, 'description')}
        </ButtonGroup>
        <ButtonGroup>
          {#if store.href}
            {@render externalLink(store.label, store.href, store.icon)}
          {:else}
            <Btn variant="outline" icon={store.icon} label={store.label} disabled />
          {/if}
          <Btn variant="outline" icon="code" label={$t('about.sourceCode')} onclick={() => { sourceCodeOpen = true; }} />
        </ButtonGroup>
        <ButtonGroup>
          <Btn variant="outline" icon="analytics" label={$t('diagnostics.title')} disabled={!onOpenDiagnostics} onclick={() => onOpenDiagnostics?.()} />
          {@render externalLink($t('about.reportIssue'), CONSTANTS.GITHUB_ISSUES_URL, 'warning')}
        </ButtonGroup>
      </div>

      {#if onOpenKeyboardShortcuts}
        <div class="w-full max-w-[520px] mx-auto border-t border-md-outline-variant pt-3">
          <ButtonGroup>
            <Btn variant="tonal" icon="key" label={$t('nav.keyboardShortcuts')} onclick={() => onOpenKeyboardShortcuts?.()} />
          </ButtonGroup>
        </div>
      {/if}
    </div>

    <ModalDialog open={sourceCodeOpen} title={$t('about.sourceCode')} maxWidth="sm" onClose={() => { sourceCodeOpen = false; }}>
      <div class="dialog-content-stack" data-source-code-dialog>
        <ButtonGroup>
          {@render externalLink('GitHub', CONSTANTS.GITHUB_REPO_URL, 'github')}
        </ButtonGroup>
        {#each ['GitLab', 'Codeberg', 'Gitee'] as platform (platform)}
          <ButtonGroup>
            <Btn variant="outline" icon="code" label={$t('about.mirrorComingSoon', { values: { platform } })} disabled />
          </ButtonGroup>
        {/each}
      </div>
    </ModalDialog>

    <!--
      FAQs - CSS Grid with 1/2/3 columns chosen by measuring each localized
      question’s natural single-line width (no wrap / truncate / font shrink).
    -->
    <section class="px-0 pb-4" aria-label={$t('about.faqTitle')} data-tour="about-faq">
      <div class="flex items-center justify-between gap-2 mb-2">
        <h3 class="text-sm font-bold text-md-on-surface">{$t('about.faqTitle')}</h3>
        <button
          type="button"
          class="text-xs font-semibold text-md-primary hover:underline shrink-0"
          onclick={() => setExpandAllFaqs(!faqExpandAll)}
        >
          {faqExpandAll ? $t('about.faqCollapseAll') : $t('about.faqExpandAll')}
        </button>
      </div>

      <!-- Off-screen probe: same chrome as FAQ question buttons for accurate width -->
      <div class="faq-measure-host" aria-hidden="true">
        <div class="faq-measure-row" bind:this={faqMeasureRowEl}>
          <span class="faq-measure-text" bind:this={faqMeasureTextEl}></span>
          <span class="faq-measure-icon"></span>
        </div>
      </div>

      <div
        class="faq-grid {faqLayoutReady ? '' : 'invisible'}"
        bind:this={faqGridEl}
        style="grid-template-columns: repeat({faqCols}, minmax(0, 1fr));"
        data-faq-cols={faqCols}
      >
        {#each FAQ_IDS as id (id)}
          <div class="faq-item rounded-xl bg-md-surface-container-low overflow-hidden border border-md-outline-variant/20">
            <button
              type="button"
              class="faq-question w-full flex items-center gap-2 px-3 py-2.5 text-start focus-visible:outline-2 focus-visible:outline-md-primary"
              aria-expanded={isFaqOpen(id)}
              onclick={() => toggleFaqItem(id)}
            >
              <span class="faq-question-label flex-1 text-xs font-semibold text-md-on-surface">
                {$t(`about.faq.${id}.q`)}
              </span>
              <Icon
                name="chevronDown"
                class="w-3.5 h-3.5 text-md-on-surface/50 shrink-0 transition-transform {isFaqOpen(id)
                  ? 'rotate-180'
                  : ''}"
              />
            </button>
            {#if isFaqOpen(id)}
              <div
                class="px-3 pb-3 text-sm text-md-on-surface-variant border-t border-md-outline-variant/20 pt-2 faq-answer-justify"
                transition:slide={{ duration: motionPreference.enabled ? 0 : 180, easing: cubicOut }}
              >
                {$t(`about.faq.${id}.a`)}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <!-- Contributors -->
    <section class="px-0 pb-3" aria-label={$t('about.contributors')}>
      <h3 class="text-sm font-bold text-md-on-surface mb-2">{$t('about.contributors')}</h3>
      <div class="flex flex-wrap gap-2">
        {#each contributors as c (c.html_url + c.login)}
          <a
            href={c.html_url}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-md-surface-variant/60 hover:bg-md-surface-variant active:brightness-95 text-xs font-medium text-md-on-surface transition-colors"
            title={c.login}
          >
            {#if c.avatar_url && !brokenAvatars.has(c.login)}
              <img
                src={c.avatar_url}
                alt=""
                class="{AVATAR_BOX.sm} rounded-full"
                width="20"
                height="20"
                onerror={() => brokenAvatars.add(c.login)}
              />
            {:else}
              <Avatar size="sm" letter={c.login || '?'} email={c.login || '?'} class="shrink-0" />
            {/if}
            <span class="truncate max-w-[8rem]">{c.login}</span>
          </a>
        {/each}
      </div>
    </section>

    <!-- Made with - last -->
    <p class="text-xs text-md-on-surface/40 text-center px-3 pb-8 pt-2">{$t('about.madeBy')}</p>
</div>

<!-- Contextual FAB: back arrow → returns to the page the user was on before About -->
<FloatingAction kind="ghost" icon="chevronLeft" labelKey="common.back" onclick={() => onBack()} />

<style>
  /*
   * Off-screen measurement probe - same padding/gap/font/icon as .faq-question.
   * Must NOT use width:0 + overflow:hidden (that would collapse measured width to 0).
   */
  .faq-measure-host {
    position: fixed;
    left: -10000px;
    top: 0;
    pointer-events: none;
    visibility: hidden;
    z-index: -1;
  }
  .faq-measure-row {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem; /* gap-2 - matches button */
    padding: 0.625rem 0.75rem; /* py-2.5 px-3 */
    box-sizing: border-box;
    white-space: nowrap;
    font-size: 0.75rem; /* text-xs */
    font-weight: 600;
    line-height: 1rem;
  }
  .faq-measure-text {
    white-space: nowrap;
  }
  .faq-measure-icon {
    width: 0.875rem; /* w-3.5 - matches chevron */
    height: 0.875rem;
    flex-shrink: 0;
  }

  .faq-grid {
    display: grid;
    gap: 0.5rem; /* gap-2 - pickFaqColumns reads columnGap via getComputedStyle */
    width: 100%;
    align-items: start;
  }

  /* Single-line questions only; column count is chosen so every label fits */
  .faq-question-label {
    white-space: nowrap;
    overflow: visible;
    text-overflow: clip;
    /* flex-1 without min-width:0 would allow shrink-wrap fights; keep natural width */
    flex: 1 1 auto;
    min-width: max-content;
  }

  .faq-item {
    min-width: 0;
  }

  .faq-answer-justify {
    text-align: justify;
    text-justify: inter-word;
  }
</style>
