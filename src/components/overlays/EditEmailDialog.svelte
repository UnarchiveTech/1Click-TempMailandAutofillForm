<script lang="ts">
import IconX from '@/components/icons/IconX.svelte';
import { getErrorMessage } from '@/utils/errors.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { validateUsername } from '@/utils/validation.js';

interface Props {
  open: boolean;
  currentUsername: string;
  domain: string;
  onClose: () => void;
  onSave: (username: string) => void;
}

let { open, currentUsername, domain, onClose, onSave }: Props = $props();

let usernameInput = $state('');
let validationError = $state('');
let dialogRef = $state<HTMLElement | null>(null);
let cleanupFocusTrap: (() => void) | null = null;

// Initialize with current username when dialog opens
$effect(() => {
  if (open) {
    usernameInput = currentUsername;
    validationError = '';
  }
});

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

function handleSave() {
  const trimmedUsername = usernameInput.trim();
  if (trimmedUsername && trimmedUsername !== currentUsername) {
    try {
      validateUsername(trimmedUsername);
      onSave(trimmedUsername);
    } catch (error) {
      validationError = getErrorMessage(error);
    }
  }
}
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
    <div
      class="absolute inset-0 bg-md-surface/30 backdrop-blur-sm"
      role="button"
      tabindex="-1"
      onclick={onClose}
      onkeydown={(e) => e.key === 'Escape' && onClose()}
    ></div>

    <button
      class="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-md-surface hover:bg-md-surface-variant flex items-center justify-center shadow-md transition-colors"
      aria-label="Close dialog"
      onclick={onClose}
    >
      <IconX class="w-4 h-4 text-md-on-surface/70" />
    </button>

    <div class="bg-md-surface rounded-xl px-4 py-2">
      <div
        class="relative z-10 bg-md-surface rounded-xl shadow-2xl p-5 flex flex-col gap-4 w-96"
        tabindex="-1"
        bind:this={dialogRef}
      >
        <div>
          <h3 class="font-bold text-base mb-1">Edit Email Address</h3>
          <p class="text-xs text-md-on-surface/60">Change your username (domain will remain {domain})</p>

        </div>
      <!-- Input field -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <input
            type="text"
            class="flex-1 px-2 py-1.5 text-sm rounded-lg border border-md-outline-variant bg-md-surface-container-low outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
            placeholder="Enter new username..."
            bind:value={usernameInput}
            oninput={() => validationError = ''}
            onkeydown={(e) => {
              if (e.key === 'Enter') handleSave();
              else if (e.key === 'Escape') onClose();
            }}
          />
          <span class="text-xs text-md-on-surface/50">@{domain}</span>
        </div>
        <p class="text-xs text-md-on-surface/40">Current: {currentUsername}@{domain}</p>
        {#if validationError}
          <p class="text-xs text-md-error">{validationError}</p>
        {/if}
      </div>

      <!-- Action buttons -->
      <div class="flex gap-2 pt-2">
        <button
          class="flex-1 px-3 py-1.5 text-sm rounded-xl bg-md-secondary text-md-on-secondary hover:bg-md-secondary/90 transition-colors"
          aria-label="Cancel"
          onclick={onClose}
        >
          Cancel
        </button>
        <button
          class="flex-1 px-3 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors"
          aria-label="Save email address"
          onclick={handleSave}
          disabled={!usernameInput.trim() || usernameInput.trim() === currentUsername}
        >
          Save
        </button>
      </div>
    </div>
  </div>
</div>
{/if}
