/**
 * Generic submit / continue button detection + click.
 * No site hardcoding - multi-language action labels.
 */

import { logError } from '@/utils/logger.js';
import { detectSignupPage } from './signup-page.js';
import type { SignupAttemptRef, SignupProgress } from './signup-state.js';

/** Resolve explicit auto-submit consent; a read failure is always denied. */
export async function hasAutoSubmitConsent(
  loadSettings: () => Promise<{ autoClickSubmitButtons?: unknown }> = async () => {
    const { loadSmartAutofillSettings } = await import('./smart-settings.js');
    return loadSmartAutofillSettings();
  }
): Promise<boolean> {
  try {
    return (await loadSettings()).autoClickSubmitButtons === true;
  } catch (error) {
    logError('Could not verify auto-submit preference; submit skipped', error);
    return false;
  }
}

/** Words that indicate primary form action (signup / continue / login). */
const ACTION_RE =
  /\b(sign\s*up|signup|register|create(\s+(an?|your|my))?\s+account|join(\s+now)?|get\s+started|continue|next|submit|log\s*in|login|sign\s*in|signin|verify|confirm|send(\s+code)?|proceed|finish|done|s'inscrire|créer|inscrire|registrieren|konto\s+erstellen|registrarse|crear\s+cuenta|cadastrar|登録|サインアップ|创建账户|注册|สมัคร|ลงทะเบียน|إنشاء|تسجيل|متابعة|suivant|weiter|siguiente|次へ|下一步|ถัดไป)\b/i;

const NEGATIVE_RE =
  /\b(cancel|close|back|previous|forgot|reset\s*password|google|facebook|apple|github|twitter|microsoft|sso|oauth|skip|later|maybe)\b/i;

function visible(el: HTMLElement): boolean {
  try {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    return true;
  } catch {
    /* ignore */
    return false;
  }
}

function controlLabel(el: HTMLElement): string {
  const parts = [
    el.getAttribute('aria-label') || '',
    el.getAttribute('value') || '',
    el.getAttribute('title') || '',
    (el as HTMLInputElement).value || '',
    el.textContent || '',
  ];
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Find the best Continue / Sign up / Log in control near a form (or page).
 */
export function findPrimaryActionButton(
  form?: HTMLFormElement | HTMLElement | null
): HTMLElement | null {
  const roots: ParentNode[] = [];
  if (form) {
    roots.push(form);
    // A native form also owns controls explicitly linked through `form=`.
    if (form instanceof HTMLFormElement && form.id) {
      roots.push(form.ownerDocument);
    }
  } else if (typeof document !== 'undefined') roots.push(document);

  type Cand = { el: HTMLElement; score: number };
  const cands: Cand[] = [];

  const selector =
    'button, input[type="submit"], input[type="button"], [role="button"], a[href], a.button, a[class*="btn" i]';

  for (const root of roots) {
    let nodes: Element[];
    try {
      nodes = Array.from(root.querySelectorAll(selector));
    } catch {
      /* ignore */
      continue;
    }
    for (const n of nodes) {
      if (!(n instanceof HTMLElement)) continue;
      if (
        form &&
        !form.contains(n) &&
        !(
          form instanceof HTMLFormElement &&
          (n instanceof HTMLButtonElement || n instanceof HTMLInputElement) &&
          n.form === form
        )
      )
        continue;
      if (!visible(n)) continue;
      if ((n as HTMLButtonElement).disabled) continue;
      const label = controlLabel(n);
      if (!label || label.length > 80) continue;
      if (NEGATIVE_RE.test(label)) continue;
      if (!ACTION_RE.test(label)) continue;

      let score = 10;
      if (/sign\s*up|register|create.*account|登録|注册|สมัคร|إنشاء/i.test(label)) score += 40;
      if (/continue|next|suivant|weiter|siguiente|次へ|下一步|ถัดไป|متابعة/i.test(label))
        score += 30;
      if (/log\s*in|sign\s*in|login|signin/i.test(label)) score += 20;
      if (n.tagName === 'BUTTON' || (n as HTMLInputElement).type === 'submit') score += 8;
      if (form?.contains(n)) score += 15;
      // Prefer primary-looking classes
      const cls = (n.className || '').toString().toLowerCase();
      if (/primary|submit|cta|btn-primary|contained/.test(cls)) score += 12;

      cands.push({ el: n, score });
    }
  }

  // Also native form submit without visible/action text. This fallback must
  // apply the SAME negative-label guard as the main selector: otherwise a
  // formless React SPA whose real action has no readable label could fall
  // through to the first `button[type="submit"]`, which may be a Back step
  // button - and the auto-click would press Back instead of Continue.
  if (form) {
    const natives = form.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      'input[type="submit"], button[type="submit"]'
    );
    for (const native of Array.from(natives)) {
      if (!visible(native) || native.disabled) continue;
      if (NEGATIVE_RE.test(controlLabel(native))) continue;
      cands.push({ el: native, score: 25 });
      break;
    }
  }

  cands.sort((a, b) => b.score - a.score);
  return cands[0]?.el || null;
}

/** Click primary action after autofill (best-effort). Returns true if clicked. */
export function clickPrimaryAction(form?: HTMLFormElement | HTMLElement | null): boolean {
  const btn = findPrimaryActionButton(form);
  if (!btn) return false;
  if (form && !isSignupScopeValid(form)) return false;
  try {
    btn.focus?.();
    btn.click();
    return true;
  } catch {
    /* ignore */
    try {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch {
      /* ignore */
      return false;
    }
  }
}

/**
 * Arm success detection only after a real submit/continue click.
 * Call after autofill; marks credential when success follows a user/auto click.
 */
export function armSignupOutcomeAfterSubmit(
  attempt: SignupAttemptRef,
  form: HTMLFormElement | HTMLElement | null,
  opts?: {
    autoClick?: boolean;
  }
): () => void {
  activeSignupWatcher?.();
  let stopped = false;
  let submitted = attempt.submitted;
  let reporting = false;
  const reported = new Set<SignupProgress>();
  const baseline = submitted ? null : detectSignupPage();
  const eventRoot = form || document;
  let autoClickTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => void tick());
  const interval = setInterval(() => {
    if (!document.hidden) void tick();
  }, 1500);
  const deadline = setTimeout(() => stop(), Math.max(0, attempt.expiresAt - Date.now()));
  const stop = () => {
    if (stopped) return;
    stopped = true;
    eventRoot.removeEventListener('click', onClick, true);
    eventRoot.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', stop);
    if (autoClickTimer) clearTimeout(autoClickTimer);
    clearTimeout(deadline);
    clearInterval(interval);
    observer.disconnect();
    if (activeSignupWatcher === stop) {
      activeSignupWatcher = null;
      activeSignupAttemptId = null;
      activeSignupScope = null;
    }
  };
  async function report(progress: SignupProgress): Promise<boolean> {
    if (reported.has(progress)) return true;
    const { reportSignupProgressViaBg } = await import('@/utils/content/content-bg-bridge.js');
    const ok = await reportSignupProgressViaBg(attempt.id, progress);
    if (ok) reported.add(progress);
    return ok;
  }
  async function tick(): Promise<void> {
    if (stopped || !submitted || reporting) return;
    reporting = true;
    try {
      const evidence = detectSignupPage();
      if (evidence.failed) {
        await report('failed');
        return;
      }
      if (evidence.emailVerification === 'pending') await report('verification_pending');
      if (evidence.accountCreated && !baseline?.accountCreated) await report('created');
      if (
        evidence.emailVerification === 'confirmed' &&
        baseline?.emailVerification !== 'confirmed'
      ) {
        if (await report('email_confirmed')) stop();
      }
    } catch (error) {
      logError('Signup outcome tracking failed', error);
    } finally {
      reporting = false;
    }
  }
  const markSubmitted = async () => {
    if (stopped || submitted || reporting) return;
    reporting = true;
    try {
      submitted = await report('submitted');
    } catch (error) {
      logError('Signup submission tracking failed', error);
    } finally {
      reporting = false;
    }
    void tick();
  };
  const onClick = (e: Event) => {
    if (stopped || submitted || !e.isTrusted || !form || !isSignupScopeValid(form)) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    const btn = t.closest(
      'button, input[type="submit"], input[type="button"], [role="button"], a'
    ) as HTMLElement | null;
    if (!btn || !form.contains(btn)) return;
    // Native submit fires only after browser constraint validation. Never
    // mistake an invalid button click for a submitted request.
    if (
      form instanceof HTMLFormElement &&
      (btn instanceof HTMLButtonElement || btn instanceof HTMLInputElement) &&
      btn.type === 'submit'
    )
      return;
    const label = controlLabel(btn);
    if (!NEGATIVE_RE.test(label) && ACTION_RE.test(label)) void markSubmitted();
  };
  const onSubmit = (e: Event) => {
    const submitter = (e as SubmitEvent).submitter;
    if (submitter && NEGATIVE_RE.test(controlLabel(submitter))) return;
    if (e.isTrusted && e.target === form && form && isSignupScopeValid(form)) void markSubmitted();
  };
  const onVisibility = () => {
    if (!document.hidden) void tick();
  };
  eventRoot.addEventListener('click', onClick, true);
  eventRoot.addEventListener('submit', onSubmit, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', stop);
  if (document.body)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'class', 'style', 'aria-hidden'],
    });
  if (opts?.autoClick === true) {
    autoClickTimer = setTimeout(async () => {
      if (stopped || submitted || !form || !(await hasAutoSubmitConsent())) return;
      if (stopped || submitted || !isSignupScopeValid(form)) return;
      // This one extension-initiated click has explicit consent. Synthetic
      // clicks elsewhere never authorize an attempt.
      if (clickPrimaryAction(form)) void markSubmitted();
    }, 280);
  }
  activeSignupWatcher = stop;
  activeSignupAttemptId = attempt.id;
  activeSignupScope = form;
  void tick();
  return stop;
}

// One watcher per document; replaced on a new fill and released on pagehide/TTL.
let activeSignupWatcher: (() => void) | null = null;
let activeSignupAttemptId: string | null = null;
let activeSignupScope: HTMLElement | null = null;

export function isSignupScopeValid(scope: HTMLElement): boolean {
  if (scope instanceof HTMLFormElement) return scope.checkValidity();
  return Array.from(
    scope.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input,select,textarea'
    )
  ).every((input) => !input.willValidate || input.checkValidity());
}

export async function resumeSignupOutcome(form: HTMLElement | null = null): Promise<void> {
  const { getSignupAttemptViaBg } = await import('@/utils/content/content-bg-bridge.js');
  const attempt = await getSignupAttemptViaBg();
  if (attempt?.id === activeSignupAttemptId && (!form || form === activeSignupScope)) return;
  if (attempt && attempt.expiresAt > Date.now()) armSignupOutcomeAfterSubmit(attempt, form);
}
