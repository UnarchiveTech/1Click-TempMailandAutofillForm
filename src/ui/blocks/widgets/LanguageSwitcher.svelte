<script lang="ts">
/**
 * LanguageSwitcher - feature block (higher-level than a composite).
 *
 * Owns the language-selection logic (locale subscription, persisted preference,
 * language-request link) and delegates all rendering to the reusable
 * `LanguageMenu` composite. Consumed by SettingsView and the Onboarding flow.
 */
import { onMount } from 'svelte';
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import LanguageMenu, { type LanguageOption } from '@/ui/components/composites/LanguageMenu.svelte';
import { CONSTANTS } from '@/utils/constants.js';
import { setLanguage } from '@/utils/i18n/i18n';
import { logError } from '@/utils/logger.js';
import { toastStore } from '@/utils/ui/toastStore.js';

const languages: LanguageOption[] = [
  { code: 'en', name: 'English', country: 'gb' },
  { code: 'es', name: 'Español', country: 'es' },
  { code: 'fr', name: 'Français', country: 'fr' },
  { code: 'de', name: 'Deutsch', country: 'de' },
  { code: 'ja', name: '日本語', country: 'jp' },
  { code: 'zh', name: '中文', country: 'cn' },
  { code: 'ar', name: 'العربية', country: 'sa' },
  { code: 'th', name: 'ไทย', country: 'th' },
];

const LANGUAGE_REQUEST_ISSUE_URL = `${CONSTANTS.GITHUB_REPO_URL.replace(/\/$/, '')}/issues/new?template=language_request.yml&title=${encodeURIComponent('[Language Request] Add support for …')}`;

let currentLanguage = $state('en');

onMount(() => {
  // Subscribe to locale changes (already auto-detected by i18n.ts)
  const unsubscribe = locale.subscribe((value) => {
    currentLanguage = value || 'en';
  });

  // Priority: saved storage (preferredLanguage OR locale) > navigator default
  void browser.storage.local
    .get(['preferredLanguage', 'locale'])
    .then((res) => {
      const savedLang =
        (res.preferredLanguage as string | undefined) || (res.locale as string | undefined);
      if (savedLang && languages.some((lang) => lang.code === savedLang)) {
        return setLanguage(savedLang); // also re-persists both storage keys
      }
    })
    .catch((error) => logError('Language preference load failed', error));

  return unsubscribe;
});

async function handleLanguageChange(langCode: string) {
  // setLanguage persists locale + preferredLanguage and updates document dir/lang
  try {
    await setLanguage(langCode);
  } catch (error) {
    logError('Language change failed', error);
    toastStore.error($t('toasts.operationFailed'));
  }
}

function openLanguageRequest() {
  void browser.tabs.create({ url: LANGUAGE_REQUEST_ISSUE_URL }).catch((error) => {
    logError('Could not open language request page', error);
    toastStore.error($t('toasts.operationFailed'));
  });
}
</script>

<LanguageMenu
  {languages}
  {currentLanguage}
  onSelect={(code) => void handleLanguageChange(code)}
  onRequestLanguage={openLanguageRequest}
/>
