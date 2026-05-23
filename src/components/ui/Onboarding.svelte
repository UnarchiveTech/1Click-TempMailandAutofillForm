<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import AppLogo from '@/components/icons/AppLogo.svelte';
import IconBack from '@/components/icons/IconBack.svelte';
import IconCheckCircle from '@/components/icons/IconCheckCircle.svelte';
import IconEnvelope from '@/components/icons/IconEnvelope.svelte';
import IconFlame from '@/components/icons/IconFlame.svelte';
import IconLock from '@/components/icons/IconLock.svelte';
import IconPlus from '@/components/icons/IconPlus.svelte';
import IconShield from '@/components/icons/IconShield.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import LanguageSwitcher from '@/components/ui/LanguageSwitcher.svelte';
import Tutorial from '@/components/ui/Tutorial.svelte';
import { handleCreateInbox } from '@/features/onboarding/onboarding-actions.js';
import { loadAllProviderConfigs, type ProviderConfig } from '@/utils/email-service.js';

let { onCreateInbox }: { onCreateInbox: (provider: string) => void } = $props();

let selectedProvider = $state<string>('');
let step = $state<1 | 2 | 3>(1);
let showTutorial = $state(false);

// Load providers dynamically
let providers = $derived.by((): ProviderConfig[] => {
  try {
    const allProviderConfigs = loadAllProviderConfigs();
    return Object.values(allProviderConfigs);
  } catch {
    return [];
  }
});

// Select first provider by default
$effect(() => {
  if (providers.length > 0 && !selectedProvider) {
    selectedProvider = providers[0].id;
  }
});

async function createFirstInbox(provider: string) {
  await handleCreateInbox(provider, browser, { onCreateInbox });
  // Show tutorial after creating first inbox
  showTutorial = true;
}

// Tutorial steps — $derived so they update when i18n loads asynchronously
let tutorialSteps = $derived([
  {
    title: $t('tutorial.step1Title') || 'Welcome to your new inbox',
    description:
      $t('tutorial.step1Description') ||
      'Your temporary email is ready. Use it to sign up for websites without revealing your real email address.',
  },
  {
    title: $t('tutorial.step2Title') || 'Check for OTPs',
    description:
      $t('tutorial.step2Description') ||
      'When you receive emails with verification codes (OTPs), they will appear here automatically. Just click to copy!',
  },
  {
    title: $t('tutorial.step3Title') || 'Manage multiple inboxes',
    description:
      $t('tutorial.step3Description') ||
      'Create as many inboxes as you need. Archive old ones or switch between them easily.',
  },
]);

let currentTutorialStep = $state(0);

function nextTutorialStep() {
  if (currentTutorialStep < tutorialSteps.length - 1) {
    currentTutorialStep++;
  }
}

function previousTutorialStep() {
  if (currentTutorialStep > 0) {
    currentTutorialStep--;
  }
}

function skipTutorial() {
  showTutorial = false;
}

function completeTutorial() {
  showTutorial = false;
}
</script>

{#if step === 1}
  <!-- Welcome Step -->
  <div class="flex flex-col items-center justify-center h-full px-6 py-8 text-center gap-5">
    <!-- Logo and Language Switcher -->
    <div class="flex items-center gap-4">
      <AppLogo />
      <LanguageSwitcher />
    </div>

    <div>
      <h2 class="text-xl font-bold text-md-on-surface mb-1">{$t('onboarding.welcome')}</h2>
      <p class="text-sm text-md-on-surface/60">{$t('onboarding.welcomeDescription')}</p>
    </div>

    <!-- Feature highlights -->
    <div class="w-full flex flex-col gap-2.5">
      <div class="flex items-center gap-3 bg-md-surface-container-low rounded-xl px-4 py-2.5">
        <div class="w-8 h-8 rounded-lg bg-md-primary/10 flex items-center justify-center shrink-0">
          <IconCheckCircle class="w-4 h-4 text-md-primary" />
        </div>
        <div class="text-left">
          <p class="text-xs font-semibold text-md-on-surface">{$t('onboarding.feature1Title')}</p>
          <p class="text-xs text-md-on-surface/50">{$t('onboarding.feature1Description')}</p>
        </div>
      </div>

      <div class="flex items-center gap-3 bg-md-surface-container-low rounded-xl px-4 py-2.5">
        <div class="w-8 h-8 rounded-lg bg-md-primary/10 flex items-center justify-center shrink-0">
          <IconShield class="w-4 h-4 text-md-primary" />
        </div>
        <div class="text-left">
          <p class="text-xs font-semibold text-md-on-surface">{$t('onboarding.feature2Title')}</p>
          <p class="text-xs text-md-on-surface/50">{$t('onboarding.feature2Description')}</p>
        </div>
      </div>

      <div class="flex items-center gap-3 bg-md-surface-container-low rounded-xl px-4 py-2.5">
        <div class="w-8 h-8 rounded-lg bg-md-primary/10 flex items-center justify-center shrink-0">
          <IconLock class="w-4 h-4 text-md-primary" />
        </div>
        <div class="text-left">
          <p class="text-xs font-semibold text-md-on-surface">{$t('onboarding.feature3Title')}</p>
          <p class="text-xs text-md-on-surface/50">{$t('onboarding.feature3Description')}</p>
        </div>
      </div>
    </div>

    <button
      class="w-full px-4 py-2 text-sm font-semibold rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors flex items-center justify-center gap-1.5"
      onclick={() => step = 2}
    >
      {$t('onboarding.continue')}
      <IconBack class="w-4 h-4 rotate-180" />
    </button>
  </div>

{:else}
  <!-- Create First Inbox Step -->
  <div class="flex flex-col items-center justify-center h-full px-6 py-8 text-center gap-5">
    <div class="w-14 h-14 rounded-xl bg-md-primary/10 flex items-center justify-center">
      <IconPlus class="w-8 h-8 text-md-primary" />
    </div>

    <div>
      <h2 class="text-lg font-bold text-md-on-surface mb-1">{$t('onboarding.chooseProvider')}</h2>
      <p class="text-sm text-md-on-surface/60">{$t('onboarding.chooseProviderDescription')}</p>
    </div>

    <!-- Provider selection -->
    <div class="w-full flex flex-col gap-3">
      {#each providers as provider}
        {@const domain = provider.websiteUrl ? new URL(provider.websiteUrl).hostname : ''}
        <button
          class="flex items-center gap-4 w-full rounded-xl px-4 py-3 border-2 transition-all {selectedProvider === provider.id ? 'border-md-primary bg-md-primary/5' : 'border-md-outline-variant bg-md-surface-container-low hover:border-md-outline-variant/20'}"
          onclick={() => selectedProvider = provider.id}
        >
          <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
            <FaviconImage {domain} size={32} class="w-6 h-6 object-contain" fallbackLetter={provider.displayName.charAt(0).toUpperCase()} fallbackColor={provider.ui?.color?.replace('text-', 'bg-') || 'bg-md-primary'} />
          </div>
          <div class="text-left flex-1">
            <p class="text-sm font-semibold text-md-on-surface">{provider.displayName}</p>
            <p class="text-xs text-md-on-surface/50">{provider.ui?.description || 'Temporary email provider'}</p>
          </div>
          {#if selectedProvider === provider.id}
            <IconCheckCircle class="w-5 h-5 text-md-primary shrink-0" />
          {/if}
        </button>
      {/each}
    </div>

    <div class="w-full flex flex-col gap-2">
      <button
        class="w-full px-4 py-2 text-sm font-semibold rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors flex items-center justify-center gap-1.5"
        onclick={() => createFirstInbox(selectedProvider)}
      >
        <IconEnvelope class="w-4 h-4" />
        {$t('onboarding.createFirstAddress')}
      </button>
      <button class="w-full px-3 py-1.5 text-sm rounded-xl bg-transparent text-md-on-surface/50 hover:bg-md-surface-variant transition-colors" onclick={() => step = 1}>
        {$t('onboarding.back')}
      </button>
    </div>
  </div>
{/if}

{#if showTutorial}
  <Tutorial
    steps={tutorialSteps}
    currentStep={currentTutorialStep}
    onNext={nextTutorialStep}
    onPrevious={previousTutorialStep}
    onSkip={skipTutorial}
    onComplete={completeTutorial}
  />
{/if}
