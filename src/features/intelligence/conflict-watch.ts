/**
 * Conflict-aware fill - detect "email taken" / disposable blocked after fill
 * and auto-create a fresh inbox when possible.
 */

import {
  createFreshAddressViaBg,
  testConflictTextViaBg,
} from '@/utils/content/content-bg-bridge.js';
import { EMAIL_DOMAIN_REJECTION_RE } from '@/utils/provider/site-email-domains.js';
import { safeId, safeName, safePlaceholder } from '@/utils/security/dom-safe.js';

async function scanVisibleText(
  root: ParentNode,
  conflictType: 'email' | 'username' | 'otp'
): Promise<boolean> {
  try {
    const nodes = root.querySelectorAll(
      '[role="alert"], .error, .invalid, .field-error, [class*="error" i], [class*="invalid" i], [aria-live], .help-block, .form-error, .text-danger, .validation-message, [data-error], small, span, p, div, li, label'
    );
    for (const el of Array.from(nodes).slice(0, 120)) {
      try {
        const r = (el as HTMLElement).getBoundingClientRect?.();
        if (r && (r.width < 4 || r.height < 2)) continue;
      } catch {
        /* ignore */
      }
      const t = (el.textContent || '').trim();
      if (t.length > 3 && t.length < 320) {
        // A different local-part cannot fix a rejected domain. The separate
        // domain observer remembers the exclusion without creating more mailboxes.
        if (conflictType === 'email' && EMAIL_DOMAIN_REJECTION_RE.test(t)) continue;
        const result = await testConflictTextViaBg(t);
        if (result === conflictType) return true;
      }
    }
    // aria-invalid username fields + title/validationMessage + sibling error text
    for (const input of Array.from(
      root.querySelectorAll(
        'input[aria-invalid="true"], input:invalid, input[aria-describedby], [class*="error" i] input, .is-invalid, .field-error input'
      )
    )) {
      if (!(input instanceof HTMLInputElement)) continue;
      const meta =
        `${safeName(input)} ${safeId(input)} ${safePlaceholder(input)} ${input.validationMessage || ''} ${input.title || ''} ${input.getAttribute('aria-label') || ''}`.toLowerCase();
      const described = input.getAttribute('aria-describedby');
      let descText = '';
      if (described) {
        for (const id of described.split(/\s+/)) {
          const node = document.getElementById(id);
          if (node) descText += ` ${node.textContent || ''}`;
        }
      }
      // Sibling / parent error text near the field
      try {
        const parent = input.parentElement;
        if (parent) {
          const err = parent.querySelector(
            '[role="alert"], .error, .invalid, [class*="error" i], [class*="invalid" i], small, span'
          );
          if (err) descText += ` ${err.textContent || ''}`;
        }
      } catch {
        /* ignore */
      }
      const blob = `${meta} ${descText}`.toLowerCase();
      if (conflictType === 'email' && EMAIL_DOMAIN_REJECTION_RE.test(blob)) continue;
      const looksUser = /user|login|handle|nick|account.?name/.test(meta);
      if (looksUser) {
        const r1 = await testConflictTextViaBg(blob);
        if (r1 === conflictType) return true;
        const r2 = await testConflictTextViaBg(input.validationMessage || '');
        if (r2 === conflictType) return true;
      } else {
        const r3 = await testConflictTextViaBg(input.validationMessage || '');
        if (r3 === conflictType) return true;
        const r4 = await testConflictTextViaBg(descText);
        if (r4 === conflictType) return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

export async function pageShowsEmailConflict(root: ParentNode = document): Promise<boolean> {
  return scanVisibleText(root, 'email');
}

export async function pageShowsUsernameConflict(root: ParentNode = document): Promise<boolean> {
  return scanVisibleText(root, 'username');
}

export async function pageShowsOtpFailure(root: ParentNode = document): Promise<boolean> {
  return scanVisibleText(root, 'otp');
}

function watchConflict(
  form: ParentNode,
  test: (root: ParentNode) => Promise<boolean>,
  onConflict: () => void,
  opts?: { timeoutMs?: number }
): () => void {
  const timeoutMs = opts?.timeoutMs ?? 8000;
  let done = false;
  const delayedChecks: Array<ReturnType<typeof setTimeout>> = [];
  const finish = (hit: boolean) => {
    if (done) return;
    done = true;
    observer.disconnect();
    clearTimeout(timer);
    for (const delayedCheck of delayedChecks) clearTimeout(delayedCheck);
    if (hit) onConflict();
  };

  const check = async () => {
    if (done) return;
    const formHit = await test(form);
    if (done) return;
    const documentHit = form !== document ? await test(document) : false;
    if (done) return;
    if (formHit || documentHit) finish(true);
  };

  const observer = new MutationObserver(() => check());
  try {
    const observeTarget =
      form instanceof Document
        ? form.documentElement || document.body
        : form instanceof Element
          ? form
          : document.body;
    observer.observe(observeTarget, { childList: true, subtree: true, characterData: true });
    observer.observe(document.body, { childList: true, subtree: true });
  } catch {
    /* ignore */
  }
  const timer = setTimeout(() => finish(false), timeoutMs);
  // Initial delayed checks (SPA error render)
  delayedChecks.push(
    setTimeout(() => {
      void check();
    }, 400)
  );
  delayedChecks.push(
    setTimeout(() => {
      void check();
    }, 1500)
  );
  delayedChecks.push(
    setTimeout(() => {
      void check();
    }, 3500)
  );

  return () => finish(false);
}

/** Watch briefly for email-taken / disposable blocked messages. */
export function watchEmailConflict(
  form: ParentNode,
  onConflict: () => void,
  opts?: { timeoutMs?: number }
): () => void {
  return watchConflict(form, (root) => pageShowsEmailConflict(root), onConflict, opts);
}

/** Watch for username already taken - regenerate username. */
export function watchUsernameConflict(
  form: ParentNode,
  onConflict: () => void,
  opts?: { timeoutMs?: number }
): () => void {
  return watchConflict(form, (root) => pageShowsUsernameConflict(root), onConflict, opts);
}

/** Watch for OTP verification failure - prompt manual entry. */
export function watchOtpFailure(
  root: ParentNode,
  onFail: () => void,
  opts?: { timeoutMs?: number }
): () => void {
  return watchConflict(root, (r) => pageShowsOtpFailure(r), onFail, {
    timeoutMs: opts?.timeoutMs ?? 15000,
  });
}

export async function createFreshAddress(): Promise<string | null> {
  return createFreshAddressViaBg();
}
