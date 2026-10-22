/**
 * Non-invasive human-verification detection for content-script Autofill.
 *
 * This identifies explicit challenge markers only. It does not inspect,
 * extract, click, solve, or submit CAPTCHA tokens, and it cannot determine a
 * site's private server-side bot score.
 */

export type HumanVerificationProvider = 'recaptcha' | 'hcaptcha' | 'turnstile' | 'generic';

export interface HumanVerificationDetection {
  detected: boolean;
  provider?: HumanVerificationProvider;
  signal?: 'widget' | 'response-field' | 'prompt';
}

const PROVIDER_SELECTORS: Array<{
  provider: Exclude<HumanVerificationProvider, 'generic'>;
  selectors: string[];
}> = [
  {
    provider: 'recaptcha',
    selectors: [
      '.g-recaptcha',
      '[class*="g-recaptcha" i][data-sitekey]',
      '[id*="g-recaptcha" i][data-sitekey]',
      'iframe[src*="recaptcha" i]',
      'textarea[name="g-recaptcha-response"]',
      'textarea[id="g-recaptcha-response"]',
    ],
  },
  {
    provider: 'hcaptcha',
    selectors: [
      '.h-captcha',
      '[class*="hcaptcha" i][data-sitekey]',
      '[id*="hcaptcha" i][data-sitekey]',
      'iframe[src*="hcaptcha" i]',
      'textarea[name="h-captcha-response"]',
      'textarea[id="h-captcha-response"]',
    ],
  },
  {
    provider: 'turnstile',
    selectors: [
      '.cf-turnstile',
      '[class*="cf-turnstile" i][data-sitekey]',
      '[id*="cf-turnstile" i][data-sitekey]',
      'iframe[src*="challenges.cloudflare.com" i]',
      'input[name="cf-turnstile-response"]',
      'textarea[name="cf-turnstile-response"]',
    ],
  },
];

const PROMPT_SELECTOR =
  '[role="dialog"], [role="alert"], [aria-live], [class*="captcha" i], [id*="captcha" i], [class*="challenge" i], [id*="challenge" i], [class*="verify" i], [id*="verify" i]';

const HUMAN_VERIFICATION_PROMPT =
  /\b(?:verify\s+(?:that\s+)?you(?:'re| are)\s+human|i['’]?m\s+not\s+a\s+robot|complete\s+(?:the\s+)?(?:security|human)\s+check|confirm\s+you\s+are\s+not\s+a\s+robot|checking\s+your\s+browser|human\s+verification\s+required)\b/i;

function isRendered(element: Element): boolean {
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true')
    return false;
  if (element instanceof HTMLElement) {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (
      style &&
      (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
    ) {
      return false;
    }
  }
  // Providers can leave a configured, empty container on a normal signup
  // page and mount the challenge only after submission. Its own computed
  // display is still "block", but it paints no widget yet. Geometry also
  // excludes markers hidden by an ancestor rather than by their own style.
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function queryMatches(
  root: ParentNode,
  selector: string,
  allowHiddenExplicitMarker = false
): Element | null {
  try {
    return (
      Array.from(root.querySelectorAll(selector)).find(
        (match) => allowHiddenExplicitMarker || isRendered(match)
      ) || null
    );
  } catch {
    // Older engines may reject a selector with the `i` flag. A failed optional
    // detector must never interrupt Autofill.
    return null;
  }
}

function responseFieldHasValue(element: Element): boolean {
  const value =
    'value' in element &&
    typeof (element as HTMLInputElement | HTMLTextAreaElement).value === 'string'
      ? (element as HTMLInputElement | HTMLTextAreaElement).value
      : element.getAttribute('value') || '';
  return value.trim().length > 0;
}

/** A provider widget can remain mounted after successful verification. */
function providerHasCompletedResponse(
  root: ParentNode,
  provider: Exclude<HumanVerificationProvider, 'generic'>
): boolean {
  const config = PROVIDER_SELECTORS.find((entry) => entry.provider === provider);
  if (!config) return false;
  const doc =
    (root as Element).ownerDocument || (typeof document !== 'undefined' ? document : null);
  const searchRoots = doc && doc !== root ? [root, doc] : [root];
  for (const searchRoot of searchRoots) {
    for (const selector of config.selectors.filter((entry) => /response|token/i.test(entry))) {
      try {
        if (Array.from(searchRoot.querySelectorAll(selector)).some(responseFieldHasValue))
          return true;
      } catch {
        // Optional detector selectors must never interrupt Autofill.
      }
    }
  }
  return false;
}

/** Detect explicit pending CAPTCHA/human-verification markers in the supplied DOM root. */
export function detectHumanVerification(root?: ParentNode): HumanVerificationDetection {
  const target = root ?? (typeof document !== 'undefined' ? document : null);
  if (!target) return { detected: false };

  const pageDocument = target instanceof Document ? target : (target as Node).ownerDocument;
  // Full-page Cloudflare checks may have no inputs or CAPTCHA widget yet.
  // Require its waiting-page title plus a visible, explicit verification heading;
  // an ordinary article about CAPTCHA must never block autofill.
  if (pageDocument && /^just a moment(?:\.{3}|…)?$/i.test(pageDocument.title.trim())) {
    // Branded waiting pages can replace Cloudflare's verification prose.
    // Require both its challenge-page script and rendered challenge heading;
    // a normal site merely loading Turnstile does not satisfy this signature.
    const brandedHeading = queryMatches(target, '#challenge_title');
    if (
      brandedHeading?.textContent?.trim() &&
      queryMatches(pageDocument, 'script[src*="/cdn-cgi/challenge-platform/"]', true)
    ) {
      return { detected: true, provider: 'generic', signal: 'prompt' };
    }
    for (const heading of queryMatchesAll(target, 'main h2,[role="main"] h2')) {
      if (
        /^(?:performing security verification|verifying you are human|checking your browser)\b/i.test(
          (heading.textContent || '').trim()
        )
      ) {
        return { detected: true, provider: 'generic', signal: 'prompt' };
      }
    }
  }

  for (const { provider, selectors } of PROVIDER_SELECTORS) {
    for (const selector of selectors) {
      const isResponseField = /response|token/i.test(selector);
      const match = queryMatches(target, selector, isResponseField);
      if (!match) continue;

      // Hidden response fields are intentionally present in most CAPTCHA
      // widgets. An empty field means verification is still pending; a
      // non-empty field means the user already completed it. Widget iframes and
      // containers may remain in the DOM after completion, so consult their
      // provider response field before blocking a retry.
      if (isResponseField && responseFieldHasValue(match)) continue;
      if (!isResponseField && providerHasCompletedResponse(target, provider)) continue;

      return {
        detected: true,
        provider,
        signal: isResponseField ? 'response-field' : 'widget',
      };
    }
  }

  const promptCandidates = queryMatchesAll(target, PROMPT_SELECTOR);
  for (const candidate of promptCandidates) {
    if (HUMAN_VERIFICATION_PROMPT.test((candidate.textContent || '').replace(/\s+/g, ' '))) {
      return { detected: true, provider: 'generic', signal: 'prompt' };
    }
  }

  return { detected: false };
}

function queryMatchesAll(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector)).filter(isRendered);
  } catch {
    return [];
  }
}
