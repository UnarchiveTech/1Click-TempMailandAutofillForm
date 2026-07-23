<script lang="ts">
import { tick } from 'svelte';
import Icon from '@/components/icons/Icon.svelte';
import Btn from '@/components/ui/primitives/Btn.svelte';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { portalToBody } from '@/utils/portal-layers.js';
import type { Account, Email } from '@/utils/types.js';

let {
  open = false,
  account = null as Account | null,
  messages = [] as Email[],
  onClose = () => {},
  onExecuteExport = async (_format: string) => {},
} = $props<{
  open?: boolean;
  account?: Account | null;
  messages?: Email[];
  onClose?: () => void;
  onExecuteExport?: (format: string) => Promise<void>;
}>();

let selectedFormat = $state<'json' | 'eml' | 'mbox'>('json');
let isProcessing = $state(false);
let progressPercent = $state(0);
let isDone = $state(false);

let activeTimer: ReturnType<typeof setInterval> | null = null;
let dialogRef = $state<HTMLElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);
let cleanupFocusTrap: (() => void) | null = null;
let previousActiveElement: HTMLElement | null = null;

$effect(() => {
  if (open && overlayEl) {
    return portalToBody(overlayEl);
  }
});

function resetState() {
  selectedFormat = 'json';
  isProcessing = false;
  progressPercent = 0;
  isDone = false;
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = null;
  }
}

// Handle Escape globally when open
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open && !isProcessing) {
    e.stopPropagation();
    onClose();
  }
}

$effect(() => {
  if (open) {
    resetState();
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
    if (activeTimer) {
      clearInterval(activeTimer);
      activeTimer = null;
    }
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

async function handleStartExport() {
  isProcessing = true;
  progressPercent = 25;

  if (activeTimer) clearInterval(activeTimer);

  activeTimer = setInterval(() => {
    if (progressPercent < 85) {
      progressPercent += 20;
    }
  }, 100);

  try {
    await onExecuteExport(selectedFormat);
    progressPercent = 100;
    if (activeTimer) {
      clearInterval(activeTimer);
      activeTimer = null;
    }
    isDone = true;
    setTimeout(() => {
      onClose();
    }, 1200);
  } catch {
    if (activeTimer) {
      clearInterval(activeTimer);
      activeTimer = null;
    }
    isProcessing = false;
  }
}
</script>

{#if open}
  <div
    bind:this={overlayEl}
    class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="export-wizard-title"
  >
    <!-- Glassmorphism backdrop -->
    <div
      class="absolute inset-0 bg-md-scrim/30 backdrop-blur-sm transition-opacity"
      role="button"
      tabindex="-1"
      aria-label="Close export wizard"
      onclick={(e) => { e.stopPropagation(); if (!isProcessing) onClose(); }}
      onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !isProcessing) onClose(); }}
    ></div>

    <!-- Modal Panel -->
    <div
      class="dialog-enter relative w-full max-w-sm bg-md-surface-container/90 backdrop-blur-xl border border-md-outline-variant/30 rounded-2xl shadow-2xl p-5 flex flex-col gap-4 text-md-on-surface z-10"
      bind:this={dialogRef}
      tabindex="-1"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-md-outline-variant/20 pb-3">
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-xl bg-md-primary/10 flex items-center justify-center text-md-primary">
            <Icon name="download" class="w-5 h-5" />
          </div>
          <div>
            <h2 id="export-wizard-title" class="text-sm font-bold tracking-tight">Export Wizard</h2>
            <p class="text-xs text-md-on-surface/50">
              {account ? account.address : 'Export Emails & Backup'}
            </p>
          </div>
        </div>

        {#if !isProcessing}
          <button
            class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-md-surface-variant/50 transition-colors"
            onclick={(e) => { e.stopPropagation(); onClose(); }}
            aria-label="Close export wizard"
          >
            <Icon name="x" class="w-4 h-4 text-md-on-surface/60" />
          </button>
        {/if}
      </div>

      {#if isDone}
        <!-- Done State -->
        <div class="py-6 flex flex-col items-center justify-center gap-2 text-center">
          <div class="w-12 h-12 rounded-full bg-md-primary/15 text-md-primary flex items-center justify-center animate-bounce">
            <Icon name="checkCircle" class="w-7 h-7" />
          </div>
          <h3 class="text-sm font-bold text-md-on-surface">Export Complete!</h3>
          <p class="text-xs text-md-on-surface/60">Your file has been downloaded successfully.</p>
        </div>
      {:else if isProcessing}
        <!-- Processing State -->
        <div class="py-4 space-y-3">
          <div class="flex justify-between items-center text-xs">
            <span class="font-medium text-md-on-surface/80">Packaging messages...</span>
            <span class="font-mono font-bold text-md-primary">{progressPercent}%</span>
          </div>
          <div class="w-full h-2 bg-md-surface-variant/40 rounded-full overflow-hidden">
            <div
              class="h-full bg-md-primary transition-all duration-200 rounded-full"
              style="width: {progressPercent}%;"
            ></div>
          </div>
          <p class="text-label-sm text-md-on-surface/50 text-center">Exporting {messages.length} email{messages.length === 1 ? '' : 's'} as {selectedFormat.toUpperCase()}</p>
        </div>
      {:else}
        <!-- Format Selection State -->
        <div class="space-y-3">
          <div class="text-xs font-semibold text-md-on-surface/70">Select Export Format</div>
          
          <div class="grid grid-cols-1 gap-2">
            <!-- JSON Option -->
            <button
              type="button"
              class="flex items-center justify-between p-3 rounded-xl border transition-all text-start {selectedFormat === 'json' ? 'border-md-primary bg-md-primary/10 shadow-sm' : 'border-md-outline-variant/20 bg-md-surface-container-low/50 hover:bg-md-surface-variant/30'}"
              onclick={() => (selectedFormat = 'json')}
            >
              <div class="flex items-center gap-2.5">
                <span class="text-xs font-mono font-bold px-2 py-1 rounded bg-md-primary/15 text-md-primary">JSON</span>
                <div>
                  <div class="text-xs font-bold text-md-on-surface">Structured Data</div>
                  <div class="text-xs text-md-on-surface/50">Full metadata & body fields</div>
                </div>
              </div>
              {#if selectedFormat === 'json'}
                <Icon name="check" class="w-4 h-4 text-md-primary" />
              {/if}
            </button>

            <!-- EML Option -->
            <button
              type="button"
              class="flex items-center justify-between p-3 rounded-xl border transition-all text-start {selectedFormat === 'eml' ? 'border-md-primary bg-md-primary/10 shadow-sm' : 'border-md-outline-variant/20 bg-md-surface-container-low/50 hover:bg-md-surface-variant/30'}"
              onclick={() => (selectedFormat = 'eml')}
            >
              <div class="flex items-center gap-2.5">
                <span class="text-xs font-mono font-bold px-2 py-1 rounded bg-md-secondary-container text-md-on-secondary-container">EML</span>
                <div>
                  <div class="text-xs font-bold text-md-on-surface">Standard EML / ZIP</div>
                  <div class="text-xs text-md-on-surface/50">Compatible with Outlook, Thunderbird</div>
                </div>
              </div>
              {#if selectedFormat === 'eml'}
                <Icon name="check" class="w-4 h-4 text-md-primary" />
              {/if}
            </button>

            <!-- MBOX Option -->
            <button
              type="button"
              class="flex items-center justify-between p-3 rounded-xl border transition-all text-start {selectedFormat === 'mbox' ? 'border-md-primary bg-md-primary/10 shadow-sm' : 'border-md-outline-variant/20 bg-md-surface-container-low/50 hover:bg-md-surface-variant/30'}"
              onclick={() => (selectedFormat = 'mbox')}
            >
              <div class="flex items-center gap-2.5">
                <span class="text-xs font-mono font-bold px-2 py-1 rounded bg-md-tertiary-container text-md-on-tertiary-container">MBOX</span>
                <div>
                  <div class="text-xs font-bold text-md-on-surface">Mailbox Archive</div>
                  <div class="text-xs text-md-on-surface/50">Single file for Apple Mail & client import</div>
                </div>
              </div>
              {#if selectedFormat === 'mbox'}
                <Icon name="check" class="w-4 h-4 text-md-primary" />
              {/if}
            </button>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-md-outline-variant/20">
          <Btn
            variant="ghost"
            size="md"
            onclick={onClose}
          >
            Cancel
          </Btn>
          <Btn
            variant="primary"
            size="md"
            class="flex items-center gap-1.5"
            onclick={handleStartExport}
          >
            <Icon name="download" class="w-3.5 h-3.5" />
            <span>Export File</span>
          </Btn>
        </div>
      {/if}
    </div>
  </div>
{/if}
