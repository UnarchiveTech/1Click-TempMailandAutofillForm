<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import { GITHUB_ISSUES_URL, GITHUB_REPO_URL } from '@/utils/constants.js';

interface Props {
  context?: 'popup' | 'sidepanel' | 'app';
  version: string;
}
let { context = 'popup', version }: Props = $props();
</script>

<div class="flex flex-col h-full">
  <div class="flex flex-col items-center gap-5 px-6 py-8">
    <div class="text-center">
      <h2 class="font-bold text-base">{$t('about.title')}</h2>
      <span class="px-2 py-0.5 text-xs rounded-full bg-md-primary/20 text-md-primary mt-1">v{version}</span>
    </div>
    <p class="text-sm text-md-on-surface/60 text-center leading-relaxed">
      {$t('about.description')}
    </p>
    <div class="flex flex-col gap-2 w-full">
      <a
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="w-full px-3 py-1.5 text-sm rounded-lg border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors flex items-center justify-center gap-2"
      >
        <Icon name="gitHub" class="w-4 h-4" />
        {$t('about.viewOnGitHub')}
      </a>
      <button
        class="w-full px-3 py-1.5 text-sm rounded-lg bg-md-error/10 text-md-error hover:bg-md-error/20 transition-colors flex items-center justify-center gap-2"
        onclick={() => browser.tabs.create({ url: GITHUB_ISSUES_URL })}
      >
        <Icon name="warning" class="w-4 h-4" />
        {$t('about.reportIssue')}
      </button>
    </div>
    <p class="text-xs text-md-on-surface/40 mt-2">{$t('about.madeBy')}</p>
  </div>
</div>
