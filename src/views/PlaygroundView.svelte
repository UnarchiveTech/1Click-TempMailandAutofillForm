<script lang="ts">
/**
 * In-extension QA playground — documents fixtures and deep-links for autofill testing.
 */
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';

let { onBack = () => {} }: { onBack?: () => void } = $props();

const FIXTURES = [
  {
    id: 'signup',
    titleKey: 'playground.signupTitle',
    bodyKey: 'playground.signupBody',
    file: 'signup-basic.html',
  },
  {
    id: 'login',
    titleKey: 'playground.loginTitle',
    bodyKey: 'playground.loginBody',
    file: 'login-only.html',
  },
  {
    id: 'otp',
    titleKey: 'playground.otpTitle',
    bodyKey: 'playground.otpBody',
    file: 'otp-wait.html',
  },
] as const;

async function openFixture(file: string) {
  // Prefer local serve; fallback to raw file URL note
  const url = `http://127.0.0.1:4173/${file}`;
  try {
    await browser.tabs.create({ url });
  } catch {
    /* ignore */
  }
}

async function copyServeCommand() {
  try {
    await navigator.clipboard.writeText('bunx serve tests/fixtures/pages -p 4173');
  } catch {
    /* ignore */
  }
}
</script>

<div class="flex flex-col h-full min-h-0">
  <div class="shrink-0 px-3 pt-2 pb-2 border-b border-md-outline-variant/30 flex items-center gap-2">
    <button
      type="button"
      class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-md-surface-variant"
      aria-label={$t('common.back')}
      onclick={onBack}
    >
      <Icon name="back" class="w-4 h-4" />
    </button>
    <div class="min-w-0">
      <h1 class="text-base font-bold text-md-on-surface">{$t('playground.title')}</h1>
      <p class="text-xs text-md-on-surface/55">{$t('playground.subtitle')}</p>
    </div>
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
    <div class="rounded-xl border border-md-outline-variant/40 bg-md-surface-container-low p-3 space-y-2">
      <p class="text-sm text-md-on-surface">{$t('playground.serveHint')}</p>
      <code class="block text-xs font-mono bg-md-surface px-2 py-1.5 rounded-lg border border-md-outline-variant/30 break-all">
        bunx serve tests/fixtures/pages -p 4173
      </code>
      <button
        type="button"
        class="text-xs font-semibold text-md-primary hover:underline"
        onclick={() => void copyServeCommand()}
      >
        {$t('playground.copyCommand')}
      </button>
    </div>

    {#each FIXTURES as f (f.id)}
      <div class="rounded-xl border border-md-outline-variant/40 bg-md-surface p-3 space-y-1.5">
        <h2 class="text-sm font-semibold text-md-on-surface">{$t(f.titleKey)}</h2>
        <p class="text-xs text-md-on-surface/60">{$t(f.bodyKey)}</p>
        <button
          type="button"
          class="mt-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-md-primary text-md-on-primary"
          onclick={() => void openFixture(f.file)}
        >
          {$t('playground.openFixture')}
        </button>
      </div>
    {/each}

    <div class="rounded-xl border border-md-primary/30 bg-md-primary/5 p-3">
      <p class="text-xs text-md-on-surface/70">{$t('playground.checklist')}</p>
    </div>
  </div>
</div>
