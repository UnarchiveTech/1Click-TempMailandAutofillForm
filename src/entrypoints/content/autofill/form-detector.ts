/**
 * Signup form detection - light DOM + open shadow roots (closed shadows remain opaque).
 * Scores candidate forms so SPA re-renders pick the best signup form.
 * Also pierces same-origin iframes via collectFormsDeep.
 */

import { collectFormsDeep, collectInputsDeep } from '@/features/intelligence/dom-pierce.js';
import {
  safeAccessibleName,
  safeId,
  safeName,
  safePlaceholder,
} from '@/utils/security/dom-safe.js';

export type FormPageType = 'signup' | 'login' | 'unknown';

export function detectPageFormType(): FormPageType {
  try {
    const pageText = (document.body?.textContent || '').toLowerCase();
    const isSignup = /\b(create account|sign up|register|get started|free trial|join now)\b/i.test(
      pageText
    );
    const isLogin = /\b(log in|sign in|welcome back|enter password)\b/i.test(pageText);

    if (isSignup && !isLogin) return 'signup';
    if (isLogin && !isSignup) return 'login';
  } catch {
    /* ignore */
  }
  return 'unknown';
}

/**
 * Find "Continue with email", "Skip", "Not now", "Maybe later" buttons.
 * Prefers email options over phone options, and skip options over optional PII requests.
 */
export function findLowPiiChoiceOrSkipButton(
  root: Document | ShadowRoot | Element = document
): HTMLElement | null {
  try {
    const clickable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, a, [role="button"], input[type="button"], input[type="submit"]'
      )
    );

    // Priority 1: Skip / Not now / Maybe later
    const skipRe =
      /\b(skip|not now|maybe later|skip for now|do this later|no thanks|لاحقًا|إتخطي|pas maintenant|más tarde|スキップ|跳过)\b/i;
    for (const el of clickable) {
      const text = (
        el.textContent ||
        el.getAttribute('aria-label') ||
        (el as HTMLInputElement).value ||
        ''
      ).trim();
      if (skipRe.test(text)) return el;
    }

    // Priority 2: Continue with email (over phone)
    const emailChoiceRe =
      /\b(continue\s+with\s+email|use\s+email|sign\s+up\s+with\s+email|email\s+instead|by\s+email)\b/i;
    for (const el of clickable) {
      const text = (
        el.textContent ||
        el.getAttribute('aria-label') ||
        (el as HTMLInputElement).value ||
        ''
      ).trim();
      if (emailChoiceRe.test(text)) return el;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function isEmailish(input: HTMLInputElement): boolean {
  const name = safeName(input).toLowerCase();
  const id = safeId(input).toLowerCase();
  const ph = safePlaceholder(input).toLowerCase();
  const ac = (input.getAttribute('autocomplete') || '').toLowerCase();
  const aria = safeAccessibleName(input).toLowerCase();
  const blob = `${name} ${id} ${ph} ${ac} ${aria}`;

  // Demote "confirm email" / "repeat email" / "verify email" fields - these are
  // secondary confirmation inputs, not the primary email field to autofill.
  const CONFIRM_EMAIL_RE =
    /\b(confirm|repeat|retype|verify|re-?enter|re-?type)\b.*\bemail\b|\bemail\b.*\b(confirm|repeat|retype|verify|re-?enter|re-?type)\b/i;
  if (CONFIRM_EMAIL_RE.test(blob)) return false;

  // Dual email/phone (Canva etc.) → treat as email-capable entry
  if (
    /(email|e-mail|correo|courriel|メール|邮箱).{0,16}(or|\/|ou|oder|または|或).{0,16}(phone|mobile|tel)/i.test(
      blob
    ) ||
    /(phone|mobile|tel).{0,16}(or|\/|ou|oder).{0,16}(email|e-mail)/i.test(blob)
  ) {
    return true;
  }
  return (
    input.type === 'email' ||
    ac === 'email' ||
    ac.includes('email') ||
    name.includes('email') ||
    id.includes('email') ||
    ph.includes('email') ||
    name.includes('e-mail') ||
    id.includes('e-mail') ||
    /correo|courriel|メール|邮箱|بريد/.test(blob)
  );
}

function isPasswordish(input: HTMLInputElement): boolean {
  const name = safeName(input).toLowerCase();
  const id = safeId(input).toLowerCase();
  const ac = (input.getAttribute('autocomplete') || '').toLowerCase();
  const a11y = safeAccessibleName(input).toLowerCase();
  return (
    input.type === 'password' ||
    ac === 'new-password' ||
    ac === 'current-password' ||
    name.includes('password') ||
    id.includes('password') ||
    a11y.includes('password')
  );
}

/** A field in a hidden dialog is not an available autofill destination. */
function isAvailableInput(input: HTMLInputElement): boolean {
  if (input.disabled || input.readOnly || input.type === 'hidden' || input.type === 'search')
    return false;
  if (input.getAttribute('role') === 'searchbox' || input.closest('[role="search"]')) return false;
  try {
    let ancestor: Element | null = input;
    const view = input.ownerDocument.defaultView;
    if (!view) return false;
    while (ancestor) {
      const style = view.getComputedStyle(ancestor);
      if (
        ancestor.hasAttribute('hidden') ||
        ancestor.hasAttribute('inert') ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0'
      )
        return false;
      const root = ancestor.getRootNode();
      ancestor = ancestor.parentElement || (root instanceof ShadowRoot ? root.host : null);
    }
    const rect = input.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  } catch {
    return false;
  }
}

function availableInputs(root: HTMLElement): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input')).filter(isAvailableInput);
}

function isProfileInput(input: HTMLInputElement): boolean {
  if (isEmailish(input) || isPasswordish(input) || input.type === 'tel') return true;
  const hints = `${safeName(input)} ${safeId(input)} ${safePlaceholder(input)} ${safeAccessibleName(input)} ${input.autocomplete}`;
  return /\b(username|first.?name|last.?name|full.?name|given-name|family-name|one-time-code|otp|phone|mobile|address|street|postal|zip|birth|dob)\b/i.test(
    hints
  );
}

function collectForms(root: Document | ShadowRoot | Element): HTMLFormElement[] {
  if (root instanceof Document) {
    // With allFrames enabled the content script runs in every frame, so only
    // forms of the CURRENT document are handled here - iframe forms are
    // injected by the iframe's own instance (correctly positioned). Filtering
    // here prevents the top frame from picking up iframe forms and placing
    // buttons at wrong (iframe-relative) coordinates.
    return collectFormsDeep(root).filter((form) => form.ownerDocument === root);
  }
  const out: HTMLFormElement[] = [];
  try {
    out.push(...Array.from(root.querySelectorAll('form')));
  } catch {
    /* ignore */
  }
  // Open shadow roots only (closed cannot be pierced from content script)
  try {
    const all = root.querySelectorAll('*');
    for (const el of Array.from(all)) {
      const sr = (el as HTMLElement).shadowRoot;
      if (sr) out.push(...collectForms(sr));
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Text from headings / labels only - exclude buttons/submits (they often say "Create account"). */
function headingAndLabelText(form: HTMLFormElement): string {
  const parts: string[] = [];
  try {
    const nodes = form.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, legend, label, [role="heading"], p, span, div'
    );
    for (const el of Array.from(nodes)) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.closest('button, input, select, textarea, a[role="button"], [role="button"]'))
        continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'button' || tag === 'input' || tag === 'a') continue;
      // Prefer leaf-ish short text nodes
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 100) continue;
      // Skip if element itself is clickable control
      if (el.getAttribute('role') === 'button') continue;
      parts.push(text.toLowerCase());
      if (parts.join(' ').length > 2500) break;
    }
  } catch {
    /* ignore */
  }
  // Also check siblings immediately before the form (page title)
  try {
    let sib: Element | null = form.previousElementSibling;
    for (let i = 0; i < 4 && sib; i++) {
      if (sib instanceof HTMLElement && !sib.closest?.('button')) {
        const t = (sib.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (t && t.length < 120) parts.push(t);
      }
      sib = sib.previousElementSibling;
    }
  } catch {
    /* ignore */
  }
  return parts.join(' ');
}

function scoreForm(form: HTMLFormElement): number {
  const visible = availableInputs(form);
  // Marketing headings and submit buttons cannot turn a search/contact shell
  // with no available profile fields into a signup form.
  if (!visible.some(isProfileInput)) return 0;
  let score = 0;
  // Prefer heading/label text so submit buttons ("Create account") do not fake signup signals alone
  const headingText = headingAndLabelText(form);
  const formText = headingText || (form.textContent || '').toLowerCase().slice(0, 4000);
  const action = (form.getAttribute('action') || '').toLowerCase();
  const formClasses = (form.getAttribute('class') || '').toLowerCase();
  const id = safeId(form).toLowerCase();

  const signupHints = [
    'sign up',
    'signup',
    'register',
    'create account',
    'create your account',
    'join',
    'get started',
    'free account',
    'create free',
  ];
  const loginHints = [
    'log in',
    'login',
    'sign in',
    'signin',
    'welcome back',
    'already have an account',
  ];
  const hasSignupHint = signupHints.some(
    (h) => formText.includes(h) || action.includes(h) || formClasses.includes(h) || id.includes(h)
  );
  const hasLoginHint = loginHints.some(
    (h) => formText.includes(h) || action.includes(h) || formClasses.includes(h) || id.includes(h)
  );
  // Strong boost only when signup wording appears in headings/labels (not only in buttons)
  if (hasSignupHint && headingText) score += 50;
  else if (hasSignupHint) score += 25;
  if (formText.includes('subscribe') || formText.includes('newsletter')) score += 15;
  // Login-only forms: suppress Autofill All (still may get field icons via lower threshold)
  if (hasLoginHint && !hasSignupHint) score -= 45;
  // Require email+password OR explicit signup heading for Autofill All threshold (~55)
  if (!hasSignupHint && headingText && !signupHints.some((h) => headingText.includes(h))) {
    // no extra penalty - field mix still scores below
  }

  const hasEmail = visible.some(isEmailish);
  const hasPassword = visible.some(isPasswordish);
  const passwordFields = visible.filter(isPasswordish);
  const hasConfirmPassword = passwordFields.length >= 2;
  if (hasEmail) score += 30;
  if (hasPassword) score += 25;
  if (hasEmail && hasPassword) score += 20;
  if (hasConfirmPassword) score += 25; // strong signup signal
  // Single password + login autocomplete → likely login
  const acList = visible.map((i) => (i.getAttribute('autocomplete') || '').toLowerCase());
  if (acList.includes('current-password') && !acList.includes('new-password') && !hasSignupHint) {
    score -= 40;
  }

  const hasSubmit = !!form.querySelector(
    'button[type="submit"], input[type="submit"], button:not([type]), [role="button"]'
  );
  if (hasSubmit) score += 10;

  // Prefer larger forms (more fields = more likely full signup)
  score += Math.min(15, visible.length * 2);

  // Strong signup signals: address / country / DOB / zip (RunSignup-class forms)
  const hasAddress = visible.some((i) => {
    const m = `${safeName(i)} ${safeId(i)} ${safePlaceholder(i)}`.toLowerCase();
    return /address|street|zip|postal|city|country|dob|birth/.test(m);
  });
  const hasCountrySelect = !!form.querySelector(
    'select[name*="country" i], select[id*="country" i]'
  );
  if (hasAddress) score += 25;
  if (hasCountrySelect) score += 15;
  if (visible.length >= 8) score += 20;
  // Login form is usually 2-3 fields
  if (visible.length <= 3 && hasPassword && !hasConfirmPassword && !hasSignupHint) score -= 20;

  // Progressive multi-step (email/phone only + continue) - Canva-style, any site
  const hasContinue =
    !!form.querySelector('button, input[type="submit"], [role="button"]') &&
    /continue|next|sign\s*up|log\s*in|sign\s*in|verify|submit|get\s+started|join|登録|登录|登錄|다음|ถัดไป|متابعة|suivant|weiter|siguiente/i.test(
      (form.textContent || '').slice(0, 1500)
    );
  if (hasEmail && !hasPassword && visible.length <= 4 && hasContinue) {
    score += 45; // enough for Autofill All threshold when progressive
  }
  if (hasEmail && !hasPassword && hasSignupHint) score += 20;

  // Reject tiny / invisible forms
  try {
    const r = form.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) score -= 50;
  } catch {
    /* ignore */
  }

  return score;
}

/**
 * Progressive SPA: email/phone field + continue outside a <form>.
 * Returns a container element to use as the fill root (not always HTMLFormElement).
 */
export function findProgressiveAuthContainer(): HTMLElement | null {
  // Step fields: email/phone, name, OTP - multi-step SPA auth without <form>
  const allInputs = collectInputsDeep(document).filter((el) => el.ownerDocument === document);
  const stepInputs = allInputs.filter((el) => {
    if (el.tagName !== 'INPUT') return false;
    const type = el.getAttribute('type');
    const autocomplete = el.getAttribute('autocomplete');
    const name = safeName(el).toLowerCase();
    const id = safeId(el).toLowerCase();
    const placeholder = safePlaceholder(el).toLowerCase();
    const a11y = safeAccessibleName(el).toLowerCase();

    const isEmailLike =
      type === 'email' ||
      autocomplete === 'email' ||
      name.includes('email') ||
      id.includes('email') ||
      placeholder.includes('email') ||
      a11y.includes('email');
    const isPhoneLike =
      type === 'tel' ||
      autocomplete === 'tel' ||
      placeholder.includes('phone') ||
      placeholder.includes('mobile') ||
      a11y.includes('phone') ||
      a11y.includes('mobile');
    const isNameLike =
      autocomplete === 'name' ||
      autocomplete === 'given-name' ||
      (name.includes('first') && name.includes('name')) ||
      placeholder.includes('first name') ||
      placeholder.includes('full name') ||
      a11y.includes('first name') ||
      a11y.includes('full name') ||
      a11y.includes('your name');
    const isOtpLike =
      name.includes('otp') ||
      autocomplete === 'one-time-code' ||
      (el.getAttribute('inputmode') === 'numeric' && el.getAttribute('maxlength') === '1') ||
      a11y.includes('code');
    const isPasswordLike =
      type === 'password' ||
      autocomplete === 'new-password' ||
      autocomplete === 'current-password' ||
      a11y.includes('password');

    return isEmailLike || isPhoneLike || isNameLike || isOtpLike || isPasswordLike;
  }) as HTMLInputElement[];

  const filteredStepInputs = stepInputs.filter(isAvailableInput);

  let best: HTMLElement | null = null;
  let bestScore = 0;

  for (const field of filteredStepInputs) {
    // Prefer containers that look like auth steps
    let parent: HTMLElement | null = field.parentElement;
    for (let d = 0; d < 12 && parent; d++) {
      if (parent === document.body || parent === document.documentElement) {
        parent = parent.parentElement;
        continue;
      }
      const text = (parent.textContent || '').toLowerCase().slice(0, 2500);
      // A password field only seeds a progressive step when the container
      // clearly asks the user to CREATE a new password (signup/reset), not to
      // ENTER one (login). Otherwise a 2-step login's password screen would
      // get an Autofill All pill that overwrites the real password.
      const isPasswordSeed = field.type === 'password';
      const passwordCreation =
        /(create|set|choose|pick|make)\s+(a\s+|an\s+|your\s+|new\s+)?(password|passcode)|new\s+password/i.test(
          text
        );
      const signupContext = /sign\s*up|register|create\s+account|join|get\s+started/i.test(text);
      const hasContinue = Array.from(
        parent.querySelectorAll('button, [role="button"], input[type="submit"], a[class*="btn" i]')
      ).some((b) => {
        const t = `${(b as HTMLElement).textContent || ''} ${(b as HTMLElement).getAttribute('aria-label') || ''} ${(b as HTMLElement).getAttribute('value') || ''}`;
        return /continue|next|sign\s*up|log\s*in|sign\s*in|verify|submit|get\s+started|join|create|send|confirm|登録|登录|다음|ถัดไป|suivant|weiter|siguiente|متابعة|créer|registr/i.test(
          t
        );
      });
      const looksAuth =
        /sign\s*up|log\s*in|sign\s*in|register|email|phone|continue|welcome|create|account|verify|code|otp|one.?time|name|join|get\s+started/i.test(
          text
        ) || hasContinue;
      const inputCount = availableInputs(parent).filter(
        (input) => input.type !== 'submit' && input.type !== 'button'
      ).length;
      // Reasonable dialog/panel size (not whole page)
      let areaOk = true;
      try {
        const r = parent.getBoundingClientRect();
        areaOk = r.width > 120 && r.height > 40 && r.width < window.innerWidth * 0.98;
      } catch {
        /* ignore */
      }
      if (
        (!isPasswordSeed || passwordCreation || signupContext) &&
        hasContinue &&
        looksAuth &&
        areaOk &&
        inputCount >= 1 &&
        inputCount <= 20
      ) {
        let score = 40 + Math.min(inputCount * 5, 30);
        if (/sign\s*up|register|create.?account|join|get\s+started/i.test(text)) score += 20;
        if (/email|phone|mobile/i.test(text)) score += 10;
        if (hasContinue) score += 15;
        // Prefer tighter containers
        score += Math.max(0, 12 - d);
        if (score > bestScore) {
          bestScore = score;
          best = parent;
        }
      }
      parent = parent.parentElement;
    }
  }
  return best;
}

/**
 * Also consider loose field groups without a <form> (common in React SPAs).
 * We wrap conceptually by returning the nearest form ancestor of the best email field,
 * or null if no form - caller uses document-scoped fill.
 */

/** Public score for Autofill All gating */
export function scoreSignupForm(form: HTMLFormElement | HTMLElement): number {
  if (form instanceof HTMLFormElement) return scoreForm(form);
  // Progressive container: estimate like a light form
  try {
    const fake = form as unknown as HTMLFormElement;
    // scoreForm uses form.querySelectorAll - works on HTMLElement too
    return scoreForm(fake);
  } catch {
    /* ignore */
    return 40;
  }
}

/**
 * Micro classification for reuse vs generate.
 * Sign-in: login wording, single password, current-password autocomplete, no confirm password.
 * Sign-up: create/register wording, confirm password, name fields, new-password.
 */
export function classifyFormIntent(
  form: HTMLFormElement
): 'signup' | 'signin' | 'mixed' | 'unknown' {
  const score = scoreForm(form);
  const heading = headingAndLabelText(form);
  const formText = heading || (form.textContent || '').toLowerCase().slice(0, 3000);
  const action = (form.getAttribute('action') || '').toLowerCase();
  const id = safeId(form).toLowerCase();
  const classes = (form.getAttribute('class') || '').toLowerCase();
  const hay = `${formText} ${action} ${id} ${classes}`;

  const signupHints = [
    'sign up',
    'signup',
    'register',
    'create account',
    'create your account',
    'join now',
    'get started',
    'free account',
    'create free',
    'start free',
  ];
  const loginHints = [
    'log in',
    'login',
    'sign in',
    'signin',
    'welcome back',
    'already have an account',
    'forgot password',
    'remember me',
  ];

  const signupHit = signupHints.some((h) => hay.includes(h));
  const loginHit = loginHints.some((h) => hay.includes(h));

  const visible = availableInputs(form);
  const passwords = visible.filter(isPasswordish);
  const acList = visible.map((i) => (i.getAttribute('autocomplete') || '').toLowerCase());
  const hasNewPw = acList.includes('new-password') || passwords.length >= 2;
  const hasCurrentPw = acList.includes('current-password');
  const hasName = visible.some((i) => {
    const m = `${safeName(i)} ${safeId(i)} ${safePlaceholder(i)}`.toLowerCase();
    return /first.?name|last.?name|full.?name|given-name|family-name/.test(m);
  });

  // Strong signin signals first: login wording or a current-password field
  // wins over password-count heuristics (a "Sign in" page with a confirm
  // field, or a current-password change form, is not a signup).
  // NB: loginHit alone does NOT win when the page also has signup wording
  // ("Already have an account? Log in" links live inside signup forms).
  if ((loginHit && !signupHit) || (hasCurrentPw && !hasNewPw && passwords.length === 1)) {
    return 'signin';
  }
  // Strong signup signals (confirm password beats generic login wording)
  if (hasNewPw || passwords.length >= 2 || (signupHit && !loginHit) || (signupHit && hasName)) {
    return 'signup';
  }
  if (loginHit && passwords.length === 1 && !hasName) return 'signin';
  if (signupHit && loginHit) return 'mixed';
  if (score >= 55) return 'signup';
  if (passwords.length === 1 && visible.some(isEmailish) && !hasName) return 'signin';
  return 'unknown';
}

/** True when form is primarily a login/sign-in surface (reuse identity OK). */
export function isSigninForm(form: HTMLFormElement): boolean {
  return classifyFormIntent(form) === 'signin';
}

/** True when form is primarily signup/register (generate, not reuse). */
export function isSignupForm(form: HTMLFormElement): boolean {
  const intent = classifyFormIntent(form);
  return intent === 'signup' || (intent === 'mixed' && scoreForm(form) >= 50);
}

/**
 * Find best form or progressive auth container.
 * Default minScore 55 = Autofill All; ~30 for field icons.
 * Returns HTMLFormElement or a non-form container (SPA multi-step).
 */
export async function findSignupForm(minScore = 55): Promise<HTMLFormElement | HTMLElement | null> {
  const forms = collectForms(document);

  let best: HTMLFormElement | HTMLElement | null = null;
  let bestScore = 0;

  for (const form of forms) {
    const s = scoreForm(form);
    if (s > bestScore) {
      bestScore = s;
      best = form;
    }
  }

  // Progressive SPA containers (no <form> or weak form score)
  const progressive = findProgressiveAuthContainer();
  if (progressive) {
    const ps = scoreSignupForm(progressive);
    if (ps > bestScore) {
      bestScore = ps;
      best = progressive;
    }
  }

  if (best && bestScore >= minScore) return best;

  // Fallbacks only when minScore is low (field icons)
  if (minScore <= 35) {
    for (const form of forms) {
      const inputs = availableInputs(form);
      if (inputs.some(isEmailish) && inputs.some(isPasswordish)) return form;
    }
    for (const form of forms) {
      const inputs = availableInputs(form);
      if (inputs.some(isEmailish)) return form;
    }
    if (progressive) return progressive;
  }

  // Progressive multi-step (email/phone → name → OTP): lower threshold, no site hardcoding
  if (progressive && bestScore >= Math.min(minScore, 35)) return progressive;
  if (progressive && minScore <= 55 && bestScore >= 30) return progressive;

  return null;
}
