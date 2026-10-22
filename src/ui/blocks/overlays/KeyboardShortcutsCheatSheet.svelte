<script lang="ts">
import { tick } from 'svelte';
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import type { Keybindings } from '@/utils/types.js';
import { subscribeBottomSheetPreference } from '@/utils/ui/bottom-sheet-preference.js';
import { beginDialogLifecycle } from '@/utils/ui/dialog-lifecycle.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS, portalToBody } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';

let {
  open = false,
  keybindings = {} as Partial<Keybindings>,
  onClose = () => {},
  onOpenSettings = () => {},
}: {
  open?: boolean;
  keybindings?: Partial<Keybindings>;
  onClose?: () => void;
  onOpenSettings?: () => void;
} = $props();

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform || '');

const shortcutLabels: Record<string, { label: string; icon: KnownIconName }> = {
  refreshMailbox: { label: 'keyboardShortcuts.refreshMailbox', icon: 'refresh' },
  createAddress: { label: 'keyboardShortcuts.createAddress', icon: 'add' },
  copyEmail: { label: 'keyboardShortcuts.copyEmail', icon: 'contentCopy' },
  copyOtp: { label: 'keyboardShortcuts.copyOtp', icon: 'key' },
  closeDialogs: { label: 'keyboardShortcuts.closeDialogs', icon: 'close' },
  openAddresses: { label: 'keyboardShortcuts.openAddresses', icon: 'mail' },
  openIdentities: { label: 'keyboardShortcuts.openIdentities', icon: 'person' },
  openSavedLogins: { label: 'keyboardShortcuts.openSavedLogins', icon: 'lock' },
  toggleAccountSelector: { label: 'keyboardShortcuts.toggleAccountSelector', icon: 'person' },
  focusSearch: { label: 'keyboardShortcuts.focusSearch', icon: 'search' },
};

/** Extra fixed shortcuts not stored in Keybindings */
const fixedShortcuts: Array<{ label: string; keys: string[]; icon: KnownIconName }> = [
  { label: 'keyboardShortcuts.fixedFocusSearch', keys: ['/'], icon: 'search' },
  { label: 'keyboardShortcuts.fixedNextMessage', keys: ['J'], icon: 'chevronDown' },
  { label: 'keyboardShortcuts.fixedPreviousMessage', keys: ['K'], icon: 'chevronUp' },
  {
    label: 'keyboardShortcuts.fixedCommandPalette',
    keys: [isMac ? '⌘' : 'Ctrl', 'K'],
    icon: 'gridView',
  },
  // Multi-select from the keyboard. The Select row that used to be every list's
  // pointer-free way in has been retired (the shell renders one selection strip),
  // so these four are that way in: `X` ticks the row the cursor is on, arrows
  // move it, Shift+arrows extend, and Enter runs the list's own first action -
  // the same one the strip's first button shows.
  { label: 'keyboardShortcuts.fixedSelectRow', keys: ['X'], icon: 'check' },
  { label: 'keyboardShortcuts.fixedMoveRow', keys: ['↑', '↓'], icon: 'chevronUp' },
  { label: 'keyboardShortcuts.fixedReorderRow', keys: ['Alt', 'Shift', '↑↓'], icon: 'dragHandle' },
  { label: 'keyboardShortcuts.fixedExtendSelection', keys: ['Shift', '↑↓'], icon: 'add' },
  { label: 'keyboardShortcuts.fixedRunSelectionAction', keys: ['Enter'], icon: 'key' },
];

function formatKey(binding?: {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): string[] {
  if (!binding?.key) return ['Esc'];
  const parts: string[] = [];
  if (binding.ctrlKey || binding.metaKey) parts.push(isMac ? '⌘' : 'Ctrl');
  if (binding.shiftKey) parts.push('Shift');
  if (binding.altKey) parts.push('Alt');
  parts.push(binding.key.toUpperCase());
  return parts;
}

let dialogRef = $state<HTMLElement | null>(null);
let closeBtnRef = $state<HTMLElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);
let dialogLifecycle = $state<ReturnType<typeof beginDialogLifecycle> | null>(null);
let useBottomSheet = $state(false);

$effect(() =>
  subscribeBottomSheetPreference((value) => {
    useBottomSheet = value;
  })
);

$effect(() => {
  if (open && overlayEl) {
    return portalToBody(overlayEl);
  }
});

// Handle Escape globally when open
function handleKeydown(e: KeyboardEvent) {
  if ((e.key === 'Escape' || e.key === '?') && open && !e.isComposing) {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  }
}

$effect(() => {
  if (open) {
    const lifecycle = beginDialogLifecycle({ initialFocus: closeBtnRef });
    dialogLifecycle = lifecycle;
    window.addEventListener('keydown', handleKeydown);

    void tick().then(() => lifecycle.attach(dialogRef));
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      lifecycle.cleanup();
      if (dialogLifecycle === lifecycle) dialogLifecycle = null;
    };
  }
});
</script>

{#if open}
  <div
    bind:this={overlayEl}
    class="dialog-viewport-inset fixed inset-0 {PORTAL_Z_CLASS.dialog} flex {useBottomSheet ? 'items-end' : 'items-center'} justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="cheat-sheet-title"
  >
    <!-- Backdrop (mouse-only dismiss; Escape handled globally above) -->
    <div
      class="fixed inset-0 -z-10 cursor-default bg-md-scrim-basic backdrop-blur-sm transition-opacity"
      aria-hidden="true"
      onclick={(e) => { e.stopPropagation(); onClose(); }}
    ></div>

    <!-- Modal Card -->
    <div
      class="dialog-surface dialog-block-padding scroll-frame dialog-enter relative w-full {useBottomSheet ? 'max-w-full rounded-t-2xl' : 'max-w-sm rounded-2xl'} bg-md-surface-container/90 backdrop-blur-xl border border-md-outline-variant/30 {ELEVATION.level3} flex flex-col gap-3 text-md-on-surface z-10"
      bind:this={dialogRef}
      tabindex="-1"
    >
      <!-- Header -->
      <div class="dialog-header dialog-inset scroll-edge border-b border-md-outline-variant/20 pb-3">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <div class="w-8 h-8 shrink-0 rounded-xl bg-md-primary/10 flex items-center justify-center text-md-primary">
              <Icon name="key" class="w-6 h-6" />
            </div>
            <h2 id="cheat-sheet-title" class="dialog-heading min-w-0 break-words">{$t('keyboardShortcuts.title')}</h2>
          </div>
          <div class="flex flex-nowrap items-center gap-2" use:responsiveButtonLayout data-action-tier="XS">
            <button
              type="button"
              class="md-action w-8 h-8 shrink-0 text-md-on-surface-variant flex items-center justify-center rounded-full transition-colors"
              onclick={(e) => { e.stopPropagation(); onOpenSettings(); }}
              aria-label={$t('keyboardShortcuts.openShortcutSettingsAria')}
              title={$t('keyboardShortcuts.openShortcutSettingsAria')}
            >
              <Icon name="settings" class="w-5 h-5" />
            </button>
            <button
              bind:this={closeBtnRef}
              type="button"
              class="md-action w-8 h-8 shrink-0 text-md-on-surface-variant flex items-center justify-center rounded-full transition-colors"
              onclick={(e) => { e.stopPropagation(); onClose(); }}
              aria-label={$t('keyboardShortcuts.closeSheetAria')}
            >
              <Icon name="close" class="w-5 h-5" />
            </button>
          </div>
        </div>
        <p class="dialog-description">{$t('keyboardShortcuts.cheatSheetSubtitle')}</p>
      </div>

      <!-- Shortcuts list -->
      <div class="dialog-inset scroll-body scroll-body-framed space-y-2.5 max-h-[55vh] overflow-y-auto overscroll-contain">
        {#each Object.entries(shortcutLabels) as [key, entry]}
          {@const binding = keybindings[key as keyof Keybindings]}
          {@const keyCaps = formatKey(binding)}
          <div class="flex items-center gap-2 p-2 rounded-xl bg-md-surface-container-low/60 border border-md-outline-variant/10">
            <div class="w-6 h-6 shrink-0 rounded-full bg-md-primary/10 flex items-center justify-center text-md-primary">
              <Icon name={entry.icon} class="w-3.5 h-3.5" />
            </div>
            <span class="flex-1 text-xs font-medium text-md-on-surface">{$t(entry.label)}</span>
            <div class="flex items-center gap-1">
              {#each keyCaps as cap}
                <kbd class="px-2 py-1 text-xs font-mono font-bold bg-md-surface-variant/60 text-md-on-surface-variant rounded-md {ELEVATION.level1} border border-md-outline-variant/30">
                  {cap}
                </kbd>
              {/each}
            </div>
          </div>
        {/each}

        {#each fixedShortcuts as row (row.label)}
          <div class="flex items-center gap-2 p-2 rounded-xl bg-md-surface-container-low/60 border border-md-outline-variant/10">
            <div class="w-6 h-6 shrink-0 rounded-full bg-md-primary/10 flex items-center justify-center text-md-primary">
              <Icon name={row.icon} class="w-3.5 h-3.5" />
            </div>
            <span class="flex-1 text-xs font-medium text-md-on-surface">{$t(row.label)}</span>
            <div class="flex items-center gap-1">
              {#each row.keys as cap}
                <kbd class="px-2 py-1 text-xs font-mono font-bold bg-md-surface-variant/60 text-md-on-surface-variant rounded-md {ELEVATION.level1} border border-md-outline-variant/30">
                  {cap}
                </kbd>
              {/each}
            </div>
          </div>
        {/each}

        <!-- Press ? helper hint -->
        <div class="flex items-center justify-between p-2 rounded-xl bg-md-primary/5 border border-md-primary/15">
          <span class="text-xs font-medium text-md-primary/90">{$t('keyboardShortcuts.toggleCheatSheet')}</span>
          <kbd class="px-2 py-1 text-xs font-mono font-bold bg-md-primary text-md-on-primary rounded-md {ELEVATION.level1}">
            ?
          </kbd>
        </div>
      </div>

      <!-- Footer -->
      <div class="dialog-inset scroll-edge text-center pt-1 border-t border-md-outline-variant/20">
        <p class="text-xs text-md-on-surface-variant mb-2">{$t('shortcutDiscovery.holdHint')}</p>
        <span class="text-xs text-md-on-surface-variant">{$t('keyboardShortcuts.dismissPress')} <kbd class="px-1 py-0.5 text-xs font-mono bg-md-surface-variant rounded">Esc</kbd> {$t('keyboardShortcuts.dismissOr')} <kbd class="px-1 py-0.5 text-xs font-mono bg-md-surface-variant rounded">?</kbd> {$t('keyboardShortcuts.dismissDismiss')}</span>
      </div>
    </div>
  </div>
{/if}
