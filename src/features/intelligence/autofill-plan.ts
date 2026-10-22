/**
 * Autofill intelligence orchestrator - FormScore + identity route + replay decision.
 */

import type { ReusableCredential } from '@/features/login-info/saved-login-credentials.js';
import {
  routeIdentityForDomainViaBg,
  shouldPreferReplayViaBg,
} from '@/utils/content/content-bg-bridge.js';
import type { Identity } from '@/utils/types.js';
import { normalizeDomain } from '@/utils/validation.js';
import { scoreForm } from './form-score.js';
import type { AutofillPlan, FormScore, IdentityRouteResult } from './types.js';

export async function buildAutofillPlan(
  form: HTMLElement,
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
  const formScore: FormScore = await scoreForm(form, domain);
  const routeResult = await routeIdentityForDomainViaBg(
    domain,
    opts?.identities,
    opts?.selectedIdentityId
  );
  const route: IdentityRouteResult = routeResult
    ? (routeResult as { identityId: string | null; reason: IdentityRouteResult['reason'] })
    : { identityId: null, reason: 'none' };

  let replay = opts?.replayCredential ?? null;
  if (replay === undefined) {
    // Lookup not done yet - caller may pass null after background fetch
    replay = null;
  }

  const preferReplay = await shouldPreferReplayViaBg(domain);
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
