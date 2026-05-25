<script lang="ts">
import IconChevronLeft from '@/components/icons/IconChevronLeft.svelte';
import type { Keybindings } from '@/utils/types.js';
import { DEFAULT_KEYBINDINGS } from '@/utils/types.js';

let {
  onBack = () => {},
  keybindings = DEFAULT_KEYBINDINGS,
  onSetKeybindings = undefined,
  onSaveSettings = () => {},
} = $props<{
  onBack?: () => void;
  keybindings?: Keybindings;
  onSetKeybindings?: (value: Keybindings) => void;
  onSaveSettings?: () => void;
}>();

let editingKeybinding = $state<string | null>(null);
let recordingKeybinding = $state(false);
let recordedKeys = $state<string>('');

const KEYBINDING_LABELS: Record<keyof Keybindings, { label: string; description: string }> = {
  refreshInbox: { label: 'Refresh Inbox', description: 'Check for new emails' },
  createInbox: { label: 'Create Inbox', description: 'Generate new email address' },
  copyEmail: { label: 'Copy Email', description: 'Copy current email address' },
  copyOtp: { label: 'Copy OTP', description: 'Copy one-time password' },
  closeDialogs: { label: 'Close Dialogs', description: 'Close open dialogs/panels' },
};

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

function startRecording(action: string) {
  editingKeybinding = action;
  recordingKeybinding = true;
  recordedKeys = '';
}

function handleRecordingKeydown(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl/Cmd');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
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
  <!-- Header -->
  <div class="px-4 py-3 border-b border-md-secondary-container flex items-center gap-3">
    <button
      class="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-secondary-container transition-colors"
      onclick={onBack}
      aria-label="Back"
    >
      <IconChevronLeft class="w-5 h-5" />
    </button>
    <div class="flex-1">
      <div class="font-semibold text-sm">Keyboard Shortcuts</div>
      <div class="text-xs text-md-on-surface/50">Customize hotkeys for quick actions</div>
    </div>
    {#if hasCustomized}
      <button
        class="text-xs text-md-error hover:text-md-error/80 transition-colors px-2 py-1 rounded-lg hover:bg-md-error/10"
        onclick={resetAll}
      >
        Reset all
      </button>
    {/if}
  </div>

  <!-- Shortcut list -->
  <div class="flex-1 overflow-y-auto px-4 py-3 space-y-2" style="scrollbar-width: thin; scrollbar-color: var(--md-primary) transparent;">
    {#each Object.keys(KEYBINDING_LABELS) as action}
      {@const info = KEYBINDING_LABELS[action as keyof Keybindings]}
      {@const binding = keybindings[action as keyof Keybindings]}
      {@const isDefault = formatKeybinding(binding) === formatKeybinding(DEFAULT_KEYBINDINGS[action as keyof Keybindings])}
      <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-medium text-md-on-surface flex items-center gap-2">
            {info.label}
            {#if !isDefault}
              <span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-md-primary/20 text-md-primary">custom</span>
            {/if}
          </div>
          <div class="text-xs text-md-on-surface/50">{info.description}</div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          {#if editingKeybinding === action && recordingKeybinding}
            <button
              class="bg-md-secondary-container text-sm text-md-primary px-3 py-1.5 rounded-lg font-medium animate-pulse outline-none min-w-[110px] text-center"
              onkeydown={handleRecordingKeydown}
              onblur={cancelRecording}
            >
              {recordedKeys || 'Press keys...'}
            </button>
            <button class="text-xs text-md-on-surface/60 hover:text-md-on-surface" onclick={cancelRecording}>Cancel</button>
          {:else}
            <div class="bg-md-secondary-container text-sm text-md-on-surface px-3 py-1.5 rounded-lg font-mono font-medium">
              {formatKeybinding(binding)}
            </div>
            <button class="text-xs text-md-primary hover:text-md-primary/80" onclick={() => startRecording(action)}>Edit</button>
            {#if !isDefault}
              <button class="text-xs text-md-on-surface/60 hover:text-md-on-surface" onclick={() => resetKeybinding(action)}>Reset</button>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
