<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';

let {
  steps,
  currentStep,
  onNext,
  onPrevious,
  onSkip,
  onComplete,
}: {
  steps: Array<{ title: string; description: string; target?: string }>;
  currentStep: number;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
  onComplete: () => void;
} = $props();

async function markTutorialComplete() {
  await browser.storage.local.set({ tutorialCompleted: true });
  onComplete();
}

async function skipTutorial() {
  await browser.storage.local.set({ tutorialCompleted: true });
  onSkip();
}
</script>

<div class="fixed inset-0 z-[10000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
  <div class="bg-md-primary-container rounded-2xl shadow-2xl max-w-md w-full p-6">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <div class="flex gap-1">
          {#each steps as _, index}
            <div class="w-2 h-2 rounded-full {index === currentStep ? 'bg-md-primary' : 'bg-md-outline-variant'}"></div>
          {/each}
        </div>
        <span class="text-xs text-md-on-surface/50">{currentStep + 1} / {steps.length}</span>
      </div>
      <button 
        class="text-md-on-surface/50 hover:text-md-on-surface transition-colors"
        onclick={(e) => { e.stopPropagation(); void skipTutorial(); }}
        aria-label="Skip tutorial"
      >
        <Icon name="x" class="w-5 h-5" />
      </button>
    </div>

    <div class="mb-6">
      <h3 class="text-lg font-semibold text-md-on-surface mb-2">{steps[currentStep].title}</h3>
      <p class="text-sm text-md-on-surface/70">{steps[currentStep].description}</p>
    </div>

    <div class="flex gap-3">
      {#if currentStep > 0}
        <button
          class="flex-1 px-3 py-1.5 text-sm rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors"
          onclick={(e) => { e.stopPropagation(); onPrevious(); }}
        >
          {$t('common.back')}
        </button>
      {/if}

      {#if currentStep < steps.length - 1}
        <button
          class="flex-1 px-3 py-1.5 text-sm rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors"
          onclick={(e) => { e.stopPropagation(); onNext(); }}
        >
          {$t('common.continue')}
        </button>
      {:else}
        <button
          class="flex-1 px-3 py-1.5 text-sm rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors"
          onclick={(e) => { e.stopPropagation(); void markTutorialComplete(); }}
        >
          {$t('common.complete')}
        </button>
      {/if}
    </div>
  </div>
</div>
