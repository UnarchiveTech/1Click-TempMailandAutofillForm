/**
 * Multi-step signup wizard session - track step 1 → OTP → profile and resume.
 *
 * Sessions are keyed by `domain + tabId` so two concurrent signups on the
 * SAME domain (two tabs) never overwrite each other's progress. `tabId` is
 * injected by the background from the message sender - content scripts don't
 * know their own tab id.
 */

import { browser } from 'wxt/browser';
import { withLock } from '@/utils/mutex.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { detectSignupWizardStep } from './signup-page.js';
import { normalizeDomain } from './storage.js';

export type WizardStep = 'form' | 'otp' | 'profile' | 'done';

export interface WizardSession {
  domain: string;
  /** Owning tab when known (sessions from content scripts always carry one). */
  tabId?: number;
  step: WizardStep;
  email?: string | null;
  identityId?: string | null;
  addressId?: string | null;
  /** Values already filled (no passwords in long-term if sensitive - password optional) */
  filled: Record<string, string>;
  startedAt: number;
  updatedAt: number;
  /** Path patterns seen */
  paths: string[];
}

const KEY = 'autofillWizardSessions_v1';
const MAX = 30;
const TTL_MS = 2 * 60 * 60 * 1000; // 2h

/** Storage key for one session - tab-scoped so same-domain tabs don't collide. */
function sessionKey(domain: string, tabId?: number): string {
  return tabId != null ? `${domain}::tab:${tabId}` : `${domain}::shared`;
}

export async function loadWizardSessions(): Promise<Record<string, WizardSession>> {
  try {
    const res = (await browser.storage.session
      .get([KEY])
      .catch(() => browser.storage.local.get([KEY]))) as { [KEY]?: Record<string, WizardSession> };
    const all = res[KEY] || {};
    const now = Date.now();
    const kept: Record<string, WizardSession> = {};
    for (const [k, v] of Object.entries(all)) {
      if (now - (v.updatedAt || 0) < TTL_MS) kept[k] = v;
    }
    return kept;
  } catch {
    /* ignore */
    return {};
  }
}

async function saveAll(map: Record<string, WizardSession>): Promise<void> {
  const entries = Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt);
  const trimmed: Record<string, WizardSession> = {};
  for (const s of entries.slice(0, MAX)) trimmed[sessionKey(s.domain, s.tabId)] = s;
  try {
    await browser.storage.session.set({ [KEY]: trimmed });
  } catch {
    /* ignore */
    await writeWithRetry({ [KEY]: trimmed });
  }
}

/**
 * Get a session for a domain. With a tabId, only THAT tab's session is
 * returned; without one, the most recently updated session across tabs wins
 * (used by UI surfaces that aren't tab-bound).
 */
export async function getWizardSession(
  domain: string,
  tabId?: number
): Promise<WizardSession | null> {
  const d = normalizeDomain(domain);
  const all = await loadWizardSessions();
  if (tabId != null) {
    return all[sessionKey(d, tabId)] || null;
  }
  const matches = Object.values(all)
    .filter((s) => s.domain === d)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return matches[0] || null;
}

export async function upsertWizardSession(
  partial: Partial<WizardSession> & { domain: string }
): Promise<WizardSession> {
  return withLock('autofill_wizard_sessions_lock', async () => {
    const d = normalizeDomain(partial.domain);
    const tabId = partial.tabId;
    const all = await loadWizardSessions();
    const prev = all[sessionKey(d, tabId)];
    const next: WizardSession = {
      domain: d,
      tabId: tabId ?? prev?.tabId,
      step: partial.step || prev?.step || 'form',
      email: partial.email !== undefined ? partial.email : prev?.email,
      identityId: partial.identityId !== undefined ? partial.identityId : prev?.identityId,
      addressId: partial.addressId !== undefined ? partial.addressId : prev?.addressId,
      filled: { ...(prev?.filled || {}), ...(partial.filled || {}) },
      startedAt: prev?.startedAt || Date.now(),
      updatedAt: Date.now(),
      paths: [...new Set([...(prev?.paths || []), ...(partial.paths || [])])].slice(-12),
    };
    all[sessionKey(d, tabId)] = next;
    await saveAll(all);
    return next;
  });
}

export async function advanceWizardStep(
  domain: string,
  step: WizardStep,
  extra?: Partial<WizardSession>,
  tabId?: number
): Promise<void> {
  await upsertWizardSession({ domain, step, tabId, ...extra });
}

export function detectWizardStepFromPage(): WizardStep {
  return typeof document === 'undefined' ? 'form' : detectSignupWizardStep();
}

export async function clearWizardSession(domain: string, tabId?: number): Promise<void> {
  await withLock('autofill_wizard_sessions_lock', async () => {
    const d = normalizeDomain(domain);
    const all = await loadWizardSessions();
    if (tabId != null) {
      delete all[sessionKey(d, tabId)];
    } else {
      // No tab scope: remove every session for the domain (legacy callers).
      for (const [k, s] of Object.entries(all)) {
        if (s.domain === d) delete all[k];
      }
    }
    await saveAll(all);
  });
}
