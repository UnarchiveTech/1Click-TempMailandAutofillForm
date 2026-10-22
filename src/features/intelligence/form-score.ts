/**
 * FormScore - classify signup-form fields for the autofill intelligence layer.
 */

import { safeId, safeName, safePlaceholder } from '@/utils/security/dom-safe.js';
import { normalizeDomain } from '@/utils/validation.js';
import { classifyFieldA11y } from './a11y-fields.js';
import type { FormFieldKind, FormScore, ScoredField } from './types.js';

function fieldMeta(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  const labelText = (() => {
    try {
      if (el.labels?.length) {
        return Array.from(el.labels)
          .map((l) => l.textContent || '')
          .join(' ');
      }
      const elId = safeId(el);
      if (elId) {
        const lab = el.ownerDocument?.querySelector(`label[for="${CSS.escape(elId)}"]`);
        if (lab?.textContent) return lab.textContent;
      }
    } catch {
      /* ignore */
    }
    return '';
  })();
  return `${safeName(el)} ${safeId(el)} ${'placeholder' in el ? safePlaceholder(el) : ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('autocomplete') || ''} ${labelText}`.toLowerCase();
}

async function scoreKind(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): Promise<ScoredField> {
  // A11y-first: prefer label/aria before raw name heuristics
  const a11y = await classifyFieldA11y(el);
  if (a11y.kind !== 'unknown' && a11y.confidence >= 0.75) {
    return { kind: a11y.kind, confidence: a11y.confidence };
  }

  const tag = el.tagName.toLowerCase();
  const type = (el as HTMLInputElement).type?.toLowerCase?.() || '';
  const meta = fieldMeta(el);

  // Username before password so "username" never scores as password
  if (
    type !== 'password' &&
    /user.?name|userid|user_id|handle|nickname|login.?name|account.?name/.test(meta)
  ) {
    return { kind: 'username', confidence: 0.88 };
  }
  if (
    type === 'password' ||
    ((/password|passwd|\bpwd\b|passcode|new-password|current-password/.test(meta) ||
      el.getAttribute('autocomplete') === 'new-password' ||
      el.getAttribute('autocomplete') === 'current-password') &&
      !/user.?name|userid|handle/.test(meta))
  ) {
    return { kind: 'password', confidence: type === 'password' ? 0.98 : 0.85 };
  }
  if (
    type === 'email' ||
    el.getAttribute('autocomplete') === 'email' ||
    /\bemail\b|e-mail/.test(meta)
  ) {
    return { kind: 'email', confidence: type === 'email' ? 0.98 : 0.88 };
  }
  if (type === 'tel' || /\bphone\b|mobile|tel\b/.test(meta)) {
    return { kind: 'phone', confidence: type === 'tel' ? 0.95 : 0.8 };
  }
  if (type === 'url' || /\bwebsite\b|\burl\b|homepage/.test(meta)) {
    return { kind: 'website', confidence: 0.85 };
  }
  if (/first.?name|fname|given.?name/.test(meta)) {
    return { kind: 'firstName', confidence: 0.9 };
  }
  if (/last.?name|lname|surname|family.?name/.test(meta)) {
    return { kind: 'lastName', confidence: 0.9 };
  }
  if (/full.?name|\bname\b/.test(meta) && !/user|company|file|org/.test(meta)) {
    return { kind: 'fullName', confidence: 0.7 };
  }
  if (/birth|dob|birthday/.test(meta) || type === 'date') {
    return { kind: 'dob', confidence: 0.75 };
  }
  if (/gender|sex\b/.test(meta) || (tag === 'select' && /gender|sex/.test(meta))) {
    return { kind: 'gender', confidence: 0.8 };
  }
  if (/\bcountry\b|nation/.test(meta)) {
    return { kind: 'country', confidence: 0.8 };
  }
  if (/\bcity\b|town/.test(meta)) {
    return { kind: 'city', confidence: 0.75 };
  }
  if (/\bstate\b|province|region/.test(meta)) {
    return { kind: 'state', confidence: 0.75 };
  }
  if (/street|address.?line|addr\b/.test(meta)) {
    return { kind: 'address', confidence: 0.7 };
  }
  if (/\bzip\b|postal|post.?code|pin.?code/.test(meta)) {
    return { kind: 'pin', confidence: 0.72 };
  }
  if (type === 'file' || /avatar|photo|profile.?pic|picture|upload/.test(meta)) {
    return { kind: 'profilePicture', confidence: type === 'file' ? 0.7 : 0.55 };
  }
  if (
    (type === 'checkbox' && /terms|privacy|policy|agree|tos|gdpr|consent/.test(meta)) ||
    /terms|privacy|policy|agree|tos/.test(meta)
  ) {
    return { kind: 'terms', confidence: 0.85 };
  }
  return { kind: 'unknown', confidence: 0.2 };
}

/**
 * Score a form for signup autofill readiness.
 */
export async function scoreForm(form: HTMLElement, pageDomain?: string): Promise<FormScore> {
  const domain =
    normalizeDomain(pageDomain || (typeof location !== 'undefined' ? location.hostname : '')) ||
    'unknown';
  const inputs = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), select, textarea'
  );
  const fields: ScoredField[] = [];
  for (const el of inputs) {
    if ((el as HTMLInputElement).disabled) continue;
    const scored = await scoreKind(el);
    if (scored.kind !== 'unknown' || scored.confidence >= 0.5) {
      fields.push(scored);
    }
  }

  const kinds = new Set(fields.map((f) => f.kind));
  const hasEmail = kinds.has('email');
  const hasPassword = kinds.has('password');
  const hasTerms = kinds.has('terms');
  const hasName = kinds.has('firstName') || kinds.has('lastName') || kinds.has('fullName');
  const hasUsername = kinds.has('username');
  const hasPhone = kinds.has('phone');

  // Heuristic signup likelihood (works for progressive SPA steps too)
  let signup = 0.15;
  if (hasEmail) signup += 0.28;
  if (hasPassword) signup += 0.28;
  if (hasName) signup += 0.12;
  if (hasUsername) signup += 0.08;
  if (hasPhone) signup += 0.08;
  if (hasTerms) signup += 0.1;
  if (fields.length >= 2) signup += 0.06;
  if (fields.length >= 4) signup += 0.08;
  if (fields.length >= 6) signup += 0.05;
  // Progressive single-step: email/phone + continue (no password yet)
  if (hasEmail && !hasPassword && fields.length <= 3) signup += 0.12;
  // Form text hints
  try {
    const text =
      `${safeId(form)} ${form.className} ${(form as HTMLFormElement).action || form.getAttribute('action') || ''} ${form.getAttribute('aria-label') || ''}`.toLowerCase();
    if (/sign.?up|register|create.?account|join|welcome/.test(text)) signup += 0.12;
    if (/login|sign.?in|auth/.test(text) && !hasPassword && !hasEmail) signup -= 0.1;
  } catch {
    /* ignore */
  }
  signup = Math.max(0, Math.min(1, signup));

  return {
    domain,
    fields,
    signupLikelihood: signup,
    hasEmail,
    hasPassword,
    hasTerms,
    scoredAt: Date.now(),
  };
}

export function uniqueFieldKinds(score: FormScore): FormFieldKind[] {
  return [...new Set(score.fields.map((f) => f.kind))];
}
