import { onMount } from 'svelte';
import { browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';
import {
  DEFAULT_VERIFICATION_PREFERENCES,
  normalizeVerificationPreferences,
  type VerificationPreferences,
} from '@/utils/otp/verification-policy.js';
import { updateStoredObject } from '@/utils/storage/rmw.js';

export function useVerificationPreferences(onFailure: () => void) {
  let preferences = $state<VerificationPreferences>({ ...DEFAULT_VERIFICATION_PREFERENCES });
  let saving = $state(false);
  onMount(() => {
    let revision = 0;
    let disposed = false;
    const onChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== 'local' || !changes.verificationPreferences) return;
      revision++;
      preferences = normalizeVerificationPreferences(changes.verificationPreferences.newValue);
    };
    browser.storage.onChanged.addListener(onChange);
    const initialRevision = revision;
    void browser.storage.local
      .get('verificationPreferences')
      .then((stored) => {
        if (!disposed && initialRevision === revision)
          preferences = normalizeVerificationPreferences(stored.verificationPreferences);
      })
      .catch((error) => {
        logError('Failed to load verification preferences', error);
        if (!disposed) onFailure();
      });
    return () => {
      disposed = true;
      browser.storage.onChanged.removeListener(onChange);
    };
  });
  async function save(update: Partial<VerificationPreferences>) {
    if (saving) return;
    saving = true;
    try {
      preferences = await updateStoredObject(
        'verificationPreferences',
        (current) => normalizeVerificationPreferences({ ...current, ...update }),
        normalizeVerificationPreferences
      );
    } catch (error) {
      logError('Failed to save verification preferences', error);
      onFailure();
    } finally {
      saving = false;
    }
  }
  return {
    get value() {
      return preferences;
    },
    get saving() {
      return saving;
    },
    save,
  };
}
