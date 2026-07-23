/**
 * Autofill intelligence orchestrator — FormScore + identity route + replay decision.
 */

import { browser } from 'wxt/browser';
import type { ReusableCredential } from '@/features/login-info/login-crypto.js';
import type { Identity } from '@/utils/types.js';
import { scoreForm } from './form-score.js';
import { routeIdentityForDomain } from './identity-router.js';
import { shouldPreferReplay } from './site-memory.js';
import { normalizeDomain } from './storage.js';
import type { AutofillPlan, FormScore } from './types.js';

export async function buildAutofillPlan(
  form: HTMLFormElement,
  opts?: {
    domain?: string;
    replayCredential?: ReusableCredential | null;
    identities?: Identity[];
    selectedIdentityId?: string | null;
  }
): Promise<AutofillPlan> {
  const domain =
    normalizeDomain(opts?.domain || (typeof location !== 'undefined' ? location.hostname : '')) ||
    'unknown';
  const formScore: FormScore = scoreForm(form, domain);
  const route = await routeIdentityForDomain(domain, opts?.identities, opts?.selectedIdentityId);

  let replay = opts?.replayCredential ?? null;
  if (replay === undefined) {
    // Lookup not done yet — caller may pass null after background fetch
    replay = null;
  }

  const preferReplay = await shouldPreferReplay(domain);
  const useReplay = !!(replay && preferReplay);

  return {
    domain,
    formScore,
    identityId: route.identityId,
    identityReason: route.reason,
    useReplay,
    mode: useReplay ? 'replay' : 'generate',
  };
}

/**
 * Resolve active inbox + domain for memory recording.
 */
export async function getActiveInboxMeta(): Promise<{
  inboxId: string | null;
  address: string | null;
  provider: string | null;
  providerDisplay: string | null;
}> {
  try {
    const { activeInboxId, inboxes = [] } = (await browser.storage.local.get([
      'activeInboxId',
      'inboxes',
    ])) as {
      activeInboxId?: string;
      inboxes?: Array<{
        id: string;
        address: string;
        provider?: string;
        providerName?: string;
      }>;
    };
    const inbox = inboxes.find((i) => i.id === activeInboxId) || inboxes[0];
    if (!inbox) {
      return { inboxId: null, address: null, provider: null, providerDisplay: null };
    }
    let providerDisplay = inbox.providerName || null;
    if (!providerDisplay && inbox.provider) {
      try {
        const { loadProviderConfig } = await import('@/utils/email-service.js');
        const cfg = loadProviderConfig(inbox.provider);
        providerDisplay = cfg?.displayName || inbox.provider;
      } catch {
        providerDisplay = inbox.provider;
      }
    }
    return {
      inboxId: inbox.id || null,
      address: inbox.address || null,
      provider: inbox.provider || null,
      providerDisplay,
    };
  } catch {
    return { inboxId: null, address: null, provider: null, providerDisplay: null };
  }
}
