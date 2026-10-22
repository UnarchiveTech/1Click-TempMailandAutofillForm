import { domainsShareRegistrableSite } from '@/utils/validation.js';

/** Find external or downgraded destinations a form could submit to. */
export function getExternalSubmitDestination(
  form: HTMLFormElement | HTMLElement
): { currentSite: string; destinationSites: string[] } | null {
  const htmlForm =
    form instanceof HTMLFormElement ? form : form.querySelector<HTMLFormElement>('form');
  if (!htmlForm || typeof location === 'undefined') return null;

  const actionCandidates = [htmlForm.getAttribute('action') || location.href];
  for (const control of Array.from(htmlForm.elements)) {
    const isSubmitButton =
      (control instanceof HTMLButtonElement && control.type === 'submit') ||
      (control instanceof HTMLInputElement && ['submit', 'image'].includes(control.type));
    if (isSubmitButton && control.hasAttribute('formaction')) {
      actionCandidates.push(control.getAttribute('formaction') || location.href);
    }
  }
  // Image submitters are successful controls, but HTMLFormControlsCollection
  // may omit them. Inspect associated image inputs separately, including ones
  // linked through a `form` attribute outside the form element.
  for (const control of Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="image"][formaction]')
  )) {
    if (control.form === htmlForm) {
      actionCandidates.push(control.getAttribute('formaction') || location.href);
    }
  }

  const currentSite = location.hostname.toLowerCase();
  const isIpHostname = (host: string) =>
    host.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
  const destinationSites = new Set<string>();
  for (const action of actionCandidates) {
    let destination: URL;
    try {
      destination = new URL(action, document.baseURI);
    } catch {
      continue;
    }
    if (destination.protocol !== 'https:' && destination.protocol !== 'http:') continue;
    const destinationSite = destination.hostname.toLowerCase();
    const sameSite =
      isIpHostname(currentSite) || isIpHostname(destinationSite)
        ? currentSite === destinationSite
        : domainsShareRegistrableSite(currentSite, destinationSite);
    const insecureDowngrade = location.protocol === 'https:' && destination.protocol === 'http:';
    if (!sameSite || insecureDowngrade) {
      destinationSites.add(
        insecureDowngrade && sameSite
          ? `${destination.protocol}//${destination.host}`
          : destinationSite
      );
    }
  }

  return destinationSites.size > 0
    ? { currentSite, destinationSites: [...destinationSites] }
    : null;
}
