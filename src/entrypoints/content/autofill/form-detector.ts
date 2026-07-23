/**
 * Signup form detection — light DOM + open shadow roots (closed shadows remain opaque).
 * Scores candidate forms so SPA re-renders pick the best signup form.
 */

function isEmailish(input: HTMLInputElement): boolean {
  const name = (input.name || '').toLowerCase();
  const id = (input.id || '').toLowerCase();
  const ph = (input.placeholder || '').toLowerCase();
  const ac = (input.getAttribute('autocomplete') || '').toLowerCase();
  return (
    input.type === 'email' ||
    ac === 'email' ||
    ac.includes('email') ||
    name.includes('email') ||
    id.includes('email') ||
    ph.includes('email') ||
    name.includes('e-mail') ||
    id.includes('e-mail')
  );
}

function isPasswordish(input: HTMLInputElement): boolean {
  const name = (input.name || '').toLowerCase();
  const id = (input.id || '').toLowerCase();
  const ac = (input.getAttribute('autocomplete') || '').toLowerCase();
  return (
    input.type === 'password' ||
    ac === 'new-password' ||
    ac === 'current-password' ||
    name.includes('password') ||
    id.includes('password')
  );
}

function collectForms(root: Document | ShadowRoot | Element): HTMLFormElement[] {
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

function scoreForm(form: HTMLFormElement): number {
  let score = 0;
  const formText = (form.textContent || '').toLowerCase().slice(0, 4000);
  const action = (form.getAttribute('action') || '').toLowerCase();
  const formClasses = (form.getAttribute('class') || '').toLowerCase();
  const id = (form.id || '').toLowerCase();

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
  if (hasSignupHint) score += 40;
  if (formText.includes('subscribe') || formText.includes('newsletter')) score += 15;
  // Login-only forms: suppress Autofill All (still may get field icons via lower threshold)
  if (hasLoginHint && !hasSignupHint) score -= 45;

  const inputs = Array.from(form.querySelectorAll('input')) as HTMLInputElement[];
  const visible = inputs.filter((i) => {
    if (i.type === 'hidden' || i.disabled) return false;
    try {
      const r = i.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch {
      return true;
    }
  });

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
 * Also consider loose field groups without a <form> (common in React SPAs).
 * We wrap conceptually by returning the nearest form ancestor of the best email field,
 * or null if no form — caller uses document-scoped fill.
 */
function findLooseSignupContainer(): HTMLFormElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i]'
    )
  ).filter((el) => {
    try {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled;
    } catch {
      return false;
    }
  });

  for (const email of candidates) {
    const form = email.closest('form');
    if (form) continue; // already covered by form walk
    // Look for password sibling in parent chain
    let parent: HTMLElement | null = email.parentElement;
    for (let depth = 0; depth < 8 && parent; depth++) {
      const pw = parent.querySelector<HTMLInputElement>(
        'input[type="password"], input[autocomplete="new-password"], input[name*="password" i]'
      );
      if (pw) {
        // Create a synthetic form? We cannot invent form elements safely.
        // Return null and let inject use document-level field scan via first email's root.
        // Prefer nearest form if any ancestor later gains one.
        break;
      }
      parent = parent.parentElement;
    }
  }
  return null;
}

/** Public score for Autofill All gating */
export function scoreSignupForm(form: HTMLFormElement): number {
  return scoreForm(form);
}

/**
 * Find best form. Default minScore 55 = Autofill All (signup only).
 * Pass ~30 for field-icon injection on broader email forms.
 */
export async function findSignupForm(minScore = 55): Promise<HTMLFormElement | null> {
  const forms = collectForms(document);
  if (forms.length === 0) {
    findLooseSignupContainer();
    return null;
  }

  let best: HTMLFormElement | null = null;
  let bestScore = 0;

  for (const form of forms) {
    const s = scoreForm(form);
    if (s > bestScore) {
      bestScore = s;
      best = form;
    }
  }

  if (best && bestScore >= minScore) return best;

  // Fallbacks only when minScore is low (field icons)
  if (minScore <= 35) {
    for (const form of forms) {
      const inputs = Array.from(form.querySelectorAll('input')) as HTMLInputElement[];
      if (inputs.some(isEmailish) && inputs.some(isPasswordish)) return form;
    }
    for (const form of forms) {
      const inputs = Array.from(form.querySelectorAll('input')) as HTMLInputElement[];
      if (inputs.some(isEmailish)) return form;
    }
  }

  return null;
}
