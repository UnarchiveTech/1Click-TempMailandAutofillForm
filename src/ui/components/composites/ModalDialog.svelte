<script lang="ts">
import { onDestroy, type Snippet, tick } from 'svelte';
import { t } from 'svelte-i18n';
import {
  cancelTopEscapeTier,
  registerEscapeTier,
  topEscapeTierId,
} from '@/features/keyboard-shortcuts/escape-stack.js';
import type { ActivityDialogKey } from '@/features/types/view-types.js';
import BottomSheet from '@/ui/components/composites/BottomSheet.svelte';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import ProgressBar, { type ProgressProps } from '@/ui/components/primitives/ProgressBar.svelte';
import { subscribeBottomSheetPreference } from '@/utils/ui/bottom-sheet-preference.js';
import { beginDialogLifecycle } from '@/utils/ui/dialog-lifecycle.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import {
  PORTAL_Z_CLASS,
  portalToBody,
  portalToTriggerContainer,
} from '@/utils/ui/portal-layers.js';

interface Props {
  open: boolean;
  title?: string;
  wrapTitle?: boolean;
  subtitle?: string;
  /** Keep short control dialogs' region gaps tight even on a roomy surface. */
  compact?: boolean;
  showCloseButton?: boolean;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  triggerElement?: HTMLElement | null;
  ariaLabel?: string;
  onClose: () => void;
  children?: Snippet;
  /** False when children provide their own framed scrolling body.
   * Fixed actions belong in `footer`, outside that body's padding and scroll. */
  bodyScroll?: boolean;
  footer?: Snippet;
  headerActions?: Snippet;
  dialogRef?: HTMLElement | null;
  /** Live progress shown between the header and the body (async operations). */
  progress?: ProgressProps | null;
  /** Stable Activity category; unclassified dialogs are still counted. */
  activityDialogKey?: ActivityDialogKey;
}

let {
  open,
  title,
  wrapTitle = true,
  subtitle,
  compact = false,
  showCloseButton = true,
  maxWidth = 'md',
  triggerElement,
  ariaLabel,
  onClose,
  children,
  bodyScroll = true,
  footer,
  headerActions,
  dialogRef = $bindable(null),
  progress,
  activityDialogKey = 'dialog:other',
}: Props = $props();

let overlayEl = $state<HTMLElement | null>(null);
let innerRef = $state<HTMLElement | null>(null);
let dialogLifecycle = $state<ReturnType<typeof beginDialogLifecycle> | null>(null);
let useBottomSheet = $state(false);
const instanceId = $props.id();

$effect(() =>
  subscribeBottomSheetPreference((value) => {
    useBottomSheet = value;
  })
);
const escapeTierId = `modal-dialog:${instanceId}`;

const bottomSheetMaxWidth: Record<NonNullable<Props['maxWidth']>, 'sm' | 'md' | 'lg' | 'full'> = {
  xs: 'sm',
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'lg',
  '2xl': 'lg',
  full: 'full',
};

// M3 basic dialog: min 280dp, max 560dp. The top two tiers are clamped to the
// 560dp maximum (`max-w-xl` is 576px and `max-w-2xl` is 672px, both over it).
const maxWidthClasses: Record<NonNullable<Props['maxWidth']>, string> = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-[560px]',
  '2xl': 'max-w-[560px]',
  full: 'max-w-full m-2',
};

// Portal handling
$effect(() => {
  if (!open || useBottomSheet || !overlayEl) return;
  if (triggerElement) {
    const { destroy } = portalToTriggerContainer(overlayEl, triggerElement);
    return destroy;
  } else {
    return portalToBody(overlayEl);
  }
});

onDestroy(() => {
  try {
    if (overlayEl?.parentElement) {
      overlayEl.remove();
    }
  } catch {
    /* ignore */
  }
});

// Focus trap, body scroll locking, and focus restoration share one lifecycle.
$effect(() => {
  if (!open || useBottomSheet) return;
  const lifecycle = beginDialogLifecycle();
  dialogLifecycle = lifecycle;
  void tick().then(() => lifecycle.attach(dialogRef || innerRef));
  return () => {
    lifecycle.cleanup();
    if (dialogLifecycle === lifecycle) dialogLifecycle = null;
  };
});

// Only the topmost modal owns Escape. This prevents a nested dialog from
// closing itself and its parent during the same key event.
$effect(() => {
  if (!open || useBottomSheet) return;
  return registerEscapeTier(escapeTierId, onClose);
});
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && open && !useBottomSheet && topEscapeTierId() === escapeTierId) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelTopEscapeTier();
    }
  }}
/>

{#if open}
  {#if useBottomSheet}
    <BottomSheet
      open={true}
      title={title}
      {wrapTitle}
      subtitle={subtitle}
      showCloseButton={showCloseButton}
      maxWidth={bottomSheetMaxWidth[maxWidth]}
      ariaLabel={ariaLabel}
      {activityDialogKey}
      bind:dialogRef
      onClose={onClose}
      progress={progress}
      {headerActions}
      {footer}
      {bodyScroll}
      {compact}
    >
      {#if children}
        {@render children()}
      {/if}
    </BottomSheet>
  {:else}
  <!-- Portaled modal shell with z-[10000] layer -->    <div
      bind:this={overlayEl}
      class="dialog-viewport-inset fixed inset-0 {PORTAL_Z_CLASS.dialog} flex items-center justify-center p-4 overflow-y-auto backdrop-blur-sm bg-md-scrim-basic"

      data-portal-layer="dialog"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || (title ? undefined : $t('common.confirm'))}
      aria-labelledby={title && !ariaLabel ? `${instanceId}-title` : undefined}
      aria-describedby={subtitle ? `${instanceId}-subtitle` : undefined}
      data-activity-dialog-key={activityDialogKey}
    >
    <!-- Backdrop backdrop click (mouse-only dismiss; Escape handled globally above) -->
    <div
      class="fixed inset-0 -z-10 cursor-default"
      aria-hidden="true"
      onclick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    ></div>

    <!-- Modal Card -->
    <div
      bind:this={innerRef}
      class="dialog-surface dialog-layout dialog-block-padding {compact ? 'dialog-compact' : ''} scroll-frame dialog-enter bg-md-surface-container-high rounded-2xl {ELEVATION.level3} w-full min-w-[280px] relative my-auto z-10 max-h-[calc(100dvh-2rem)] {maxWidthClasses[maxWidth]}"
      tabindex="-1"
    >
      <!-- Header -->
      {#if title || subtitle || showCloseButton || headerActions}
        <div class="dialog-header dialog-inset scroll-edge shrink-0">
          {#if title || showCloseButton || headerActions}
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0 flex-1">
                {#if title}
                  <h2 id={`${instanceId}-title`} class="dialog-heading {wrapTitle ? 'break-words' : 'truncate'}">{title}</h2>
                {/if}
              </div>
              <div class="flex shrink-0 items-center gap-1 ms-2">
                {#if headerActions}
                  {@render headerActions()}
                {/if}
                {#if showCloseButton}
                  <IconButton
                    icon="close"
                    size="sm"
                    ariaLabel={$t('common.close')}
                    title={$t('common.close')}
                    onclick={onClose}
                  />
                {/if}
              </div>
            </div>
          {/if}
          {#if subtitle}
            <p id={`${instanceId}-subtitle`} class="dialog-description break-words">{subtitle}</p>
          {/if}
        </div>
      {/if}

      <!-- Live progress (async operations) -->
      {#if progress}
        <div class="dialog-inset scroll-edge shrink-0">
          <ProgressBar size="sm" {...progress} />
        </div>
      {/if}

      <!-- Body Content -->
      {#if children}
        <div class="dialog-inset min-w-0 min-h-0 {bodyScroll ? 'scroll-body scroll-body-framed overflow-y-auto' : 'flex flex-col overflow-hidden'}">
          {@render children()}
        </div>
      {/if}

      <!-- Footer -->
      {#if footer}
        <div class="dialog-actions dialog-inset scroll-edge flex shrink-0 items-center justify-end gap-2">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
  {/if}
{/if}
