<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import { GITHUB_REPO_URL } from '@/utils/constants.js';
import { locale, setLanguage } from '@/utils/i18n';

const languages = [
  { code: 'en', name: 'English', country: 'gb' },
  { code: 'es', name: 'Español', country: 'es' },
  { code: 'fr', name: 'Français', country: 'fr' },
  { code: 'de', name: 'Deutsch', country: 'de' },
  { code: 'ja', name: '日本語', country: 'jp' },
  { code: 'zh', name: '中文', country: 'cn' },
  { code: 'ar', name: 'العربية', country: 'sa' },
  { code: 'th', name: 'ไทย', country: 'th' },
];

const LANGUAGE_REQUEST_ISSUE_URL = `${GITHUB_REPO_URL.replace(/\/$/, '')}/issues/new?template=language_request.yml&title=${encodeURIComponent('[Language Request] Add support for …')}`;

let isOpen = $state(false);
let currentLanguage = $state('en');

onMount(() => {
  // Subscribe to locale changes (already auto-detected by i18n.ts)
  const unsubscribe = locale.subscribe((value) => {
    currentLanguage = value || 'en';
  });

  // Priority: saved storage (preferredLanguage OR locale) > navigator default
  void browser.storage.local.get(['preferredLanguage', 'locale']).then((res) => {
    const savedLang =
      (res.preferredLanguage as string | undefined) || (res.locale as string | undefined);
    if (savedLang && languages.some((lang) => lang.code === savedLang)) {
      void setLanguage(savedLang); // also re-persists both storage keys
    }
  });

  return unsubscribe;
});

async function handleLanguageChange(langCode: string) {
  // setLanguage persists locale + preferredLanguage and updates document dir/lang
  await setLanguage(langCode);
  isOpen = false;
}

function openLanguageRequest() {
  isOpen = false;
  try {
    void browser.tabs.create({ url: LANGUAGE_REQUEST_ISSUE_URL });
  } catch {
    window.open(LANGUAGE_REQUEST_ISSUE_URL, '_blank', 'noopener,noreferrer');
  }
}

function toggleDropdown() {
  isOpen = !isOpen;
}
</script>

<div class="relative">
  <button
    class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-md-surface-variant transition-colors"
    onclick={(e) => { e.stopPropagation(); toggleDropdown(); }}
    aria-label={$t('preferences.language')}
  >
    <img
      src="https://flagcdn.com/w40/{languages.find(lang => lang.code === currentLanguage)?.country}.png"
      alt=""
      class="w-6 h-4 rounded-sm object-cover"
      loading="lazy"
    />
    <span class="text-sm font-medium">{languages.find(lang => lang.code === currentLanguage)?.name}</span>
    <Icon name="chevronDown" class="w-4 h-4 {isOpen ? 'rotate-180' : ''} transition-transform" />
  </button>

  {#if isOpen}
    <div class="absolute top-full end-0 mt-2 w-52 bg-md-surface rounded-xl shadow-lg border border-md-outline-variant z-50 overflow-hidden max-h-[min(360px,70vh)] overflow-y-auto">
      {#each languages as lang}
        <button
          class="w-full flex items-center gap-3 px-4 py-3 hover:bg-md-surface-variant transition-colors text-start {currentLanguage === lang.code ? 'bg-md-surface-variant' : ''}"
          onclick={(e) => { e.stopPropagation(); void handleLanguageChange(lang.code); }}
          aria-label="Switch to {lang.name}"
          aria-current={currentLanguage === lang.code ? 'true' : undefined}
        >
          <img
            src="https://flagcdn.com/w40/{lang.country}.png"
            alt=""
            class="w-6 h-4 rounded-sm object-cover"
            loading="lazy"
          />
          <span class="text-sm font-medium">{lang.name}</span>
          {#if currentLanguage === lang.code}
            <Icon name="check" class="w-4 h-4 text-md-primary ms-auto" />
          {/if}
        </button>
      {/each}
      <div class="h-px bg-md-outline-variant/40"></div>
      <button
        type="button"
        class="w-full flex items-center gap-3 px-4 py-3 hover:bg-md-primary/10 transition-colors text-start text-md-primary"
        onclick={(e) => { e.stopPropagation(); openLanguageRequest(); }}
      >
        <Icon name="globe" class="w-5 h-5 shrink-0 opacity-80" />
        <span class="text-sm font-semibold">{$t('preferences.requestLanguage')}</span>
      </button>
    </div>
  {/if}
</div>
