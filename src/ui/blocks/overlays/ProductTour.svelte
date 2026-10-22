<script lang="ts">
import { onDestroy, tick } from 'svelte';
import { t } from 'svelte-i18n';
import type { ProductTourStep, TourPlacement } from '@/features/product-tour/tour-types.js';
import type { View } from '@/features/types/view-types.js';
import Btn from '@/ui/components/primitives/Btn.svelte';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import { beginDialogLifecycle } from '@/utils/ui/dialog-lifecycle.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS, portalToBody } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';

let {
  open = false,
  steps = [] as ProductTourStep[],
  currentView = 'mailbox' as View,
  onNavigate = async (_view: View) => {},
  onComplete = () => {},
  onSkip = () => {},
}: {
  open?: boolean;
  steps?: ProductTourStep[];
  currentView?: View;
  onNavigate?: (view: View) => void | Promise<void>;
  onComplete?: () => void;
  onSkip?: () => void;
} = $props();

let stepIndex = $state(0);
let hole = $state({ left: 0, top: 0, width: 0, height: 0, visible: false });
let tip = $state({ left: 0, top: 0, placement: 'bottom' as TourPlacement });
let measuring = $state(false);
let panelEl = $state<HTMLElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);
let measurementGeneration = 0;
let pendingMeasurementFrame: number | null = null;

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
  const generation = ++measurementGeneration;
  if (pendingMeasurementFrame !== null) {
    cancelAnimationFrame(pendingMeasurementFrame);
    pendingMeasurementFrame = null;
  }
  if (!open) return;
  const isCurrent = () => open && generation === measurementGeneration;
  // Capture the derived step once, synchronously, so the awaits and the
  // requestAnimationFrame below never read a destroyed component's $derived
  // (which would trigger Svelte's `derived_inert` warning).
  const s = step;
  if (!s) return;
  measuring = true;

  // Navigate if needed
  if (s.view && s.view !== currentView) {
    await onNavigate(s.view);
    if (!isCurrent()) return;
    await tick();
    // Allow view content to paint
    await new Promise((r) => setTimeout(r, 80));
    if (!isCurrent()) return;
  }

  await tick();
  if (!isCurrent()) return;

  const pad = s.padding ?? 6;
  const targetSel = s.target;
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
  if (!isCurrent()) return;

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
  const placement = resolvePlacement(s.placement, rect, tipW, tipH);

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
  pendingMeasurementFrame = requestAnimationFrame(() => {
    pendingMeasurementFrame = null;
    if (!isCurrent() || !panelEl || !s.target) return;
    const el2 = document.querySelector(s.target);
    if (!el2) return;
    const r2 = el2.getBoundingClientRect();
    const w = panelEl.offsetWidth;
    const h = panelEl.offsetHeight;
    const p = resolvePlacement(s.placement, r2, w, h);
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
  if (!open) {
    measurementGeneration += 1;
    if (pendingMeasurementFrame !== null) {
      cancelAnimationFrame(pendingMeasurementFrame);
      pendingMeasurementFrame = null;
    }
    measuring = false;
    return;
  }
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
    // A focused button already activates on Enter natively - handling it here
    // too would advance the tour TWICE from the trap's default-focused Next
    // button. Buttons handle their own Enter; the window handler only covers
    // presses that land outside interactive elements.
    if (
      e.key === 'Enter' &&
      e.target instanceof HTMLElement &&
      e.target.closest('button, a, [role="button"]')
    ) {
      return;
    }
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

// Keep Tab cycling inside the tour panel while it is open (the tour is a
// modal dialog - keyboard focus must not escape into the page behind it).
$effect(() => {
  if (!open) return;
  const lifecycle = beginDialogLifecycle({ lockBodyScroll: false });
  void tick().then(() => lifecycle.attach(overlayEl, panelEl));
  return () => lifecycle.cleanup();
});

onDestroy(() => {
  measurementGeneration += 1;
  if (pendingMeasurementFrame !== null) {
    cancelAnimationFrame(pendingMeasurementFrame);
    pendingMeasurementFrame = null;
  }
  window.removeEventListener('keydown', handleKey);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onResize, true);
});
</script>

{#if open && step}
  <div
    bind:this={overlayEl}
    class="fixed inset-0 {PORTAL_Z_CLASS.tour}"
    role="dialog"
    aria-modal="true"
    aria-labelledby="product-tour-title"
  >
    <!-- Full-screen dim; cutout via box-shadow on hole -->
    {#if hole.visible}
      <div
        class="absolute rounded-xl pointer-events-none motion-safe:transition-all motion-safe:duration-200 ease-out ring-2 ring-md-primary/80"
        style="
          left: {hole.left}px;
          top: {hole.top}px;
          width: {hole.width}px;
          height: {hole.height}px;
          box-shadow: 0 0 0 9999px var(--color-md-scrim-modal);
        "
      ></div>
      <!-- Block clicks outside hole -->
      <div class="absolute inset-0" style="pointer-events: auto"></div>
      <!-- Allow interaction with hole area (optional - keep blocked for guided feel) -->
    {:else}
      <div class="absolute inset-0 bg-md-scrim-modal backdrop-blur-[2px]"></div>
    {/if}

    <!-- Tooltip / step card -->
    <div
      bind:this={panelEl}
      class="dialog-padding absolute z-10 w-[min(300px,calc(100vw-24px))] rounded-2xl border border-md-outline-variant/30 bg-md-surface {ELEVATION.level3} text-md-on-surface motion-safe:transition-all motion-safe:duration-200"
      style={tip.placement === 'center'
        ? `left: 50%; top: 50%; transform: translate(-50%, -50%);`
        : `left: ${tip.left}px; top: ${tip.top}px;`}
    >
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="flex items-center gap-2 min-w-0">
          <div class="flex gap-1 flex-wrap">
            {#each steps as _, i (i)}
              <div
                class="h-1.5 rounded-full motion-safe:transition-all {i === stepIndex
                  ? 'w-4 bg-md-primary'
                  : i < stepIndex
                    ? 'w-1.5 bg-md-primary/50'
                    : 'w-1.5 bg-md-outline-variant'}"
              ></div>
            {/each}
          </div>
          <span class="text-xs text-md-on-surface-variant shrink-0"
            >{stepIndex + 1} / {total}</span
          >
        </div>
        <IconButton icon="close" ariaLabel={$t('productTour.skip')} title={$t('productTour.skip')} onclick={onSkip} />
      </div>

      <h2 id="product-tour-title" class="dialog-heading mb-2">
        {$t(step.titleKey)}
      </h2>
      <p class="dialog-description mb-3">
        {$t(step.bodyKey)}
      </p>

      <div class="flex flex-nowrap gap-3" use:responsiveButtonLayout data-action-tier="S">
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
        class="md-action w-full min-h-10 mt-2 rounded-xl text-sm text-md-on-surface-variant py-1"
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
