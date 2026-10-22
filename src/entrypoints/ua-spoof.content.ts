import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { logError, setContentLogging } from '@/utils/content/content-logger.js';
import { inferPlatformFromUA, isSafeUserAgentString } from '@/utils/content/user-agent.js';

/**
 * How long we keep listening for a CSP refusal after installing the inline
 * override. A refused inline script reports through `securitypolicyviolation`
 * asynchronously but within the same task turn, so this only has to outlast the
 * report. Nothing waits on it: the override is live the moment the tag is
 * appended, and the timer only stops us listening to a violation that can no
 * longer be ours.
 */
const CSP_REFUSAL_WINDOW_MS = 1000;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    void (async () => {
      try {
        // Errors are never suppressed by the logger; this only namespaces them
        // (`[1Click UA] …`) instead of logging a bare line into the host page.
        setContentLogging('[1Click UA]', false);

        const { identities = [], selectedIdentityId } = await browser.storage.local.get([
          'identities',
          'selectedIdentityId',
        ]);
        const activeIdentity = (identities as import('@/utils/types.js').Identity[]).find(
          (i) => i.id === selectedIdentityId
        );
        const customUA = activeIdentity?.userAgent;

        if (!customUA || !isSafeUserAgentString(customUA)) return;

        const platform = inferPlatformFromUA(customUA);

        // A page whose CSP forbids inline script refuses the tag below SILENTLY:
        // no error event reaches this isolated world, so the page then reads the
        // REAL `navigator.userAgent` while our declarativeNetRequest rule rewrites
        // the request header - a mismatch that is itself a fingerprint. Watch for
        // that refusal and only then ask the background to install the same
        // override through `scripting.executeScript({ world: 'MAIN' })`, which the
        // page's CSP cannot block.
        let fallbackRequested = false;
        let refusalTimer: number | undefined;
        const stopListening = () => {
          document.removeEventListener('securitypolicyviolation', onViolation);
          if (refusalTimer !== undefined) window.clearTimeout(refusalTimer);
          refusalTimer = undefined;
        };
        const onViolation = (event: SecurityPolicyViolationEvent) => {
          if (fallbackRequested) return;
          // An inline script is refused as `blockedURI: 'inline'`; a URL there is
          // an external resource being refused, which is not ours to fix.
          if (event.blockedURI !== 'inline') return;
          if (!event.violatedDirective.startsWith('script-src')) return;
          fallbackRequested = true;
          stopListening();
          // Fire-and-forget, and the only route that leaves no unhandled
          // rejection in the host page's console when the extension context has
          // gone away mid-navigation.
          browser.runtime.sendMessage({ type: 'applyUserAgentSpoof' }).catch(logError);
        };

        document.addEventListener('securitypolicyviolation', onViolation);
        refusalTimer = window.setTimeout(stopListening, CSP_REFUSAL_WINDOW_MS);

        // Inject the spoofing script directly into the page's documentElement.
        // Its three overrides MUST stay identical to `installUserAgentOverride`
        // in src/entrypoints/background/apply-user-agent-spoof.ts - the CSP
        // fallback path for this same spoof.
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
        /* ignore: best-effort. At document_start we can legitimately arrive into
           a page already being torn down (a navigation under way, an extension
           context reloaded), and there is nothing the user could act on. The
           failure that DOES matter - a CSP refusing the inline override - is
           handled by the securitypolicyviolation listener above, not here. */
      }
    })();
  },
});
