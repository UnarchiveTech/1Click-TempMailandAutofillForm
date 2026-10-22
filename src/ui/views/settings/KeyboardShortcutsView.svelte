<script lang="ts">
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import {
  countCustomizedKeybindings,
  createKeybindingRecorder,
  formatKeybinding,
  isDefaultBinding,
} from '@/features/settings/keybinding-recorder.svelte.js';
import type { View } from '@/features/types/view-types.js';
import ConfirmDialog from '@/ui/blocks/dialogs/ConfirmDialog.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import Badge from '@/ui/components/primitives/Badge.svelte';
import type { Keybinding, Keybindings } from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';

let {
  onBack = () => {},
  keybindings = DEFAULT_KEYBINDINGS,
  onSetKeybindings = undefined,
  onSaveSettings = () => {},
  onNavigateTo = undefined,
}: {
  onBack?: () => void;
  keybindings?: Keybindings;
  onSetKeybindings?: (value: Keybindings) => void;
  onSaveSettings?: () => void;
  onNavigateTo?: (view: View) => void;
} = $props();

const recorder = createKeybindingRecorder({
  getKeybindings: () => keybindings,
  onSetKeybindings: (value) => onSetKeybindings?.(value),
  onSaveSettings: () => onSaveSettings(),
  tr: (key) => get(t)(key),
});

const {
  state: recorderState,
  startRecording,
  handleRecordingKeydown,
  cancelRecording,
  resetKeybinding,
  resetAll,
} = recorder;

const KEYBINDING_LABELS: Record<keyof Keybindings, { labelKey: string; descriptionKey: string }> = {
  refreshMailbox: {
    labelKey: 'keyboardShortcuts.refreshMailbox',
    descriptionKey: 'keyboardShortcuts.refreshMailboxDescription',
  },
  createAddress: {
    labelKey: 'keyboardShortcuts.createAddress',
    descriptionKey: 'keyboardShortcuts.createAddressDescription',
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

function formatBinding(binding: Keybinding): string {
  return formatKeybinding(binding, get(t));
}

let hasCustomized = $derived(countCustomizedKeybindings(keybindings) > 0);
let resetAllConfirm = $state<{
  message: string;
  onConfirm: () => void;
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
} | null>(null);

function requestResetAll(): void {
  resetAllConfirm = {
    title: $t('keyboardShortcuts.resetAll'),
    message: $t('keyboardShortcuts.resetAllConfirmMessage'),
    confirmLabel: $t('keyboardShortcuts.resetAll'),
    destructive: true,
    onConfirm: resetAll,
  };
}
</script>

<div class="scroll-frame flex flex-col h-full">
  <!-- Title + actions - back lives in app header on this deep page -->
  <div class="scroll-edge py-3 border-b border-md-outline-variant/30 flex items-center gap-3">
    <h1 class="flex-1 min-w-0 font-semibold text-sm">
      {$t('keyboardShortcuts.title')}
      <span class="block text-xs font-normal text-md-on-surface/50">{$t('keyboardShortcuts.subtitle')}</span>
    </h1>
    {#if hasCustomized}
      <button
        type="button"
        class="text-xs text-md-error hover:text-md-error/80 transition-colors px-2 py-1 rounded-lg hover:bg-md-error/10 active:bg-md-error/30 shrink-0"
        onclick={requestResetAll}
      >
        {$t('keyboardShortcuts.resetAll')}
      </button>
    {/if}
  </div>

  <!-- Shortcut list -->
  <div class="scroll-body scroll-body-framed flex-1 overflow-y-auto py-3 space-y-2">
    {#each Object.keys(KEYBINDING_LABELS) as action}
      {@const info = KEYBINDING_LABELS[action as keyof Keybindings]}
      {@const binding = keybindings[action as keyof Keybindings]}
      {@const isDefault = isDefaultBinding(binding, action as keyof Keybindings)}
      <div class="bg-md-surface-container-low rounded-xl px-3 py-3 border border-md-outline-variant/20 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface flex items-center gap-2">
            {$t(info.labelKey)}
            {#if !isDefault}
              <Badge variant="primary" size="sm" label={$t('keyboardShortcuts.custom')} />
            {/if}
          </div>
          <div class="text-xs text-md-on-surface/50">{$t(info.descriptionKey)}</div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          {#if recorderState.editingKeybinding === action && recorderState.recordingKeybinding}
            <div class="flex flex-nowrap items-center gap-2" use:responsiveButtonLayout data-action-tier="XS">
              <button
                class="h-8 bg-md-secondary-container text-md-primary px-3 rounded-lg font-medium animate-pulse outline-none min-w-[140px] text-center flex flex-col items-center gap-1"
                onkeydown={handleRecordingKeydown}
                onblur={cancelRecording}
              >
                {recorderState.recordedKeys || $t('keyboardShortcuts.pressKeys')}
              </button>
              <button class="h-8 text-md-on-surface/60 hover:text-md-on-surface" onclick={cancelRecording}>{$t('common.cancel')}</button>
            </div>
          {:else}
            <div class="bg-md-secondary-container text-sm text-md-on-secondary-container px-3 py-1.5 rounded-lg font-mono font-medium">
              {formatBinding(binding)}
            </div>
            <div class="flex flex-nowrap items-center gap-2" use:responsiveButtonLayout data-action-tier="XS">
              <button class="h-8 text-md-primary hover:text-md-primary/80" onclick={() => startRecording(action as keyof Keybindings)}>{$t('common.edit')}</button>
              {#if !isDefault}
                <button class="h-8 text-md-on-surface/60 hover:text-md-on-surface" onclick={() => resetKeybinding(action as keyof Keybindings)}>{$t('common.reset')}</button>
              {/if}
            </div>
          {/if}
        </div>
          </div>
          {#if recorderState.editingKeybinding === action && (recorderState.recordingError || recorderState.conflict?.attempted === action)}
            <p class="mt-1 text-xs text-md-error" role="status">{recorderState.conflict?.attempted === action
              ? $t('keyboardShortcuts.duplicateBinding', {
                  values: { action: $t(KEYBINDING_LABELS[recorderState.conflict.existing].labelKey) },
                })
              : recorderState.recordingError}</p>
          {/if}
        {/each}
  </div>

  <!-- Built-in System & Navigation Shortcuts reference -->
  <div class="scroll-edge py-3 border-t border-md-outline-variant/20 space-y-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="dragHandle" class="w-4 h-4 text-md-primary" />
      <span role="heading" aria-level="2" class="text-sm font-medium text-md-on-surface">{$t('keyboardShortcuts.systemShortcutsTitle')}</span>
    </div>
    <div class="grid gap-2">
      {#each [
        { label: 'keyboardShortcuts.sysCommandPalette', keys: 'Ctrl + K / Cmd + K' },
        { label: 'keyboardShortcuts.sysCommandPaletteAlt', keys: 'Ctrl + Shift + P' },
        { label: 'keyboardShortcuts.sysFocusSearch', keys: '/' },
        { label: 'keyboardShortcuts.sysSelectAll', keys: 'Ctrl + A / Cmd + A' },
        { label: 'keyboardShortcuts.sysCloseDialog', keys: 'Escape' },
        { label: 'keyboardShortcuts.sysToggleSplitPane', keys: 'Ctrl + Shift + S' },
        { label: 'keyboardShortcuts.sysRangeSelect', keys: 'Shift + Click' },
        { label: 'keyboardShortcuts.sysMarqueeSelect', keys: 'Shift + Drag' },
        { label: 'keyboardShortcuts.sysDeleteItem', keys: 'Delete / Backspace' }
      ] as item (item.label)}
        <div class="bg-md-surface-container-low border border-md-outline-variant/20 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
          <span class="text-xs font-medium text-md-on-surface">{$t(item.label)}</span>
          <span class="font-mono text-xs bg-md-secondary-container px-2 py-0.5 rounded text-md-on-secondary-container font-semibold shrink-0">{item.keys}</span>
        </div>
      {/each}
    </div>
  </div>
</div>

<ConfirmDialog confirmDialog={resetAllConfirm} onClose={() => (resetAllConfirm = null)} />
