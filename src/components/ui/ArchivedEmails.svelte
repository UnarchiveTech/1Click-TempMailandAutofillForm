<script lang="ts">
import IconArchive from '@/components/icons/IconArchive.svelte';
import IconInbox from '@/components/icons/IconInbox.svelte';
import IconSearch from '@/components/icons/IconSearch.svelte';
import IconTrash from '@/components/icons/IconTrash.svelte';
import type { Email } from '@/utils/types.js';

let {
  onBack = () => {},
  archivedSearch = '',
  filteredArchivedEmails = [],
  onSearchChange = () => {},
  onRestore = () => {},
  onDelete = () => {},
  onClearSearch = () => {},
} = $props<{
  onBack?: () => void;
  archivedSearch?: string;
  filteredArchivedEmails?: Email[];
  onSearchChange?: (value: string) => void;
  onRestore?: (email: Email) => void;
  onDelete?: (email: Email) => void;
  onClearSearch?: () => void;
}>();
</script>

<!-- Search -->
<div class="px-4 py-2">
  <div class="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-surface-container-low">
    <IconSearch class="w-4 h-4 text-md-on-surface/40 shrink-0" />
    <input type="text" class="grow bg-transparent outline-none" placeholder="Search archived emails..." value={archivedSearch} oninput={(e) => onSearchChange((e.target as HTMLInputElement).value)} />
  </div>
</div>
<div class="flex-1 overflow-y-auto px-4 py-3 space-y-3" style="scrollbar-width: thin; scrollbar-color: var(--md-primary) transparent;">
  {#if filteredArchivedEmails.length === 0}
    <div class="flex flex-col items-center justify-center pt-8 pb-4">
      <IconInbox class="w-12 h-12 text-md-on-surface/30 mb-3" />
      <p class="text-sm text-md-on-surface/50 mb-3">No archived emails found</p>
      <button class="px-3 py-1.5 text-sm rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors" onclick={onClearSearch}>
        Clear Search
      </button>
    </div>
  {:else}
    {#each filteredArchivedEmails as email}
      <div class="bg-md-surface-container-low rounded-xl p-3">
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <div class="font-semibold text-sm">{email.subject}</div>
            <div class="text-xs text-md-on-surface/60 mt-1">
              <div>From: {email.from}</div>
              <div>Date: {email.date}</div>
            </div>
          </div>
          <div class="flex gap-1">
            <button class="w-6 h-6 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors" aria-label="Restore email" onclick={() => onRestore(email)}>
              <IconArchive class="w-4 h-4 text-md-success" />
            </button>
            <button class="w-6 h-6 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant text-md-error transition-colors" aria-label="Delete email" onclick={() => onDelete(email)}>
              <IconTrash class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>
