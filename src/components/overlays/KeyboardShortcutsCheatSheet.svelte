<script lang="ts">
import { tick } from 'svelte';
import Icon from '@/components/icons/Icon.svelte';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { portalToBody } from '@/utils/portal-layers.js';
import type { Keybindings } from '@/utils/types.js';

let {
  open = false,
  keybindings = {} as Partial<Keybindings>,
  onClose = () => {},
} = $props<{
  open?: boolean;
  keybindings?: Partial<Keybindings>;
  onClose?: () => void;
}>();

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform || '');

const shortcutLabels: Record<string, string> = {
  refreshInbox: 'Refresh Inbox',
  createInbox: 'Create New Inbox',
  copyEmail: 'Copy Active Address',
  copyOtp: 'Copy Recent OTP',
  closeDialogs: 'Close Overlays / Dialogs',
  openAddresses: 'Open Addresses',
  openIdentities: 'Open Identities',
  openSavedLogins: 'Open Saved Logins',
  toggleAccountSelector: 'Account Selector',
  focusSearch: 'Focus Search (Alt+Shift+F)',
};

/** Extra fixed shortcuts not stored in Keybindings */
const fixedShortcuts: Array<{ label: string; keys: string[] }> = [
  { label: 'Focus search (any page)', keys: ['/'] },
  { label: 'Next message in list', keys: ['J'] },
  { label: 'Previous message in list', keys: ['K'] },
  { label: 'Command palette', keys: [isMac ? '⌘' : 'Ctrl', 'K'] },
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
let overlayEl = $state<HTMLElement | null>(null);
let cleanupFocusTrap: (() => void) | null = null;
let previousActiveElement: HTMLElement | null = null;

$effect(() => {
  if (open && overlayEl) {
    return portalToBody(overlayEl);
  }
});

// Handle Escape globally when open
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open) {
    e.stopPropagation();
    onClose();
  }
}

$effect(() => {
  if (open) {
    previousActiveElement = document.activeElement as HTMLElement;
    window.addEventListener('keydown', handleKeydown);
    document.body.style.overflow = 'hidden';

    void tick().then(() => {
      if (dialogRef) {
        cleanupFocusTrap = setupFocusTrap(dialogRef);
      }
    });
  }
  return () => {
    window.removeEventListener('keydown', handleKeydown);
    document.body.style.overflow = '';
    if (cleanupFocusTrap) {
      cleanupFocusTrap();
      cleanupFocusTrap = null;
    }
    if (previousActiveElement) {
      previousActiveElement.focus();
      previousActiveElement = null;
    }
  };
});
</script>

{#if open}
  <div
    bind:this={overlayEl}
    class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="cheat-sheet-title"
  >
    <!-- Glassmorphism backdrop -->
    <div
      class="absolute inset-0 bg-md-scrim/30 backdrop-blur-sm transition-opacity"
      role="button"
      tabindex="-1"
      aria-label="Dismiss shortcut sheet"
      onclick={(e) => { e.stopPropagation(); onClose(); }}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose(); }}
    ></div>

    <!-- Modal Card -->
    <div
      class="dialog-enter relative w-full max-w-sm bg-md-surface-container/90 backdrop-blur-xl border border-md-outline-variant/30 rounded-2xl shadow-2xl p-5 flex flex-col gap-4 text-md-on-surface z-10"
      bind:this={dialogRef}
      tabindex="-1"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-md-outline-variant/20 pb-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-md-primary/10 flex items-center justify-center text-md-primary">
            <Icon name="key" class="w-4 h-4" />
          </div>
          <div>
            <h2 id="cheat-sheet-title" class="text-sm font-bold tracking-tight">Keyboard Shortcuts</h2>
            <p class="text-xs text-md-on-surface/50">Quick navigation & action hotkeys</p>
          </div>
        </div>
        <button
          class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-md-surface-variant/50 transition-colors"
          onclick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="Close keyboard cheat sheet"
        >
          <Icon name="x" class="w-4 h-4 text-md-on-surface/60" />
        </button>
      </div>

      <!-- Shortcuts list -->
      <div class="space-y-2.5">
        {#each Object.entries(shortcutLabels) as [key, label]}
          {@const binding = keybindings[key as keyof Keybindings]}
          {@const keyCaps = formatKey(binding)}
          <div class="flex items-center justify-between p-2 rounded-xl bg-md-surface-container-low/60 border border-md-outline-variant/10">
            <span class="text-xs font-medium text-md-on-surface/80">{label}</span>
            <div class="flex items-center gap-1">
              {#each keyCaps as cap}
                <kbd class="px-2 py-1 text-xs font-mono font-bold bg-md-surface-variant/60 text-md-on-surface-variant rounded-md shadow-sm border border-md-outline-variant/30">
                  {cap}
                </kbd>
              {/each}
            </div>
          </div>
        {/each}

        {#each fixedShortcuts as row (row.label)}
          <div class="flex items-center justify-between p-2 rounded-xl bg-md-surface-container-low/60 border border-md-outline-variant/10">
            <span class="text-xs font-medium text-md-on-surface/80">{row.label}</span>
            <div class="flex items-center gap-1">
              {#each row.keys as cap}
                <kbd class="px-2 py-1 text-xs font-mono font-bold bg-md-surface-variant/60 text-md-on-surface-variant rounded-md shadow-sm border border-md-outline-variant/30">
                  {cap}
                </kbd>
              {/each}
            </div>
          </div>
        {/each}

        <!-- Press ? helper hint -->
        <div class="flex items-center justify-between p-2 rounded-xl bg-md-primary/5 border border-md-primary/15">
          <span class="text-xs font-medium text-md-primary/90">Toggle Cheat Sheet</span>
          <kbd class="px-2 py-1 text-xs font-mono font-bold bg-md-primary text-md-on-primary rounded-md shadow-sm">
            ?
          </kbd>
        </div>
      </div>

      <!-- Footer -->
      <div class="text-center pt-1 border-t border-md-outline-variant/20">
        <span class="text-xs text-md-on-surface/40">Press <kbd class="px-1 py-0.5 text-xs font-mono bg-md-surface-variant rounded">Esc</kbd> or <kbd class="px-1 py-0.5 text-xs font-mono bg-md-surface-variant rounded">?</kbd> to dismiss</span>
      </div>
    </div>
  </div>
{/if}
