/**
 * A11y-first field classification - prefer label / aria over name heuristics.
 */

import { matchKindFromTextViaBg } from '@/utils/content/content-bg-bridge.js';
import type { FormFieldKind } from './types.js';

export function getAccessibleName(el: HTMLElement): string {
  const parts: string[] = [];
  try {
    const aria = el.getAttribute('aria-label');
    if (aria) parts.push(aria);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const ref = el.ownerDocument?.getElementById(id);
        if (ref?.textContent) parts.push(ref.textContent);
      }
    }
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
    ) {
      if (el.labels) {
        for (const lab of Array.from(el.labels)) parts.push(lab.textContent || '');
      }
    }
    if (el.id) {
      const lab = el.ownerDocument?.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab?.textContent) parts.push(lab.textContent);
    }
    // Placeholder is weaker than label but still a11y-ish
    if ('placeholder' in el && (el as HTMLInputElement).placeholder) {
      parts.push((el as HTMLInputElement).placeholder);
    }
  } catch {
    /* ignore */
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

import { safeId, safeName } from '@/utils/security/dom-safe.js';

/** Score kind with a11y-first priority (label/aria > autocomplete > name/id). */
export async function classifyFieldA11y(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): Promise<{
  kind: FormFieldKind;
  confidence: number;
  source: 'aria' | 'autocomplete' | 'name' | 'type';
}> {
  const type = (el as HTMLInputElement).type?.toLowerCase?.() || '';
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  const a11y = getAccessibleName(el as HTMLElement);
  const nameId = `${safeName(el)} ${safeId(el)}`.toLowerCase();

  if (type === 'password' || ac === 'new-password' || ac === 'current-password') {
    return { kind: 'password', confidence: 0.99, source: 'type' };
  }
  if (type === 'email' || ac === 'email' || ac.includes('email')) {
    return { kind: 'email', confidence: 0.98, source: type === 'email' ? 'type' : 'autocomplete' };
  }

  // A11y labels first
  const a11yKind = await matchKindFromText(a11y);
  if (a11yKind) return { ...a11yKind, source: 'aria' };

  // Autocomplete
  if (ac === 'username') return { kind: 'username', confidence: 0.9, source: 'autocomplete' };
  if (ac === 'given-name') return { kind: 'firstName', confidence: 0.95, source: 'autocomplete' };
  if (ac === 'family-name') return { kind: 'lastName', confidence: 0.95, source: 'autocomplete' };
  if (ac === 'name') return { kind: 'fullName', confidence: 0.9, source: 'autocomplete' };
  if (ac === 'tel' || ac.startsWith('tel-'))
    return { kind: 'phone', confidence: 0.95, source: 'autocomplete' };
  if (ac === 'bday' || ac.startsWith('bday'))
    return { kind: 'dob', confidence: 0.9, source: 'autocomplete' };
  if (ac === 'sex' || ac === 'gender')
    return { kind: 'gender', confidence: 0.9, source: 'autocomplete' };
  if (ac === 'country' || ac === 'country-name')
    return { kind: 'country', confidence: 0.9, source: 'autocomplete' };
  if (ac === 'address-level2') return { kind: 'city', confidence: 0.85, source: 'autocomplete' };
  if (ac === 'address-level1') return { kind: 'state', confidence: 0.85, source: 'autocomplete' };
  if (ac === 'street-address') return { kind: 'address', confidence: 0.85, source: 'autocomplete' };
  if (ac === 'postal-code') return { kind: 'pin', confidence: 0.9, source: 'autocomplete' };
  if (ac === 'url') return { kind: 'website', confidence: 0.9, source: 'autocomplete' };
  if (ac === 'one-time-code') return { kind: 'unknown', confidence: 0.3, source: 'autocomplete' };

  // Name/id fallback
  const nameKind = await matchKindFromText(nameId);
  if (nameKind) return { ...nameKind, source: 'name', confidence: nameKind.confidence * 0.85 };

  if (type === 'tel') return { kind: 'phone', confidence: 0.8, source: 'type' };
  if (type === 'url') return { kind: 'website', confidence: 0.8, source: 'type' };
  if (type === 'date') return { kind: 'dob', confidence: 0.7, source: 'type' };

  return { kind: 'unknown', confidence: 0.2, source: 'name' };
}

export async function matchKindFromText(
  text: string
): Promise<{ kind: FormFieldKind; confidence: number } | null> {
  if (!text) return null;
  return matchKindFromTextViaBg(text);
}
