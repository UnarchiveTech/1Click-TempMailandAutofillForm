<script lang="ts">
import { browser } from 'wxt/browser';
import IconGitHub from '@/components/icons/IconGitHub.svelte';
import IconWarning from '@/components/icons/IconWarning.svelte';
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
      <h2 class="font-bold text-base">1Click — Temp Mail & Autofill Form</h2>
      <span class="px-2 py-0.5 text-xs rounded-full bg-md-primary/20 text-md-primary mt-1">v{version}</span>
    </div>
    <p class="text-sm text-md-on-surface/60 text-center leading-relaxed">
      A privacy-focused Chrome extension for generating temporary email addresses and auto-filling web forms.
    </p>
    <div class="flex flex-col gap-2 w-full">
      <a
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="w-full px-3 py-1.5 text-sm rounded-lg border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors flex items-center justify-center gap-2"
      >
        <IconGitHub class="w-4 h-4" />
        View on GitHub
      </a>
      <button
        class="w-full px-3 py-1.5 text-sm rounded-lg bg-md-error/10 text-md-error hover:bg-md-error/20 transition-colors flex items-center justify-center gap-2"
        onclick={() => browser.tabs.create({ url: GITHUB_ISSUES_URL })}
      >
        <IconWarning class="w-4 h-4" />
        Report an Issue
      </button>
    </div>
    <p class="text-xs text-md-on-surface/40 mt-2">Made with ❤️ by UnarchiveTech</p>
  </div>
</div>
