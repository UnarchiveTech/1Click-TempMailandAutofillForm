import { domainsShareSiteBoundary } from '@/utils/validation.js';

/** Restore SPA history methods after the content script is torn down. */
export function restoreHistoryMethods(
  historyObject: Pick<History, 'pushState' | 'replaceState'>,
  originalPushState: History['pushState'],
  originalReplaceState: History['replaceState']
): void {
  if (historyObject.pushState !== originalPushState) {
    historyObject.pushState = originalPushState;
  }
  if (historyObject.replaceState !== originalReplaceState) {
    historyObject.replaceState = originalReplaceState;
  }
}

/**
 * True when this frame contains an auth surface worth handling.
 * With allFrames enabled, form-less frames (ads, analytics) must NOT answer
 * message handlers first - otherwise a race could surface a false
 * "no form found" error even though the real frame handled the request.
 */
export function hasAuthSurface(): boolean {
  try {
    return !!document.querySelector(
      'input[type="email"], input[type="password"], input[type="tel"], ' +
        'input[autocomplete="email"], input[autocomplete="one-time-code"]'
    );
  } catch {
    return true;
  }
}

/** Every Nth consecutive form-surface miss deep-scans once, so shadow-hosted
 * auth surfaces (invisible to the light-DOM probe) still recover (~60s at 4s
 * ticks). Exported so tests can pin the amortization contract. */
export const AUTH_PROBE_DEEP_SCAN_INTERVAL = 15;

/**
 * Sound superset of hasAuthSurface() used by the 4s form-watch tick's idle
 * bail. findSignupForm() acts on more than auth inputs - email-signal text
 * fields ("newsletter"-style forms) and progressive containers whose step
 * inputs may live inside shadow roots - and the scan paths are deliberately
 * NOT gated on hasAuthSurface(). So the tick may only bail when the light DOM
 * holds NO form element and NO fillable field at all; shadow-hosted surfaces
 * recover via the amortized deep scan instead. Stays `true` when the DOM
 * cannot be probed (hostile frames), so a failed query never disables the
 * loop.
 */
export function hasAuthOrFormSurface(): boolean {
  try {
    return !!document.querySelector('form, input, select, textarea');
  } catch {
    return true;
  }
}

/** Include open shadow roots when checking for a surface in an idle frame. */
export function hasAuthOrFormSurfaceDeep(
  initialRoot: Document | ShadowRoot | Element = document
): boolean {
  try {
    const roots: Array<Document | ShadowRoot | Element> = [initialRoot];
    while (roots.length > 0) {
      const root = roots.pop();
      if (!root) continue;
      if ('shadowRoot' in root && root.shadowRoot) roots.push(root.shadowRoot);
      if (root.querySelector('form, input, select, textarea')) return true;
      for (const element of Array.from(root.querySelectorAll('*'))) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }
    return false;
  } catch {
    // A hostile document should keep the autofill runtime available.
    return true;
  }
}

/** A changed field itself, its containing subtree, or an added open shadow host. */
export function nodeHasFormSurface(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  if (
    element.id.includes('oneclick') ||
    element.classList.contains('oneclick-autofill-btn') ||
    element.hasAttribute('data-oneclick-injected')
  )
    return false;
  return element.matches('form, input, select, textarea') || hasAuthOrFormSurfaceDeep(element);
}

/** Ignore extension padding/position writes; only CSS visibility affects discovery. */
export function isFormSurfaceAttributeChange(
  mutation: Pick<MutationRecord, 'type' | 'target' | 'attributeName' | 'oldValue'>
): boolean {
  if (mutation.type !== 'attributes' || !nodeHasFormSurface(mutation.target)) return false;
  if (mutation.attributeName !== 'style') return true;
  const element = mutation.target as HTMLElement;
  const previous = element.ownerDocument.createElement('span').style;
  previous.cssText = mutation.oldValue || '';
  return ['display', 'visibility', 'opacity', 'content-visibility'].some(
    (property) => previous.getPropertyValue(property) !== element.style.getPropertyValue(property)
  );
}

export function isTabRelatedToOtp(currentDomain: string, senderEmail: string): boolean {
  const currentHost = currentDomain.trim().toLowerCase().replace(/\.$/, '');
  // Prefer the actual address in a mailto link or angle-bracketed From field.
  // A display name can contain an arbitrary @domain and must not establish
  // the sender's site.
  const mailtoAddress = senderEmail.match(/\[[^\]]*\]\(mailto:([^?\s)]+)(?:\?[^)]*)?\)/i)?.[1];
  const angleAddress = senderEmail.match(/<([^<>]+)>/)?.[1];
  const address = (mailtoAddress ?? angleAddress ?? senderEmail).trim().toLowerCase();
  const emailDomainMatch = address.match(/^[^@\s<>]+@([^>\s,;:()[\]]+)/);
  if (!currentHost || !emailDomainMatch) return false;
  const senderHost = emailDomainMatch[1].trim().toLowerCase().replace(/\.$/, '');
  return !!senderHost && domainsShareSiteBoundary(currentHost, senderHost);
}
