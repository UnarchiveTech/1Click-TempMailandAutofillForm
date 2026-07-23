<script lang="ts">
import { onDestroy, onMount, tick, untrack } from 'svelte';
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import { GITHUB_ISSUES_URL, GITHUB_REPO_URL } from '@/utils/constants.js';

interface Props {
  context?: 'popup' | 'sidepanel' | 'app';
  version: string;
  onStartProductTour?: () => void;
}
let { context = 'popup', version, onStartProductTour }: Props = $props();

const FAQ_IDS = ['otp', 'autofill', 'export', 'privacy', 'renew', 'tour'] as const;
let openFaq = $state<string | null>('otp');
/** When true, every FAQ answer is expanded */
let faqExpandAll = $state(false);

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
 * FAQ grid columns (1–3). Chosen by measuring each localized question’s
 * natural single-line width (padding + label + expand icon) against the
 * container — language-agnostic, no font shrinking / wrapping / ellipsis.
 */
/** Number of FAQ columns that fit (1 … N); no hard cap at 3 */
let faqCols = $state(1);
let faqGridEl = $state<HTMLElement | null>(null);
let faqMeasureRowEl = $state<HTMLElement | null>(null);
let faqMeasureTextEl = $state<HTMLElement | null>(null);
let faqMeasureRaf = 0;

/** Matches .faq-grid gap-2 (0.5rem). Read from computed style when possible. */
const FAQ_GAP_FALLBACK_PX = 8;

type GhContributor = { login: string; html_url: string; avatar_url: string; contributions: number };

const CONTRIBUTORS_CACHE_KEY = 'githubContributorsCache_v1';
const CACHE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

/** Fallback when API is unavailable */
const FALLBACK_CONTRIBUTORS: GhContributor[] = [
  {
    login: 'Tejas Mate',
    html_url: 'https://github.com/tejas-mate',
    avatar_url: '',
    contributions: 0,
  },
  {
    login: 'Enzo Davico',
    html_url: 'https://github.com/enzo-davico',
    avatar_url: '',
    contributions: 0,
  },
];

let contributors = $state<GhContributor[]>(FALLBACK_CONTRIBUTORS);
let installationType = $state('—');

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

function storeUrl(): { label: string; href: string } {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Edg\//i.test(ua)) {
    return {
      label: $t('about.storeEdge') as string,
      href: 'https://microsoftedge.microsoft.com/addons/search?q=1Click%20Temp%20Mail',
    };
  }
  if (/Firefox\//i.test(ua)) {
    return {
      label: $t('about.storeFirefox') as string,
      href: 'https://addons.mozilla.org/firefox/',
    };
  }
  return {
    label: $t('about.storeChrome') as string,
    href: 'https://chromewebstore.google.com/search/1Click%20Temp%20Mail',
  };
}

async function loadContributors() {
  try {
    const cached = (await browser.storage.local.get([CONTRIBUTORS_CACHE_KEY])) as {
      [CONTRIBUTORS_CACHE_KEY]?: { at: number; list: GhContributor[] };
    };
    const entry = cached[CONTRIBUTORS_CACHE_KEY];
    if (entry?.list?.length && Date.now() - entry.at < CACHE_MS) {
      contributors = entry.list;
      return;
    }
  } catch {
    /* ignore */
  }

  try {
    // Public GitHub API — rate limited; cache for 1 week
    const repoPath = GITHUB_REPO_URL.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    const res = await fetch(`https://api.github.com/repos/${repoPath}/contributors?per_page=12`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as Array<{
      login: string;
      html_url: string;
      avatar_url: string;
      contributions: number;
    }>;
    if (Array.isArray(data) && data.length) {
      const list = data.map((c) => ({
        login: c.login,
        html_url: c.html_url,
        avatar_url: c.avatar_url,
        contributions: c.contributions,
      }));
      contributors = list;
      try {
        await browser.storage.local.set({
          [CONTRIBUTORS_CACHE_KEY]: { at: Date.now(), list },
        });
      } catch {
        /* ignore */
      }
    }
  } catch {
    contributors = FALLBACK_CONTRIBUTORS;
  }
}

onMount(() => {
  void detectInstallType().then((v) => {
    installationType = v;
  });
  void loadContributors();
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

// Recalculate when language changes — depend on each localized question string
$effect(() => {
  void $locale;
  for (const id of FAQ_IDS) {
    void $t(`about.faq.${id}.q`);
  }
  untrack(() => scheduleFaqRecompute());
});

let store = $derived(storeUrl());
</script>

<div class="flex flex-col h-full min-h-0 overflow-y-auto">
    <div class="flex flex-col items-center gap-4 px-3 py-5">
      <h2 class="font-bold text-base text-center">{$t('about.title')}</h2>
      <div class="flex items-center justify-center gap-2 -mt-2 flex-wrap">
        <span class="px-2 py-0.5 text-xs rounded-full bg-md-primary/20 text-md-primary">v{version}</span>
        <span class="px-2 py-0.5 text-xs rounded-full bg-md-surface-variant text-md-on-surface/70 capitalize">
          {$t('about.installationType')}: {installationType}
        </span>
      </div>
      <p class="text-sm text-md-on-surface/60 text-center leading-relaxed">
        {$t('about.description')}
      </p>

      <!-- Single-row toolbar: GitHub · Store · Report -->
      <div class="flex w-full gap-1.5" role="toolbar" aria-label={$t('about.linksToolbar')}>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          class="flex-1 min-w-0 px-1.5 py-2 text-xs font-semibold rounded-xl border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors flex flex-col items-center justify-center gap-1"
        >
          <Icon name="gitHub" class="w-4 h-4" />
          <span class="truncate max-w-full">{$t('about.viewOnGitHub')}</span>
        </a>
        <a
          href={store.href}
          target="_blank"
          rel="noopener noreferrer"
          class="flex-1 min-w-0 px-1.5 py-2 text-xs font-semibold rounded-xl border border-md-outline-variant text-md-on-surface hover:bg-md-surface-variant transition-colors flex flex-col items-center justify-center gap-1"
        >
          <Icon name="globe" class="w-4 h-4" />
          <span class="truncate max-w-full">{store.label}</span>
        </a>
        <button
          type="button"
          class="flex-1 min-w-0 px-1.5 py-2 text-xs font-semibold rounded-xl bg-md-error/10 text-md-error hover:bg-md-error/20 transition-colors flex flex-col items-center justify-center gap-1"
          onclick={() => browser.tabs.create({ url: GITHUB_ISSUES_URL })}
        >
          <Icon name="warning" class="w-4 h-4" />
          <span class="truncate max-w-full">{$t('about.reportIssue')}</span>
        </button>
      </div>

      {#if onStartProductTour}
        <button
          type="button"
          class="w-full px-3 py-1.5 text-sm rounded-lg border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors flex items-center justify-center gap-2"
          onclick={() => onStartProductTour?.()}
        >
          <Icon name="info" class="w-4 h-4" />
          {$t('productTour.replay')}
        </button>
      {/if}
    </div>

    <!--
      FAQs — CSS Grid with 1/2/3 columns chosen by measuring each localized
      question’s natural single-line width (no wrap / truncate / font shrink).
    -->
    <section class="px-2.5 pb-4" aria-label={$t('about.faqTitle')}>
      <div class="flex items-center justify-between gap-2 px-2 mb-2">
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
        class="faq-grid"
        bind:this={faqGridEl}
        style="grid-template-columns: repeat({faqCols}, minmax(0, 1fr));"
        data-faq-cols={faqCols}
      >
        {#each FAQ_IDS as id (id)}
          <div class="faq-item rounded-xl bg-md-primary-container overflow-hidden border border-md-outline-variant/20">
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
                class="px-3 pb-3 text-label-sm text-md-on-surface/70 leading-relaxed border-t border-md-outline-variant/20 pt-2"
              >
                {$t(`about.faq.${id}.a`)}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <!-- Contributors -->
    <section class="px-2.5 pb-3" aria-label={$t('about.contributors')}>
      <h3 class="text-sm font-bold text-md-on-surface px-2 mb-2">{$t('about.contributors')}</h3>
      <div class="flex flex-wrap gap-2 px-1">
        {#each contributors as c (c.html_url + c.login)}
          <a
            href={c.html_url}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-md-surface-variant/60 hover:bg-md-surface-variant text-xs font-medium text-md-on-surface transition-colors"
            title={c.login}
          >
            {#if c.avatar_url}
              <img src={c.avatar_url} alt="" class="w-5 h-5 rounded-full" width="20" height="20" />
            {:else}
              <span class="w-5 h-5 rounded-full bg-md-primary/20 text-md-primary flex items-center justify-center text-xs font-bold">
                {(c.login || '?')[0].toUpperCase()}
              </span>
            {/if}
            <span class="truncate max-w-[8rem]">{c.login}</span>
          </a>
        {/each}
      </div>
    </section>

    <!-- Made with — last -->
    <p class="text-xs text-md-on-surface/40 text-center px-3 pb-8 pt-2">{$t('about.madeBy')}</p>
</div>

<style>
  /*
   * Off-screen measurement probe — same padding/gap/font/icon as .faq-question.
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
    gap: 0.5rem; /* gap-2 — matches button */
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
    width: 0.875rem; /* w-3.5 — matches chevron */
    height: 0.875rem;
    flex-shrink: 0;
  }

  .faq-grid {
    display: grid;
    gap: 0.5rem; /* gap-2 — pickFaqColumns reads columnGap via getComputedStyle */
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
</style>
