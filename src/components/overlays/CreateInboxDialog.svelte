<script lang="ts">
import IconX from '@/components/icons/IconX.svelte';
import { getErrorMessage } from '@/utils/errors.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { validateUsername } from '@/utils/validation.js';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (type: 'random' | 'custom', username?: string) => void;
}

let { open, onClose, onCreate }: Props = $props();

let inboxType = $state<'random' | 'custom'>('random');
let customUsername = $state('');
let validationError = $state('');
let dialogRef = $state<HTMLElement | null>(null);
let cleanupFocusTrap: (() => void) | null = null;

// Setup focus trap when dialog opens
$effect(() => {
  if (open && dialogRef) {
    setTimeout(() => {
      if (dialogRef) {
        cleanupFocusTrap = setupFocusTrap(dialogRef);
      }
    }, 50);
  }
  return () => {
    if (cleanupFocusTrap) {
      cleanupFocusTrap();
      cleanupFocusTrap = null;
    }
  };
});

function handleCreate() {
  validationError = '';
  if (inboxType === 'random') {
    onCreate('random');
  } else {
    const trimmed = customUsername.trim();
    if (trimmed) {
      try {
        validateUsername(trimmed);
        onCreate('custom', trimmed);
      } catch (error) {
        validationError = getErrorMessage(error);
      }
    }
  }
}

function handleClose() {
  inboxType = 'random';
  customUsername = '';
  validationError = '';
  onClose();
}
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
    <div
      class="absolute inset-0 bg-md-surface/30 backdrop-blur-sm"
      role="button"
      tabindex="-1"
      onclick={handleClose}
      onkeydown={(e) => e.key === 'Escape' && handleClose()}
    ></div>

    <button
      class="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-md-surface hover:bg-md-surface-variant flex items-center justify-center shadow-md transition-colors"
      aria-label="Close dialog"
      onclick={handleClose}
    >
      <IconX class="w-4 h-4 text-md-on-surface/70" />
    </button>

    <div
      class="relative bg-md-surface rounded-xl px-4 py-2"
      style="width: 350px"
      tabindex="-1"
      bind:this={dialogRef}
    >
      <div>
        <h3 class="font-bold text-sm mb-1">Create New Inbox</h3>
      </div>

      <!-- Inbox type selection -->
      <div class="flex flex-col gap-3">
        <label class="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors {inboxType === 'random' ? 'border-md-primary bg-md-primary/5' : 'border-md-outline-variant hover:border-md-secondary-container/20'}">
          <input
            type="radio"
            bind:group={inboxType}
            value="random"
            class="radio radio-sm"
            aria-label="Random email address"
          />
          <div class="flex-1">
            <p class="text-sm font-semibold text-md-on-surface">Random Guerrilla Mail</p>
            <p class="text-xs text-md-on-surface/50">Generate a random email address</p>
          </div>
        </label>

        <label class="flex flex-col gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors {inboxType === 'custom' ? 'border-md-primary bg-md-primary/5' : 'border-md-outline-variant hover:border-md-secondary-container/20'}">
          <div class="flex items-center gap-3">
            <input
              type="radio"
              bind:group={inboxType}
              value="custom"
              class="radio radio-sm"
              aria-label="Custom username"
            />
            <p class="text-sm font-semibold text-md-on-surface">Custom Username</p>
          </div>
          {#if inboxType === 'custom'}
            <div class="flex items-center gap-2 ml-7">
              <input
                type="text"
                class="flex-1 px-2 py-1.5 text-sm rounded-lg border border-md-outline-variant bg-md-surface-container-low outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                placeholder="Enter username..."
                aria-label="Custom username"
                bind:value={customUsername}
                oninput={() => validationError = ''}
                onkeydown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  else if (e.key === 'Escape') handleClose();
                }}
              />
              <span class="text-xs text-md-on-surface/50">@guerrillamailblock.com</span>
            </div>
            {#if validationError}
              <p class="text-xs text-md-error ml-7">{validationError}</p>
            {:else}
              <p class="text-xs text-md-on-surface/40 ml-7">1-64 characters, letters, numbers, and underscores only</p>
            {/if}
          {/if}
        </label>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-2 pt-1">
        <button class="flex-1 px-3 py-1.5 text-sm rounded-xl bg-md-secondary text-md-on-secondary hover:bg-md-secondary/90 transition-colors" aria-label="Cancel creating inbox" onclick={handleClose}>Cancel</button>
        <button class="flex-1 px-3 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" aria-label="Create new inbox" onclick={handleCreate} disabled={inboxType === 'custom' && !customUsername.trim()}>Create</button>
      </div>
    </div>
  </div>
{/if}
