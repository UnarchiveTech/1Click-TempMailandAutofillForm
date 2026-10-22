<script lang="ts">
import { onDestroy, type Snippet, tick } from 'svelte';
import { t } from 'svelte-i18n';
import {
  cancelTopEscapeTier,
  registerEscapeTier,
  topEscapeTierId,
} from '@/features/keyboard-shortcuts/escape-stack.js';
import type { ActivityDialogKey } from '@/features/types/view-types.js';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import ProgressBar, { type ProgressProps } from '@/ui/components/primitives/ProgressBar.svelte';
import { beginDialogLifecycle } from '@/utils/ui/dialog-lifecycle.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS, portalToBody } from '@/utils/ui/portal-layers.js';

interface Props {
  open: boolean;
  title?: string;
  wrapTitle?: boolean;
  subtitle?: string;
  compact?: boolean;
  showCloseButton?: boolean;
  /** Dismiss on backdrop click / Escape. Defaults true; set false for
   * non-closable overlays (must be closed programmatically). */
  dismissible?: boolean;
  /** Bottom sheet max width - constrains the sheet on wide screens. */
  maxWidth?: 'sm' | 'md' | 'lg' | 'full';
  ariaLabel?: string;
  onClose: () => void;
  children?: Snippet;
  /** False when children own the framed scrolling body. */
  bodyScroll?: boolean;
  footer?: Snippet;
  headerActions?: Snippet;
  dialogRef?: HTMLElement | null;
  /** Additional classes for the sheet surface. */
  surfaceClass?: string;
  /** Additional classes for the body wrapper. */
  contentClass?: string;
  /** Live progress shown between the header and the body (async operations). */
  progress?: ProgressProps | null;
  /** Stable Activity category; unclassified dialogs are still counted. */
  activityDialogKey?: ActivityDialogKey;
}

let {
  open,
  title,
  wrapTitle = false,
  subtitle,
  compact = false,
  showCloseButton = true,
  dismissible = true,
  maxWidth = 'md',
  ariaLabel,
  onClose,
  children,
  bodyScroll = true,
  footer,
  headerActions,
  dialogRef = $bindable(null),
  surfaceClass = '',
  contentClass = '',
  progress,
  activityDialogKey = 'dialog:other',
}: Props = $props();

let overlayEl = $state<HTMLElement | null>(null);
let sheetRef = $state<HTMLElement | null>(null);
let dialogLifecycle = $state<ReturnType<typeof beginDialogLifecycle> | null>(null);
const instanceId = $props.id();
const escapeTierId = `bottom-sheet:${instanceId}`;

const maxWidthClasses: Record<NonNullable<Props['maxWidth']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  full: 'max-w-full m-2',
};

// Portal the sheet to document.body so it clears any transformed ancestor.
$effect(() => {
  if (!open || !overlayEl) return;
  return portalToBody(overlayEl);
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
  if (!open) return;
  const lifecycle = beginDialogLifecycle();
  dialogLifecycle = lifecycle;
  void tick().then(() => lifecycle.attach(dialogRef));
  return () => {
    lifecycle.cleanup();
    if (dialogLifecycle === lifecycle) dialogLifecycle = null;
  };
});

$effect(() => {
  if (!open) return;
  return registerEscapeTier(escapeTierId, () => {
    if (dismissible) onClose();
  });
});
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && open && topEscapeTierId() === escapeTierId) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelTopEscapeTier();
    }
  }}
/>

{#if open}
  <!-- Portaled bottom-sheet shell (dialog z-index layer) -->
  <div
    bind:this={overlayEl}
    class="fixed inset-0 {PORTAL_Z_CLASS.dialog} flex items-end justify-center bg-md-scrim-modal backdrop-blur-sm"
    data-portal-layer="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={ariaLabel || (title ? undefined : $t('common.confirm'))}
    aria-labelledby={title && !ariaLabel ? `${instanceId}-title` : undefined}
    aria-describedby={subtitle ? `${instanceId}-subtitle` : undefined}
    data-activity-dialog-key={activityDialogKey}
  >
    <!-- Backdrop (only dismisses when dismissible; mouse-only dismiss, Escape handled globally above) -->
    <div
      class="fixed inset-0 -z-10 cursor-default"
      aria-hidden="true"
      onclick={(e) => {
        e.stopPropagation();
        if (dismissible) onClose();
      }}
    ></div>

    <!-- Sheet -->
    <div
      bind:this={dialogRef}
      style="--input-label-surface: var(--md-surface-container);"
      class="dialog-surface {compact ? 'dialog-compact' : ''} scroll-frame w-full {maxWidthClasses[maxWidth]} rounded-t-2xl bg-md-surface-container {ELEVATION.level3} border-t border-x border-md-outline-variant/20 relative z-10 flex flex-col max-h-[85vh] {surfaceClass}"
      tabindex="-1"
    >
      <!-- Drag handle affordance -->
      <div class="shrink-0 flex justify-center pt-2 pb-1">
        <div class="w-10 h-1 rounded-full bg-md-outline-variant/50" aria-hidden="true"></div>
      </div>

      <!-- Header -->
      {#if title || subtitle || showCloseButton || headerActions}
        <div class="dialog-header dialog-inset scroll-edge shrink-0 pb-2 border-b border-md-outline-variant/15">
          {#if title || headerActions || (showCloseButton && dismissible)}
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0 flex-1">
                {#if title}
                  <h2 id={`${instanceId}-title`} class="dialog-heading {wrapTitle ? 'break-words' : 'truncate'}">{title}</h2>
                {/if}
              </div>
              <div class="flex shrink-0 items-center gap-1 ms-2">
                {#if headerActions}
                  {@render headerActions()}
                {/if}
                {#if showCloseButton && dismissible}
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
        <div class="dialog-inset scroll-edge pt-2 pb-1 shrink-0">
          <ProgressBar size="sm" {...progress} />
        </div>
      {/if}

      <!-- Body Content -->
      {#if children}
        <div class="dialog-inset dialog-body-padding min-w-0 min-h-0 {bodyScroll ? 'scroll-body scroll-body-framed overflow-y-auto' : 'flex flex-col overflow-hidden'} {contentClass}">
          {@render children()}
        </div>
      {/if}

      <!-- Footer -->
      {#if footer}
        <div class="dialog-inset dialog-body-padding scroll-edge shrink-0 border-t border-md-outline-variant/15 flex items-center justify-end gap-2">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}
