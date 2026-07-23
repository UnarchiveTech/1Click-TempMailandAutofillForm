<script lang="ts">
import { onDestroy, tick } from 'svelte';
import { t } from 'svelte-i18n';
import Icon from '@/components/icons/Icon.svelte';
import Btn from '@/components/ui/primitives/Btn.svelte';
import type { ProductTourStep, TourPlacement } from '@/features/product-tour/tour-types.js';
import type { View } from '@/features/types/view-types.js';
import { portalToBody } from '@/utils/portal-layers.js';

let {
  open = false,
  steps = [] as ProductTourStep[],
  currentView = 'main' as View,
  onNavigate = async (_view: View) => {},
  onComplete = () => {},
  onSkip = () => {},
} = $props<{
  open?: boolean;
  steps?: ProductTourStep[];
  currentView?: View;
  onNavigate?: (view: View) => void | Promise<void>;
  onComplete?: () => void;
  onSkip?: () => void;
}>();

let stepIndex = $state(0);
let hole = $state({ left: 0, top: 0, width: 0, height: 0, visible: false });
let tip = $state({ left: 0, top: 0, placement: 'bottom' as TourPlacement });
let measuring = $state(false);
let panelEl = $state<HTMLElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);

$effect(() => {
  if (open && overlayEl) {
    return portalToBody(overlayEl);
  }
});

let step = $derived(steps[stepIndex] ?? null);
let isFirst = $derived(stepIndex === 0);
let isLast = $derived(stepIndex >= steps.length - 1);
let total = $derived(steps.length);

const SHELL_PAD = 8; // match popup padding roughly

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function resolvePlacement(
  preferred: TourPlacement | undefined,
  target: DOMRect,
  tipW: number,
  tipH: number
): TourPlacement {
  if (preferred && preferred !== 'auto' && preferred !== 'center') {
    return preferred;
  }
  const spaceBelow = window.innerHeight - target.bottom;
  const spaceAbove = target.top;
  if (spaceBelow >= tipH + 16) return 'bottom';
  if (spaceAbove >= tipH + 16) return 'top';
  if (window.innerWidth - target.right >= tipW + 16) return 'right';
  return 'left';
}

async function measure() {
  if (!open || !step) return;
  measuring = true;

  // Navigate if needed
  if (step.view && step.view !== currentView) {
    await onNavigate(step.view);
    await tick();
    // Allow view content to paint
    await new Promise((r) => setTimeout(r, 80));
  }

  await tick();

  const pad = step.padding ?? 6;
  const targetSel = step.target;
  let el: Element | null = null;
  if (targetSel) {
    el = document.querySelector(targetSel);
  }

  if (!el) {
    // Centered card - no hole
    hole = { left: 0, top: 0, width: 0, height: 0, visible: false };
    tip = {
      left: window.innerWidth / 2,
      top: window.innerHeight / 2,
      placement: 'center',
    };
    measuring = false;
    return;
  }

  // Scroll into view if needed (within scroll parents)
  try {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 60));

  const rect = el.getBoundingClientRect();
  hole = {
    left: rect.left - pad,
    top: rect.top - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
    visible: true,
  };

  // Estimate tip size (before bind) then refine next frame
  const tipW = panelEl?.offsetWidth || 280;
  const tipH = panelEl?.offsetHeight || 160;
  const placement = resolvePlacement(step.placement, rect, tipW, tipH);

  let left = rect.left + rect.width / 2;
  let top = rect.bottom + 12;

  if (placement === 'top') {
    top = rect.top - 12 - tipH;
    left = rect.left + rect.width / 2 - tipW / 2;
  } else if (placement === 'bottom') {
    top = rect.bottom + 12;
    left = rect.left + rect.width / 2 - tipW / 2;
  } else if (placement === 'left') {
    top = rect.top + rect.height / 2 - tipH / 2;
    left = rect.left - 12 - tipW;
  } else if (placement === 'right') {
    top = rect.top + rect.height / 2 - tipH / 2;
    left = rect.right + 12;
  }

  left = clamp(left, SHELL_PAD, window.innerWidth - tipW - SHELL_PAD);
  top = clamp(top, SHELL_PAD, window.innerHeight - tipH - SHELL_PAD);

  tip = { left, top, placement };
  measuring = false;

  // Second pass once panel is measured
  requestAnimationFrame(() => {
    if (!panelEl || !step?.target) return;
    const el2 = document.querySelector(step.target);
    if (!el2) return;
    const r2 = el2.getBoundingClientRect();
    const w = panelEl.offsetWidth;
    const h = panelEl.offsetHeight;
    const p = resolvePlacement(step.placement, r2, w, h);
    let L = r2.left + r2.width / 2 - w / 2;
    let T = r2.bottom + 12;
    if (p === 'top') T = r2.top - 12 - h;
    if (p === 'left') {
      L = r2.left - 12 - w;
      T = r2.top + r2.height / 2 - h / 2;
    }
    if (p === 'right') {
      L = r2.right + 12;
      T = r2.top + r2.height / 2 - h / 2;
    }
    tip = {
      left: clamp(L, SHELL_PAD, window.innerWidth - w - SHELL_PAD),
      top: clamp(T, SHELL_PAD, window.innerHeight - h - SHELL_PAD),
      placement: p,
    };
  });
}

$effect(() => {
  if (!open) {
    stepIndex = 0;
    return;
  }
  void stepIndex;
  void currentView;
  void measure();
});

function onResize() {
  if (open) void measure();
}

$effect(() => {
  if (!open) return;
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);
  return () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onResize, true);
  };
});

function next() {
  if (isLast) {
    onComplete();
    return;
  }
  stepIndex = Math.min(stepIndex + 1, steps.length - 1);
}

function prev() {
  stepIndex = Math.max(stepIndex - 1, 0);
}

function handleKey(e: KeyboardEvent) {
  if (!open) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    onSkip();
  } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    e.preventDefault();
    next();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    prev();
  }
}

$effect(() => {
  if (!open) return;
  window.addEventListener('keydown', handleKey);
  return () => window.removeEventListener('keydown', handleKey);
});

onDestroy(() => {
  window.removeEventListener('keydown', handleKey);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onResize, true);
});
</script>

{#if open && step}
  <div
    bind:this={overlayEl}
    class="fixed inset-0 z-[10050]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="product-tour-title"
  >
    <!-- Full-screen dim; cutout via box-shadow on hole -->
    {#if hole.visible}
      <div
        class="absolute rounded-xl pointer-events-none transition-all duration-200 ease-out ring-2 ring-md-primary/80"
        style="
          left: {hole.left}px;
          top: {hole.top}px;
          width: {hole.width}px;
          height: {hole.height}px;
          box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.62);
        "
      ></div>
      <!-- Block clicks outside hole -->
      <div class="absolute inset-0" style="pointer-events: auto"></div>
      <!-- Allow interaction with hole area (optional - keep blocked for guided feel) -->
    {:else}
      <div class="absolute inset-0 bg-black/55 backdrop-blur-[2px]"></div>
    {/if}

    <!-- Tooltip / step card -->
    <div
      bind:this={panelEl}
      class="absolute z-[10051] w-[min(300px,calc(100vw-24px))] rounded-2xl border border-md-outline-variant/30 bg-md-surface shadow-2xl p-4 text-md-on-surface transition-all duration-200"
      style={tip.placement === 'center'
        ? `left: 50%; top: 50%; transform: translate(-50%, -50%);`
        : `left: ${tip.left}px; top: ${tip.top}px;`}
    >
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="flex items-center gap-2 min-w-0">
          <div class="flex gap-1 flex-wrap">
            {#each steps as _, i (i)}
              <div
                class="h-1.5 rounded-full transition-all {i === stepIndex
                  ? 'w-4 bg-md-primary'
                  : i < stepIndex
                    ? 'w-1.5 bg-md-primary/50'
                    : 'w-1.5 bg-md-outline-variant'}"
              ></div>
            {/each}
          </div>
          <span class="text-xs text-md-on-surface/45 shrink-0"
            >{stepIndex + 1} / {total}</span
          >
        </div>
        <button
          type="button"
          class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-md-surface-variant/60 shrink-0"
          aria-label={$t('productTour.skip')}
          onclick={(e) => {
            e.stopPropagation();
            onSkip();
          }}
        >
          <Icon name="x" class="w-4 h-4 text-md-on-surface/50" />
        </button>
      </div>

      <h3 id="product-tour-title" class="text-sm font-bold tracking-tight mb-1">
        {$t(step.titleKey)}
      </h3>
      <p class="text-xs text-md-on-surface/70 leading-relaxed mb-4">
        {$t(step.bodyKey)}
      </p>

      <div class="flex gap-2">
        {#if !isFirst}
          <Btn
            variant="outline"
            size="md"
            class="flex-1"
            onclick={() => { prev(); }}
          >
            {$t('common.back')}
          </Btn>
        {/if}
        <Btn
          variant="primary"
          size="md"
          class="flex-1"
          disabled={measuring}
          onclick={() => { next(); }}
        >
          {isLast ? $t('productTour.finish') : $t('productTour.next')}
        </Btn>
      </div>

      <button
        type="button"
        class="w-full mt-2 text-xs text-md-on-surface/45 hover:text-md-on-surface/70 py-1"
        onclick={(e) => {
          e.stopPropagation();
          onSkip();
        }}
      >
        {$t('productTour.skipTour')}
      </button>
    </div>
  </div>
{/if}
