<script lang="ts">
/**
 * Reusable horizontal ScrollSpy navigation chips with:
 * - IntersectionObserver active section tracking
 * - Vertical wheel → horizontal scroll while hovered
 * - Press-hold-drag pan (via enableHorizontalWheelScroll)
 */
import { onDestroy } from 'svelte';
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import { enableHorizontalWheelScroll } from '@/utils/ui/horizontal-wheel-scroll.js';

export type ScrollSpySection = {
  id: string;
  labelKey: string;
  /** Optional icon name from the Icon catalog (rendered before the label). */
  icon?: KnownIconName;
};

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
}: {
  sections?: ScrollSpySection[];
  activeId?: string;
  scrollRoot?: HTMLElement | null;
  sectionAttr?: string;
  sectionIdPrefix?: string;
  ariaLabel?: string;
  onNavigate?: (id: string) => void;
} = $props();

let scrollerEl = $state<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
let spyRaf = 0;
let isClickScrolling = false;
let clickScrollTimeout: ReturnType<typeof setTimeout> | null = null;

function centerActiveChip(id: string, isClick = false) {
  const scroller = scrollerEl;
  if (!id || !scroller) return;
  const chip = scroller.querySelector<HTMLElement>(`[data-spy-id="${CSS.escape(id)}"]`);
  if (!chip) return;
  const targetLeft = chip.offsetLeft - scroller.offsetWidth / 2 + chip.offsetWidth / 2;
  scroller.scrollTo({
    left: Math.max(0, targetLeft),
    behavior: isClick ? 'smooth' : 'auto',
  });
}

function scrollToSection(id: string) {
  const root = scrollRoot;
  if (!root) return;
  const el = root.querySelector(`#${CSS.escape(sectionIdPrefix + id)}`) as HTMLElement | null;
  if (!el) return;

  activeId = id;
  onNavigate(id);

  isClickScrolling = true;
  if (clickScrollTimeout) clearTimeout(clickScrollTimeout);
  clickScrollTimeout = setTimeout(() => {
    isClickScrolling = false;
  }, 600);

  const top = el.offsetTop - 8;
  root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  centerActiveChip(id, true);
}

function updateActiveSectionFromScroll() {
  if (isClickScrolling) return;
  const root = scrollRoot;
  if (!root || !sections.length) return;

  const rootTop = root.scrollTop;
  const targetY = rootTop + 70;

  let currentSectionId = sections[0].id;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const el = root.querySelector(`#${CSS.escape(sectionIdPrefix + s.id)}`) as HTMLElement | null;
    if (!el) continue;
    if (el.offsetTop <= targetY) {
      currentSectionId = s.id;
    } else {
      break;
    }
  }

  // At the bottom of the container, highlight the last section
  if (root.scrollHeight - rootTop - root.clientHeight < 30) {
    currentSectionId = sections[sections.length - 1].id;
  }

  if (activeId !== currentSectionId) {
    activeId = currentSectionId;
  }
}

// Frame-synced scroll listener for real-time scroll tracking
$effect(() => {
  const root = scrollRoot;
  void sections;
  void sectionIdPrefix;
  if (!root) return;

  let rafId = 0;
  const handleScroll = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      updateActiveSectionFromScroll();
    });
  };

  root.addEventListener('scroll', handleScroll, { passive: true });
  queueMicrotask(() => updateActiveSectionFromScroll());

  return () => {
    root.removeEventListener('scroll', handleScroll);
    if (rafId) cancelAnimationFrame(rafId);
  };
});

$effect(() => {
  const el = scrollerEl;
  if (!el) return;
  const action = enableHorizontalWheelScroll(el);
  return () => action.destroy();
});

// Auto-scroll active chip to center immediately when activeId changes
$effect(() => {
  const id = activeId;
  if (!id) return;
  queueMicrotask(() => {
    centerActiveChip(id, isClickScrolling);
  });
});

onDestroy(() => {
  if (clickScrollTimeout) clearTimeout(clickScrollTimeout);
});
</script>

<nav
  class="scroll-spy shrink-0 pt-1.5 pb-1.5 border-b border-md-outline-variant/15 bg-md-surface/95 backdrop-blur-sm z-20"
  aria-label={ariaLabel}
>
  <div
    bind:this={scrollerEl}
    class="scroll-spy-scroller flex items-center gap-1 overflow-x-auto no-scrollbar cursor-grab select-none"
  >
    {#each sections as section (section.id)}
      <button
        type="button"
        data-spy-id={section.id}
        class="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ui-label transition-colors {activeId ===
        section.id
          ? 'bg-md-secondary-container text-md-on-secondary-container'
          : 'border border-md-outline-variant text-md-on-surface-variant bg-md-surface-container-low'} hover:bg-md-secondary-container active:bg-md-secondary-container-pressed hover:text-md-on-secondary-container"
        aria-current={activeId === section.id ? 'true' : undefined}
        onclick={() => scrollToSection(section.id)}
      >
        {#if section.icon}
          <Icon name={section.icon} class="w-3.5 h-3.5 shrink-0" />
        {/if}
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
