import { sendMessageViaBg } from '@/utils/content/content-bg-bridge.js';
import { getCachedSitePrivacySettingsOrDisabled } from '@/utils/content/site-privacy-settings.js';
import { t } from '@/utils/i18n/content-i18n.js';
import { logError } from '@/utils/logger.js';
import { rejectedEmailDomain } from '@/utils/provider/site-email-domains.js';
import { showConflictChip } from '../dom/tooltip.js';

/** Observe explicit domain rejection, including server-rendered errors after reload.
 * No provider requests, submission, or automatic field replacement happens here. */
export function watchSiteEmailDomainRejection(root: ParentNode): () => void {
  let stopped = false;
  let checking = false;
  let dirty = false;
  const seen = new Set<string>();
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void check(), 200);
  });
  const stop = () => {
    stopped = true;
    observer.disconnect();
    clearTimeout(debounce);
    clearTimeout(expiry);
    root.removeEventListener('input', onInput);
    seen.clear();
  };
  const check = async () => {
    if (stopped || !getCachedSitePrivacySettingsOrDisabled().formScanning) return;
    if (root instanceof Element && !root.isConnected) return stop();
    if (checking) {
      dirty = true;
      return;
    }
    checking = true;
    try {
      const fields = root.querySelectorAll<HTMLInputElement>(
        'input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i]'
      );
      const errors = document.querySelectorAll<HTMLElement>(
        '[role="alert"], [aria-live], [class*="error" i], .invalid, .field-error, .validation-message'
      );
      for (const field of Array.from(fields).slice(0, 6)) {
        const email = field.value.trim();
        for (const error of Array.from(errors).slice(0, 80)) {
          if (!error.getClientRects().length) continue;
          const text = error.textContent?.trim() || '';
          const domain = rejectedEmailDomain(text, email);
          if (!domain || seen.has(domain)) continue;
          const result = await sendMessageViaBg<{ success?: boolean }>({
            type: 'recordSiteEmailDomainRejection',
            email,
            text,
          });
          if (stopped || !field.isConnected || field.value.trim() !== email) return;
          if (result?.success) {
            seen.add(domain);
            const message = await t('contentAutofill.emailDomainRejected', {
              domain,
              site: location.hostname,
            });
            if (!stopped) showConflictChip(field, message);
          }
        }
      }
    } catch (error: unknown) {
      logError('Could not remember the site email-domain rejection', error);
    } finally {
      checking = false;
      if (dirty && !stopped) {
        dirty = false;
        void check();
      }
    }
  };
  const onInput = () => void check();
  const expiry = setTimeout(stop, 5 * 60_000);
  root.addEventListener('input', onInput);
  if (document.body)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-invalid'],
    });
  void check();
  return stop;
}
