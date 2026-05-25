<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import ToastContainer from '@/components/feedback/ToastContainer.svelte';
import IconChevronDown from '@/components/icons/IconChevronDown.svelte';
import IconChevronRight from '@/components/icons/IconChevronRight.svelte';
import IconMail from '@/components/icons/IconMail.svelte';
import IconSettings from '@/components/icons/IconSettings.svelte';
import IconSun from '@/components/icons/IconSun.svelte';
import IconUser from '@/components/icons/IconUser.svelte';
import IconX from '@/components/icons/IconX.svelte';
import ConfirmDialog from '@/components/overlays/ConfirmDialog.svelte';
import ErrorBoundary from '@/components/ui/ErrorBoundary.svelte';
import LanguageSwitcher from '@/components/ui/LanguageSwitcher.svelte';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { toastStore } from '@/utils/toastStore.js';
import type { Account, Identity, Keybindings, ProviderInstance } from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';

let {
  context = 'popup',
  onBack = () => {},

  autoCopy = false,
  autoRenew = false,
  selectedProvider = '',
  savingSettings = false,
  loading = false,
  onSaveSettings = () => {},

  onSetAutoCopy = undefined,
  onSetAutoRenew = undefined,
  onHardReset = () => {},
  providerInstances = [],
  selectedProviderInstance = null,
  onSetProviderInstance = () => {},
  onExportData = () => {},
  onImportData = () => {},
  onProviderChange = () => {},
  onAddCustomInstance = () => {},
  onLoadProviderInstances = () => {},
  customColor = '',
  onColorChange = () => {},
  showDeveloperSettings = false,
  enableLogging = false,
  onToggleDeveloperSettings = () => {},
  onToggleEnableLogging = () => {},
  contrastLevel = 'standard',
  onContrastLevelChange = () => {},
  emailRetentionDays = 30,
  onSetEmailRetentionDays = undefined,
  faviconCaching = 'direct',
  onSetFaviconCaching = undefined,
  identities = [],
  selectedIdentityId = null,
  onSetSelectedIdentityId = undefined,
  onNavigateToIdentities = () => {},
  notificationsEnabled = false,
  soundEnabled = false,
  expiryWarningThreshold = 60 * 60 * 1000, // Default 1 hour
  onSetNotificationsEnabled = undefined,
  onSetSoundEnabled = undefined,
  onSetExpiryWarningThreshold = undefined,
  keybindings = DEFAULT_KEYBINDINGS,
  onSetKeybindings = undefined,
  onNavigateToKeybindings = () => {},
  onNavigateToTagManagement = () => {},
  onNavigateToFiltersManagement = () => {},
  onNavigateToMailProvider = () => {},
  onNavigateToStoragePerformance = () => {},
  onNavigateToLabelManagement = () => {},
  onNavigateToMailboxManagement = () => {},
  autoRefreshInterval = 30000,
  onSetAutoRefreshInterval = undefined,
  emailPreviewEnabled = true,
  onSetEmailPreviewEnabled = undefined,
  guerrillaDefaultDomain = '',
  onSetGuerrillaDefaultDomain = undefined,
  allInboxes = [] as Account[],
}: {
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;

  autoCopy?: boolean;
  autoRenew?: boolean;
  selectedProvider?: string;
  savingSettings?: boolean;
  loading?: boolean;
  onSaveSettings?: () => void;

  onSetAutoCopy?: (value: boolean) => void;
  onSetAutoRenew?: (value: boolean) => void;
  onHardReset?: () => void;
  providerInstances?: ProviderInstance[];
  selectedProviderInstance?: string | null;
  onSetProviderInstance?: (instanceId: string) => void;
  onExportData?: () => void;
  onImportData?: () => void;
  onProviderChange?: (provider: string) => void;
  onAddCustomInstance?: (name: string, url: string) => void;
  onLoadProviderInstances?: () => void;
  customColor?: string;
  onColorChange?: (color: string) => void;
  showDeveloperSettings?: boolean;
  enableLogging?: boolean;
  onToggleDeveloperSettings?: () => void;
  onToggleEnableLogging?: () => void;
  contrastLevel?: 'standard' | 'medium' | 'high';
  onContrastLevelChange?: (level: 'standard' | 'medium' | 'high') => void;
  emailRetentionDays?: number;
  onSetEmailRetentionDays?: (value: number) => void;
  faviconCaching?: 'direct' | 'local';
  onSetFaviconCaching?: (value: 'direct' | 'local') => void;
  identities?: Identity[];
  selectedIdentityId?: string | null;
  onSetSelectedIdentityId?: (id: string | null) => void;
  onNavigateToIdentities?: () => void;
  notificationsEnabled?: boolean;
  soundEnabled?: boolean;
  expiryWarningThreshold?: number;
  onSetNotificationsEnabled?: (value: boolean) => void;
  onSetSoundEnabled?: (value: boolean) => void;
  onSetExpiryWarningThreshold?: (value: number) => void;
  keybindings?: Keybindings;
  onSetKeybindings?: (value: Keybindings) => void;
  onNavigateToKeybindings?: () => void;
  onNavigateToTagManagement?: () => void;
  onNavigateToFiltersManagement?: () => void;
  onNavigateToMailProvider?: () => void;
  onNavigateToStoragePerformance?: () => void;
  onNavigateToLabelManagement?: () => void;
  onNavigateToMailboxManagement?: () => void;
  autoRefreshInterval?: number;
  onSetAutoRefreshInterval?: (value: number) => void;
  emailPreviewEnabled?: boolean;
  onSetEmailPreviewEnabled?: (value: boolean) => void;
  guerrillaDefaultDomain?: string;
  onSetGuerrillaDefaultDomain?: (value: string) => void;
  allInboxes?: Account[];
} = $props();

let confirmDialog = $state<{ message: string; onConfirm: () => void } | null>(null);
let confirmDialogRef = $state<HTMLElement | null>(null);

// Keybinding editing state
let editingKeybinding = $state<string | null>(null);
let recordingKeybinding = $state(false);
let recordedKeys = $state<string>('');

// Helper function to format keybinding for display
function formatKeybinding(binding: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): string {
  const parts: string[] = [];
  if (binding.ctrlKey || binding.metaKey) parts.push('Ctrl/Cmd');
  if (binding.shiftKey) parts.push('Shift');
  if (binding.altKey) parts.push('Alt');
  parts.push(binding.key.toUpperCase());
  return parts.join(' + ');
}

// Start recording a new keybinding
function startRecording(action: string) {
  editingKeybinding = action;
  recordingKeybinding = true;
  recordedKeys = '';
}

// Handle keydown during recording
function handleRecordingKeydown(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl/Cmd');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  parts.push(event.key.toUpperCase());

  recordedKeys = parts.join(' + ');

  // Save the new keybinding
  if (editingKeybinding && onSetKeybindings) {
    const newKeybindings = { ...keybindings };
    newKeybindings[editingKeybinding as keyof Keybindings] = {
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    };
    onSetKeybindings(newKeybindings);
    onSaveSettings();
  }

  recordingKeybinding = false;
  editingKeybinding = null;
  recordedKeys = '';
}

// Cancel recording
function cancelRecording() {
  recordingKeybinding = false;
  editingKeybinding = null;
  recordedKeys = '';
}

// Reset keybinding to default
function resetKeybinding(action: string) {
  if (onSetKeybindings) {
    const newKeybindings = { ...keybindings };
    newKeybindings[action as keyof Keybindings] = DEFAULT_KEYBINDINGS[action as keyof Keybindings];
    onSetKeybindings(newKeybindings);
    onSaveSettings();
  }
}

// Count customized keybindings
let customKeybindingCount = $derived(
  (['refreshInbox', 'createInbox', 'copyEmail', 'copyOtp', 'closeDialogs'] as const).filter(
    (k) => formatKeybinding(keybindings[k]) !== formatKeybinding(DEFAULT_KEYBINDINGS[k])
  ).length
);

function showConfirmDialog(message: string, onConfirm: () => void) {
  confirmDialog = { message, onConfirm };
  if (confirmDialogRef) {
    confirmDialogRef.focus();
  }
}

function closeConfirmDialog() {
  confirmDialog = null;
}

// Dropdown state (identity only — others moved to sub-pages)
let identityDropdownOpen = $state(false);
</script>

{#if loading}
  <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4" style="scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--md-outline, #75777f) 0.2, transparent) transparent;">
    {#each [1,2,3,4,5] as _}
      <div class="rounded-xl bg-md-primary-container p-4 space-y-2 animate-pulse">
        <div class="h-3 w-24 bg-md-outline-variant rounded"></div>
        <div class="h-8 w-full bg-md-outline-variant rounded"></div>
      </div>
    {/each}
  </div>
{:else}
<ErrorBoundary fallback="Failed to load settings">
  {#snippet children()}
    <div class="flex-1 overflow-y-auto px-4 py-4 space-y-5 pb-20" style="scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--md-outline, #75777f) 0.2, transparent) transparent;">

  <!-- Page heading -->
  <div class="pt-1">
    <h1 class="text-lg font-bold text-md-on-surface">Preferences</h1>
    <p class="text-xs text-md-on-surface/50 mt-0.5">Configure your extension identity.</p>
  </div>

  <!-- ── General ── -->
  <section class="space-y-2">
    <div class="flex items-center gap-2 mb-1">
      <IconSettings class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">General</span>
    </div>

    <!-- Language Switcher -->
    <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">Language</div>
        <div class="text-xs text-md-on-surface/50">Select your preferred language</div>
      </div>
      <LanguageSwitcher />
    </div>

    <!-- Auto-Copy row -->
    <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">{$t('settings.autoCopy')}</div>
        <div class="text-xs text-md-on-surface/50">{$t('settings.autoCopyDescription')}</div>
      </div>
      <label class="cursor-pointer">
        <input type="checkbox" class="sr-only peer" aria-label="Toggle auto-copy" checked={autoCopy} onchange={(e) => { if (onSetAutoCopy) onSetAutoCopy((e.target as HTMLInputElement).checked); onSaveSettings(); }} />
        <div class="relative w-9 h-5 bg-md-outline-variant peer-checked:bg-md-primary rounded-full peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
      </label>
    </div>

    <!-- Storage & Performance nav card -->
    <button
      class="bg-md-primary-container rounded-xl px-4 py-3 w-full text-left hover:bg-md-primary-container/80 transition-colors"
      onclick={onNavigateToStoragePerformance}
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-md-on-surface">Storage &amp; Performance</div>
          <div class="text-xs text-md-on-surface/50 mt-0.5">Favicon caching, storage usage and email retention</div>
        </div>
        <IconChevronRight class="w-4 h-4 text-md-primary/70" />
      </div>
    </button>
  </section>


  <!-- ── Identity ── -->
  <section class="space-y-2">
    <div class="flex items-center gap-2 mb-1">
      <IconUser class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('identities.title')}</span>
    </div>

    <!-- Default Identity for Autofill -->
    <div class="bg-md-primary-container rounded-xl px-4 py-3">
      <div class="text-sm font-medium text-md-on-surface mb-2">Default for Autofill</div>
      <div class="relative">
        <button
          class="w-full bg-transparent text-sm outline-none text-md-on-surface appearance-none cursor-pointer font-medium flex items-center justify-between"
          onclick={() => identityDropdownOpen = !identityDropdownOpen}
          aria-label="Select default identity for autofill"
          disabled={identities.length === 0}
        >
          <span class={identities.length === 0 ? 'text-md-on-surface/40' : ''}>
            {#if identities.length === 0}
              No identities created yet
            {:else}
              {identities.find(i => i.id === selectedIdentityId)?.name ?? 'None'}
            {/if}
          </span>
          {#if identities.length > 0}
            <IconChevronDown class="w-4 h-4 ml-2" />
          {/if}
        </button>
        {#if identityDropdownOpen && identities.length > 0}
          <button class="fixed inset-0 z-40 bg-transparent cursor-default" aria-label="Close dropdown" onclick={() => identityDropdownOpen = false}></button>
          <div class="absolute top-full left-0 right-0 mt-1 bg-md-primary-container rounded-xl shadow-lg border border-md-secondary-container z-50 max-h-60 overflow-y-auto">
            <button
              class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container {!selectedIdentityId ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
              onclick={() => { if (onSetSelectedIdentityId) onSetSelectedIdentityId(null); identityDropdownOpen = false; }}
            >
              None
            </button>
            {#each identities as identity}
              <button
                class="w-full px-4 py-2 text-sm text-left hover:bg-md-secondary-container {identity.id === selectedIdentityId ? 'font-semibold text-md-primary' : 'text-md-on-surface'}"
                onclick={() => { if (onSetSelectedIdentityId) onSetSelectedIdentityId(identity.id); identityDropdownOpen = false; }}
              >
                {identity.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- View All Identities Button -->
    <button
      class="w-full bg-md-secondary-container hover:bg-md-secondary-container/80 text-sm font-medium text-md-on-surface rounded-xl px-4 py-3 transition-colors"
      onclick={onNavigateToIdentities}
    >
      View All Identities
    </button>
  </section>

  <!-- ── Mail Provider ── -->
  <section class="space-y-2">
    <div class="flex items-center gap-2 mb-1">
      <IconMail class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('inbox.title')}</span>
    </div>

    <!-- Mail Provider nav card -->
    <button
      class="bg-md-primary-container rounded-xl px-4 py-3 w-full text-left hover:bg-md-primary-container/80 transition-colors"
      onclick={onNavigateToMailProvider}
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-md-on-surface">Mail Provider Settings</div>
          <div class="text-xs text-md-on-surface/50 mt-0.5">Provider, auto-renew, notifications and refresh interval</div>
        </div>
        <IconChevronRight class="w-4 h-4 text-md-primary/70" />
      </div>
    </button>

    <!-- Keyboard Shortcuts nav card -->
    <button
      class="bg-md-primary-container rounded-xl px-4 py-3 w-full text-left hover:bg-md-primary-container/80 transition-colors"
      onclick={onNavigateToKeybindings}
    >
      <div class="flex items-center justify-between mb-2">
        <div class="text-sm font-medium text-md-on-surface">Keyboard Shortcuts</div>
        <div class="flex items-center gap-1 text-md-primary/70">
          {#if customKeybindingCount > 0}
            <span class="text-[10px] font-semibold text-md-primary bg-md-primary/15 px-1.5 py-0.5 rounded-full mr-1">{customKeybindingCount} custom</span>
          {/if}
          <IconChevronRight class="w-4 h-4" />
        </div>
      </div>
      <div class="space-y-1 mb-1">
        {#each [{ k: 'refreshInbox', label: 'Refresh Inbox' }, { k: 'createInbox', label: 'Create Inbox' }, { k: 'copyEmail', label: 'Copy Email' }] as row}
          <div class="flex items-center justify-between text-xs text-md-on-surface/60">
            <span>{row.label}</span>
            <span class="font-mono bg-md-secondary-container px-1.5 py-0.5 rounded text-md-on-surface">{formatKeybinding(keybindings[row.k as keyof typeof keybindings])}</span>
          </div>
        {/each}
      </div>
    </button>

    <!-- Tag Management nav card -->
    <button
      class="bg-md-primary-container rounded-xl px-4 py-3 w-full text-left hover:bg-md-primary-container/80 transition-colors"
      onclick={onNavigateToTagManagement}
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-md-on-surface">Tag Management</div>
          <div class="text-xs text-md-on-surface/50 mt-0.5">Rename and manage mailbox tags</div>
        </div>
        <IconChevronRight class="w-4 h-4 text-md-primary/70" />
      </div>
    </button>

    <!-- Filters Management nav card -->
    <button
      class="bg-md-primary-container rounded-xl px-4 py-3 w-full text-left hover:bg-md-primary-container/80 transition-colors"
      onclick={onNavigateToFiltersManagement}
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-md-on-surface">Filters Management</div>
          <div class="text-xs text-md-on-surface/50 mt-0.5">View and delete your saved search filters</div>
        </div>
        <IconChevronRight class="w-4 h-4 text-md-primary/70" />
      </div>
    </button>

    <!-- Email Label Management nav card -->
    <button
      class="bg-md-primary-container rounded-xl px-4 py-3 w-full text-left hover:bg-md-primary-container/80 transition-colors"
      onclick={onNavigateToLabelManagement}
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-md-on-surface">Email Label Management</div>
          <div class="text-xs text-md-on-surface/50 mt-0.5">Rename or delete email labels</div>
        </div>
        <IconChevronRight class="w-4 h-4 text-md-primary/70" />
      </div>
    </button>

    <!-- Mailbox Management nav card -->
    <button
      class="bg-md-primary-container rounded-xl px-4 py-3 w-full text-left hover:bg-md-primary-container/80 transition-colors"
      onclick={onNavigateToMailboxManagement}
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-md-on-surface">Mailbox Management</div>
          <div class="text-xs text-md-on-surface/50 mt-0.5">Archive, delete and manage all inboxes</div>
        </div>
        <IconChevronRight class="w-4 h-4 text-md-primary/70" />
      </div>
    </button>
  </section>

  <!-- ── Appearance ── -->
  <section class="space-y-2">
    <div class="flex items-center gap-2 mb-1">
      <IconSun class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('settings.appearance')}</span>
    </div>

    <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">Theme accent</div>
        <div class="text-xs text-md-on-surface/50">Browser color picker</div>
      </div>
      <div class="flex items-center gap-2">
        {#if customColor}
          <button class="w-5 h-5 flex items-center justify-center rounded-full bg-transparent hover:bg-md-secondary-container transition-colors" aria-label="Reset color" onclick={() => onColorChange('')}>
            <IconX class="w-3 h-3" />
          </button>
        {/if}
        <label class="cursor-pointer relative">
          <div class="w-8 h-8 rounded-full border-4 border-md-secondary-container shadow-md" style="background:{customColor || 'var(--md-primary)'}"></div>
          <input type="color" class="absolute inset-0 opacity-0 w-full h-full cursor-pointer" aria-label="Choose theme color" value={customColor || '#4c662b'} oninput={(e) => onColorChange((e.target as HTMLInputElement).value)} />
        </label>
      </div>
    </div>

    <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">Contrast level</div>
        <div class="text-xs text-md-on-surface/50">Adjust contrast for accessibility</div>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="px-3 py-1.5 text-xs rounded-lg transition-colors {contrastLevel === 'standard' ? 'bg-md-primary text-md-on-primary' : 'bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80'}"
          onclick={() => onContrastLevelChange('standard')}
          aria-label="Standard contrast"
        >
          Standard
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-lg transition-colors {contrastLevel === 'medium' ? 'bg-md-primary text-md-on-primary' : 'bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80'}"
          onclick={() => onContrastLevelChange('medium')}
          aria-label="Medium contrast"
        >
          Medium
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-lg transition-colors {contrastLevel === 'high' ? 'bg-md-primary text-md-on-primary' : 'bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80'}"
          onclick={() => onContrastLevelChange('high')}
          aria-label="High contrast"
        >
          High
        </button>
      </div>
    </div>
  </section>

  <!-- ── Developer Settings ── -->
  <section class="space-y-2">
    <div class="flex items-center gap-2 mb-1">
      <IconSettings class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('settings.developer')}</span>
    </div>

    <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium text-md-on-surface">Show Developer Options</div>
        <div class="text-xs text-md-on-surface/50">Enable developer tools</div>
      </div>
      <label class="cursor-pointer">
        <input type="checkbox" class="sr-only peer" aria-label="Toggle developer settings" checked={showDeveloperSettings} onchange={onToggleDeveloperSettings} />
        <div class="relative w-9 h-5 bg-md-outline-variant peer-checked:bg-md-primary rounded-full peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
      </label>
    </div>

    {#if showDeveloperSettings}
      <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-md-on-surface">Enable Logging</div>
          <div class="text-xs text-md-on-surface/50">Show console logs for debugging</div>
        </div>
        <label class="cursor-pointer">
          <input type="checkbox" class="sr-only peer" aria-label="Toggle logging" checked={enableLogging} onchange={onToggleEnableLogging} />
          <div class="relative w-9 h-5 bg-md-outline-variant peer-checked:bg-md-primary rounded-full peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
        </label>
      </div>
    {/if}
  </section>

  <!-- ── Data ── -->
  <div class="flex gap-2">
    <button class="flex-1 px-3 py-1.5 text-sm rounded-xl border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors" aria-label="Export data" onclick={onExportData}>Export Data</button>
    <button class="flex-1 px-3 py-1.5 text-sm rounded-xl border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors" aria-label="Import data" onclick={onImportData}>Import Data</button>
  </div>

  <!-- ── Danger Zone ── -->
  <section class="rounded-xl border border-md-error/30 bg-md-error/5 px-4 py-4 space-y-2">
    <div class="text-sm font-bold text-md-error">Danger Zone</div>
    <div class="text-xs text-md-on-surface/50">Irreversibly reset all configuration to factory defaults.</div>
    <button class="w-full px-3 py-1.5 text-sm rounded-xl border border-md-error text-md-error hover:bg-md-error/10 mt-1 font-semibold transition-colors" aria-label="Perform hard reset" onclick={() => showConfirmDialog('Are you sure you want to perform a hard reset? This action cannot be undone.', onHardReset)}>Hard Reset</button>
  </section>

    </div>
  {/snippet}
</ErrorBoundary>
{/if}

<ConfirmDialog {confirmDialog} confirmDialogRef={confirmDialogRef} onClose={closeConfirmDialog} />

<ToastContainer />
