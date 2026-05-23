<script lang="ts">
import IconCopy from '@/components/icons/IconCopy.svelte';
import IconLock from '@/components/icons/IconLock.svelte';
import IconTrash from '@/components/icons/IconTrash.svelte';
import type { CredentialsHistoryItem } from '@/utils/types.js';

let {
  context = 'popup',
  onBack = () => {},
  savedLogins = [],
  onDelete = () => {},
} = $props<{
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  savedLogins?: CredentialsHistoryItem[];
  onDelete?: (id: string) => void;
}>();

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}
</script>

<div class="flex-1 overflow-y-auto px-4 py-3 space-y-3" style="scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--md-outline, #75777f) 0.2, transparent) transparent;">
  {#if savedLogins.length === 0}
    <div class="text-center py-8 text-md-on-surface/50">
      <IconLock class="w-12 h-12 mx-auto mb-2 opacity-30" />
      <p class="text-sm">No saved login info yet</p>
    </div>
  {:else}
    {#each savedLogins as login}
      <div class="bg-md-secondary-container rounded-xl">
        <div class="p-3">
          <div class="flex justify-between items-start">
            <div class="flex-1 space-y-2">
              <div class="font-semibold text-sm">{login.domain}</div>
              <div class="flex items-center gap-2 text-xs text-md-on-surface/60">
                <span>Email: {login.email || 'N/A'}</span>
                <button class="w-5 h-5 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container transition-colors" aria-label="Copy email" onclick={() => copyToClipboard(login.email)}>
                  <IconCopy class="w-3 h-3" />
                </button>
              </div>
              <div class="flex items-center gap-2 text-xs text-md-on-surface/60">
                <span>Password: {login.password}</span>
                <button class="w-5 h-5 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container transition-colors" aria-label="Copy password" onclick={() => copyToClipboard(login.password)}>
                  <IconCopy class="w-3 h-3" />
                </button>
              </div>
              {#if login.otp}
                <div class="flex items-center gap-2 text-xs text-md-primary">
                  <span>OTP: {login.otp}</span>
                  <button class="w-5 h-5 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container transition-colors" aria-label="Copy OTP" onclick={() => copyToClipboard(login.otp)}>
                    <IconCopy class="w-3 h-3" />
                  </button>
                </div>
              {/if}
            </div>
            <button class="w-5 h-5 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container text-md-error transition-colors" aria-label="Delete login" onclick={() => onDelete(login.id)}>
              <IconTrash class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>
