<script lang="ts">
/**
 * Reusable horizontal ScrollSpy navigation chips with:
 * - IntersectionObserver active section tracking
 * - Vertical wheel → horizontal scroll while hovered
 * - Press-hold-drag pan (via enableHorizontalWheelScroll)
 */
import { onDestroy } from 'svelte';
import { t } from 'svelte-i18n';
import { enableHorizontalWheelScroll } from '@/utils/horizontal-wheel-scroll.js';

export type ScrollSpySection = { id: string; labelKey: string };

let {
  sections = [] as ScrollSpySection[],
  activeId = $bindable(''),
  scrollRoot = null as HTMLElement | null,
  /** data attribute name on section elements (e.g. data-settings-section) */
  sectionAttr = 'data-settings-section',
  /** id prefix, e.g. settings-section- or activity-section- */
  sectionIdPrefix = 'settings-section-',
  ariaLabel = 'Section navigation',
  onNavigate = (_id: string) => {},
} = $props<{
  sections?: ScrollSpySection[];
  activeId?: string;
  scrollRoot?: HTMLElement | null;
  sectionAttr?: string;
  sectionIdPrefix?: string;
  ariaLabel?: string;
  onNavigate?: (id: string) => void;
}>();

let scrollerEl = $state<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
let spyRaf = 0;
/** When pointer is over a section, prefer that tab over scroll-based tracking */
let hoverSectionId = $state<string | null>(null);
const sectionPointerCleanups: Array<() => void> = [];

function scrollToSection(id: string) {
  const root = scrollRoot;
  if (!root) return;
  const el = root.querySelector(`#${CSS.escape(sectionIdPrefix + id)}`) as HTMLElement | null;
  if (!el) return;
  activeId = id;
  hoverSectionId = id;
  onNavigate(id);
  const top = el.offsetTop - 8;
  root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function clearSectionPointerListeners() {
  while (sectionPointerCleanups.length) {
    const fn = sectionPointerCleanups.pop();
    try {
      fn?.();
    } catch {
      /* ignore */
    }
  }
}

function setupPointerTracking() {
  clearSectionPointerListeners();
  const root = scrollRoot;
  if (!root || !sections.length) return;

  for (const s of sections) {
    const el = root.querySelector(`#${CSS.escape(sectionIdPrefix + s.id)}`) as HTMLElement | null;
    if (!el) continue;
    const onEnter = () => {
      hoverSectionId = s.id;
      activeId = s.id;
    };
    const onLeave = (e: PointerEvent) => {
      // Only clear if we actually left this section (not entering a child)
      const related = e.relatedTarget as Node | null;
      if (related && el.contains(related)) return;
      if (hoverSectionId === s.id) hoverSectionId = null;
    };
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    sectionPointerCleanups.push(() => {
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
    });
  }
}

function setupObserver() {
  observer?.disconnect();
  const root = scrollRoot;
  if (!root || !sections.length) return;

  const ratios = new Map<string, number>();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const key = el.getAttribute(sectionAttr) || '';
        if (!key) continue;
        ratios.set(key, entry.isIntersecting ? entry.intersectionRatio : 0);
      }
      cancelAnimationFrame(spyRaf);
      spyRaf = requestAnimationFrame(() => {
        // Cursor hover wins: keep hovered section active even when multiple are on-screen
        if (hoverSectionId) {
          activeId = hoverSectionId;
          return;
        }
        const liveRoot = scrollRoot;
        if (!liveRoot) return;
        let best = sections[0]?.id || '';
        let bestRatio = -1;
        for (const s of sections) {
          const r = ratios.get(s.id) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            best = s.id;
          }
        }
        if (bestRatio <= 0) {
          let closest = sections[0]?.id || '';
          let closestDist = Number.POSITIVE_INFINITY;
          for (const s of sections) {
            const el = liveRoot.querySelector(
              `#${CSS.escape(sectionIdPrefix + s.id)}`
            ) as HTMLElement | null;
            if (!el) continue;
            const dist = Math.abs(el.offsetTop - liveRoot.scrollTop);
            if (dist < closestDist) {
              closestDist = dist;
              closest = s.id;
            }
          }
          if (closest) activeId = closest;
        } else if (best) {
          activeId = best;
        }
      });
    },
    {
      root,
      rootMargin: '-10% 0px -55% 0px',
      threshold: [0, 0.15, 0.35, 0.55, 0.75, 1],
    }
  );

  for (const s of sections) {
    const el = root.querySelector(`#${CSS.escape(sectionIdPrefix + s.id)}`) as HTMLElement | null;
    if (el) observer.observe(el);
  }
  setupPointerTracking();
}

$effect(() => {
  void sections;
  void scrollRoot;
  void sectionAttr;
  void sectionIdPrefix;
  queueMicrotask(() => setupObserver());
});

$effect(() => {
  const el = scrollerEl;
  if (!el) return;
  const action = enableHorizontalWheelScroll(el);
  return () => action.destroy();
});

onDestroy(() => {
  observer?.disconnect();
  clearSectionPointerListeners();
  cancelAnimationFrame(spyRaf);
});
</script>

<nav
  class="scroll-spy shrink-0 px-2 pt-1.5 pb-1.5 border-b border-md-outline-variant/15 bg-md-surface/95 backdrop-blur-sm z-20"
  aria-label={ariaLabel}
>
  <div
    bind:this={scrollerEl}
    class="scroll-spy-scroller flex items-center gap-1 overflow-x-auto no-scrollbar cursor-grab select-none"
  >
    {#each sections as section (section.id)}
      <button
        type="button"
        class="shrink-0 px-2.5 py-1 rounded-full text-label-sm font-semibold transition-colors {activeId ===
        section.id
          ? 'bg-md-secondary-container text-md-on-secondary-container'
          : 'border border-md-outline-variant text-md-on-surface-variant bg-md-surface-container-low'} hover:bg-md-secondary-container hover:text-md-on-secondary-container"
        aria-current={activeId === section.id ? 'true' : undefined}
        onclick={() => scrollToSection(section.id)}
      >
        {$t(section.labelKey)}
      </button>
    {/each}
  </div>
</nav>

<style>
  .scroll-spy-scroller {
    touch-action: pan-x;
  }
</style>
