<script lang="ts">
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import Icon from '@/components/icons/Icon.svelte';
import type { Keybindings } from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';

let {
  onBack = () => {},
  keybindings = DEFAULT_KEYBINDINGS,
  onSetKeybindings = undefined,
  onSaveSettings = () => {},
  onNavigateTo = undefined,
} = $props<{
  onBack?: () => void;
  keybindings?: Keybindings;
  onSetKeybindings?: (value: Keybindings) => void;
  onSaveSettings?: () => void;
  onNavigateTo?: (view: string) => void;
}>();

let editingKeybinding = $state<string | null>(null);
let recordingKeybinding = $state(false);
let recordedKeys = $state<string>('');

const KEYBINDING_LABELS: Record<keyof Keybindings, { labelKey: string; descriptionKey: string }> = {
  refreshInbox: {
    labelKey: 'keyboardShortcuts.refreshInbox',
    descriptionKey: 'keyboardShortcuts.refreshInboxDescription',
  },
  createInbox: {
    labelKey: 'keyboardShortcuts.createInbox',
    descriptionKey: 'keyboardShortcuts.createInboxDescription',
  },
  copyEmail: {
    labelKey: 'keyboardShortcuts.copyEmail',
    descriptionKey: 'keyboardShortcuts.copyEmailDescription',
  },
  copyOtp: {
    labelKey: 'keyboardShortcuts.copyOtp',
    descriptionKey: 'keyboardShortcuts.copyOtpDescription',
  },
  closeDialogs: {
    labelKey: 'keyboardShortcuts.closeDialogs',
    descriptionKey: 'keyboardShortcuts.closeDialogsDescription',
  },
  openAddresses: {
    labelKey: 'keyboardShortcuts.openAddresses',
    descriptionKey: 'keyboardShortcuts.openAddressesDescription',
  },
  openIdentities: {
    labelKey: 'keyboardShortcuts.openIdentities',
    descriptionKey: 'keyboardShortcuts.openIdentitiesDescription',
  },
  openSavedLogins: {
    labelKey: 'keyboardShortcuts.openSavedLogins',
    descriptionKey: 'keyboardShortcuts.openSavedLoginsDescription',
  },
  toggleAccountSelector: {
    labelKey: 'keyboardShortcuts.toggleAccountSelector',
    descriptionKey: 'keyboardShortcuts.toggleAccountSelectorDescription',
  },
  focusSearch: {
    labelKey: 'keyboardShortcuts.focusSearch',
    descriptionKey: 'keyboardShortcuts.focusSearchDescription',
  },
};

function formatKeybinding(binding: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): string {
  const tr = get(t);
  const parts: string[] = [];
  if (binding.ctrlKey || binding.metaKey) parts.push(tr('keyboardShortcuts.ctrlCmd'));
  if (binding.shiftKey) parts.push(tr('keyboardShortcuts.shift'));
  if (binding.altKey) parts.push(tr('keyboardShortcuts.alt'));
  parts.push(binding.key.toUpperCase());
  return parts.join(' + ');
}

function startRecording(action: string) {
  editingKeybinding = action;
  recordingKeybinding = true;
  recordedKeys = '';
}

function handleRecordingKeydown(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();

  const tr = get(t);
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push(tr('keyboardShortcuts.ctrlCmd'));
  if (event.shiftKey) parts.push(tr('keyboardShortcuts.shift'));
  if (event.altKey) parts.push(tr('keyboardShortcuts.alt'));
  parts.push(event.key.toUpperCase());

  recordedKeys = parts.join(' + ');

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

function cancelRecording() {
  recordingKeybinding = false;
  editingKeybinding = null;
  recordedKeys = '';
}

function resetKeybinding(action: string) {
  if (onSetKeybindings) {
    const newKeybindings = { ...keybindings };
    newKeybindings[action as keyof Keybindings] = DEFAULT_KEYBINDINGS[action as keyof Keybindings];
    onSetKeybindings(newKeybindings);
    onSaveSettings();
  }
}

function resetAll() {
  if (onSetKeybindings) {
    onSetKeybindings({ ...DEFAULT_KEYBINDINGS });
    onSaveSettings();
  }
}

let hasCustomized = $derived(
  (Object.keys(keybindings) as (keyof Keybindings)[]).some(
    (k) => formatKeybinding(keybindings[k]) !== formatKeybinding(DEFAULT_KEYBINDINGS[k])
  )
);
</script>

<div class="flex flex-col h-full">
  <!-- Title + actions - back lives in app header on this deep page -->
  <div class="px-2 py-3 border-b border-md-outline-variant/30 flex items-center gap-3">
    <h1 class="flex-1 min-w-0 font-semibold text-sm">
      {$t('keyboardShortcuts.title')}
      <span class="block text-xs font-normal text-md-on-surface/50">{$t('keyboardShortcuts.subtitle')}</span>
    </h1>
    {#if hasCustomized}
      <button
        type="button"
        class="text-xs text-md-error hover:text-md-error/80 transition-colors px-2 py-1 rounded-lg hover:bg-md-error/10 shrink-0"
        onclick={resetAll}
      >
        {$t('keyboardShortcuts.resetAll')}
      </button>
    {/if}
  </div>

  <!-- Shortcut list -->
  <div class="flex-1 overflow-y-auto px-2 py-3 space-y-2">
    {#each Object.keys(KEYBINDING_LABELS) as action}
      {@const info = KEYBINDING_LABELS[action as keyof Keybindings]}
      {@const binding = keybindings[action as keyof Keybindings]}
      {@const isDefault = formatKeybinding(binding) === formatKeybinding(DEFAULT_KEYBINDINGS[action as keyof Keybindings])}
      <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface flex items-center gap-2">
            {$t(info.labelKey)}
            {#if !isDefault}
              <span class="text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-md-primary/20 text-md-primary">{$t('keyboardShortcuts.custom')}</span>
            {/if}
          </div>
          <div class="text-xs text-md-on-surface/50">{$t(info.descriptionKey)}</div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          {#if editingKeybinding === action && recordingKeybinding}
            <button
              class="bg-md-secondary-container text-sm text-md-primary px-3 py-1.5 rounded-lg font-medium animate-pulse outline-none min-w-[110px] text-center"
              onkeydown={handleRecordingKeydown}
              onblur={cancelRecording}
            >
              {recordedKeys || $t('keyboardShortcuts.pressKeys')}
            </button>
            <button class="text-xs text-md-on-surface/60 hover:text-md-on-surface" onclick={cancelRecording}>{$t('keyboardShortcuts.cancel')}</button>
          {:else}
            <div class="bg-md-secondary-container text-sm text-md-on-surface px-3 py-1.5 rounded-lg font-mono font-medium">
              {formatKeybinding(binding)}
            </div>
            <button class="text-xs text-md-primary hover:text-md-primary/80" onclick={() => startRecording(action)}>{$t('keyboardShortcuts.edit')}</button>
            {#if !isDefault}
              <button class="text-xs text-md-on-surface/60 hover:text-md-on-surface" onclick={() => resetKeybinding(action)}>{$t('keyboardShortcuts.reset')}</button>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>

</div>
