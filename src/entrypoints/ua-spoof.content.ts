import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { inferPlatformFromUA } from '@/utils/user-agent.js';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    void (async () => {
      try {
        const { identities = [], selectedIdentityId } = await browser.storage.local.get([
          'identities',
          'selectedIdentityId',
        ]);
        const activeIdentity = (identities as import('@/utils/types.js').Identity[]).find(
          (i) => i.id === selectedIdentityId
        );
        const customUA = activeIdentity?.userAgent;

        if (!customUA) return;

        const platform = inferPlatformFromUA(customUA);

        // Inject the spoofing script directly into the page's documentElement
        const code = `
          (function() {
            const spoofedUA = ${JSON.stringify(customUA)};
            const spoofedPlatform = ${JSON.stringify(platform)};

            // Override navigator.userAgent
            if ('userAgent' in navigator) {
              Object.defineProperty(navigator, 'userAgent', {
                get: () => spoofedUA,
                configurable: true
              });
            }

            // Override navigator.platform
            if ('platform' in navigator) {
              Object.defineProperty(navigator, 'platform', {
                get: () => spoofedPlatform,
                configurable: true
              });
            }

            // Hide userAgentData so websites fall back to checking navigator.userAgent
            if (navigator.userAgentData) {
              Object.defineProperty(navigator, 'userAgentData', {
                get: () => undefined,
                configurable: true
              });
            }
          })();
        `;

        const script = document.createElement('script');
        script.textContent = code;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
      } catch {
        // fail silently in page context
      }
    })();
  },
});
