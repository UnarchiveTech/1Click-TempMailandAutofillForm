/**
 * Dry-run preview overlay - show what would be filled before commit.
 */

import { getOrCreateShadowRoot } from '@/entrypoints/content/dom/shadow-dom.js';
import { setupFocusTrap } from '@/utils/ui/focusTrap.js';
import { CONTENT_Z } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';

export type DryRunRow = { label: string; value: string; kind?: string; target?: string };
export type DryRunPreviewAction = 'fill' | 'cancel' | 'change-identity';
export type DryRunCorrections = Partial<Record<string, string>>;

export async function showDryRunPreview(opts: {
  rows: DryRunRow[];
  // Required, not optional: these render in the shadow root injected into the
  // host page, where every other string is keyed. An English default here would
  // be user-visible English in eight locales the moment a caller omits one.
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  changeIdentityLabel?: string;
  correctLabel?: string;
  selectionPrompt?: string;
  form?: HTMLElement;
  /** Security prompts must not silently proceed when the injected UI is unavailable. */
  failIfUnavailable?: boolean;
}): Promise<DryRunPreviewAction | DryRunCorrections> {
  const root = getOrCreateShadowRoot();
  if (!root) return opts.failIfUnavailable ? 'cancel' : 'fill';

  return new Promise((resolve) => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let releaseFocusTrap: (() => void) | null = null;
    let settled = false;
    const backdrop = document.createElement('div');
    // The shadow host deliberately ignores pointer input. Opt the preview in
    // so its buttons and scrim receive real clicks rather than the page behind it.
    // Field-correction mode temporarily turns this back off below.
    backdrop.style.cssText = `
      position:fixed;inset:0;z-index:${CONTENT_Z.popup};pointer-events:auto;
      background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;
      font-family:system-ui,sans-serif;
    `;
    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', opts.title);
    panel.tabIndex = -1;
    panel.style.cssText = `
      background:var(--md-surface,#fff);color:var(--md-on-surface,#1a1c16);
      box-sizing:border-box;border-radius:16px;padding:16px;width:min(360px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;pointer-events:auto;
      box-shadow:0 16px 48px rgba(0,0,0,0.25);border:1px solid var(--md-outline-variant,#c5c8ba);
    `;
    const h = document.createElement('div');
    h.style.cssText = 'font-weight:600;font-size:16px;line-height:24px;margin-bottom:16px;';
    h.textContent = opts.title;
    panel.appendChild(h);
    const interactionStyles = document.createElement('style');
    interactionStyles.textContent = `
      .review-action:hover { background-image:linear-gradient(color-mix(in srgb,var(--review-state-color,var(--md-on-surface,#1a1c16)) 8%,transparent),color-mix(in srgb,var(--review-state-color,var(--md-on-surface,#1a1c16)) 8%,transparent)); }
      .review-action:active { background-image:linear-gradient(color-mix(in srgb,var(--review-state-color,var(--md-on-surface,#1a1c16)) 12%,transparent),color-mix(in srgb,var(--review-state-color,var(--md-on-surface,#1a1c16)) 12%,transparent)); }
      .review-action:focus-visible { outline:2px solid var(--md-primary,#4c662b);outline-offset:2px; }
    `;
    panel.appendChild(interactionStyles);
    let selectingKind: string | null = null;
    const originalOutlines = new Map<HTMLElement, string>();
    const corrections: DryRunCorrections = {};
    let actionsLayout: ReturnType<typeof responsiveButtonLayout> | null = null;
    const prompt = document.createElement('div');
    prompt.style.cssText =
      'display:none;font-size:14px;line-height:20px;margin:0 0 12px;color:var(--md-primary,#4c662b);';
    prompt.setAttribute('role', 'status');
    prompt.textContent = opts.selectionPrompt || '';
    panel.appendChild(prompt);

    const cleanup = () => {
      document.removeEventListener('click', onDocumentClick, true);
      document.removeEventListener('keydown', onKeydown, true);
      releaseFocusTrap?.();
      releaseFocusTrap = null;
      actionsLayout?.destroy();
      actionsLayout = null;
      for (const [el, outline] of originalOutlines) el.style.outline = outline;
      originalOutlines.clear();
      backdrop.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
    };

    function finish(result: DryRunPreviewAction | DryRunCorrections): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    function onKeydown(event: KeyboardEvent): void {
      if (
        selectingKind &&
        event.key === 'Enter' &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        const target = document.activeElement;
        if (target instanceof HTMLElement && opts.form?.contains(target)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          chooseControl(target);
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish('cancel');
    }

    function selectorFor(el: Element): string {
      const tag = el.tagName.toLowerCase();
      if (el.id) return `${tag}#${CSS.escape(el.id)}`;
      const name = el.getAttribute('name');
      if (name) return `${tag}[name="${CSS.escape(name)}"]`;
      const autocomplete = el.getAttribute('autocomplete');
      if (autocomplete) return `${tag}[autocomplete="${CSS.escape(autocomplete)}"]`;
      const label = el.getAttribute('aria-label');
      if (label && label.length < 40) return `${tag}[aria-label="${CSS.escape(label)}"]`;
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && current !== opts.form) {
        const siblings = Array.from(current.parentElement?.children || []).filter(
          (sibling) => sibling.tagName === current?.tagName
        );
        const index = siblings.indexOf(current);
        const currentTag = current.tagName.toLowerCase();
        parts.unshift(siblings.length > 1 ? `${currentTag}:nth-of-type(${index + 1})` : currentTag);
        current = current.parentElement;
      }
      return parts.join(' > ') || tag;
    }

    function onDocumentClick(event: MouseEvent): void {
      if (!selectingKind) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !opts.form?.contains(target)) return;
      if (chooseControl(target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    function chooseControl(target: HTMLElement): boolean {
      if (!selectingKind || !opts.form?.contains(target)) return false;
      const control = target.closest('input,select,textarea');
      if (
        !(
          control instanceof HTMLInputElement ||
          control instanceof HTMLTextAreaElement ||
          control instanceof HTMLSelectElement
        )
      )
        return false;
      if (control.disabled || ('readOnly' in control && control.readOnly)) return false;
      if (control instanceof HTMLInputElement && control.type === 'hidden') return false;
      if (
        control instanceof HTMLInputElement &&
        !['text', 'email', 'password', 'tel', 'url', 'search'].includes(control.type)
      )
        return false;
      if (
        selectingKind === 'password' &&
        (!(control instanceof HTMLInputElement) || control.type !== 'password')
      )
        return false;
      if (
        selectingKind === 'email' &&
        control instanceof HTMLInputElement &&
        ['password', 'tel', 'url'].includes(control.type)
      )
        return false;
      if (control instanceof HTMLInputElement) {
        const metadata =
          `${control.name} ${control.id} ${control.placeholder} ${control.autocomplete} ${control.getAttribute('aria-label') || ''}`.toLowerCase();
        if (
          ['username', 'firstName', 'lastName', 'fullName'].includes(selectingKind) &&
          (['email', 'tel', 'url'].includes(control.type) ||
            /email|e-mail|password|passwd|phone|mobile/.test(metadata) ||
            (selectingKind !== 'username' && /username|user.?name/.test(metadata)))
        )
          return false;
        if (
          selectingKind === 'phone' &&
          (['email', 'password', 'url'].includes(control.type) || /email|password/.test(metadata))
        )
          return false;
      }
      corrections[selectingKind] = selectorFor(control);
      selectingKind = null;
      document.removeEventListener('click', onDocumentClick, true);
      for (const [el, outline] of originalOutlines) el.style.outline = outline;
      originalOutlines.clear();
      backdrop.style.pointerEvents = 'auto';
      panel.setAttribute('aria-modal', 'true');
      releaseFocusTrap = setupFocusTrap(panel);
      prompt.textContent = opts.selectionPrompt || '';
      return true;
    }

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:12px;margin-bottom:16px;';
    for (const row of opts.rows) {
      const line = document.createElement('div');
      line.style.cssText =
        'display:flex;flex-wrap:wrap;gap:4px 12px;font-size:14px;line-height:20px;align-items:baseline;border-bottom:1px solid var(--md-outline-variant,#c5c8ba);padding-bottom:8px;';
      const lab = document.createElement('span');
      lab.style.cssText =
        'color:var(--md-on-surface-variant,#44483d);font-size:14px;font-weight:500;flex-basis:100%;';
      lab.textContent = row.label;
      const val = document.createElement('span');
      val.style.cssText = 'flex:1;min-width:0;overflow-wrap:anywhere;font-weight:400;';
      // Mask password-like
      const isSecret = /password/i.test(row.label) || row.kind === 'password';
      val.textContent = isSecret ? '••••••••' : row.value;
      if (row.target) {
        const target = document.createElement('small');
        target.style.cssText =
          'display:block;color:var(--md-on-surface-variant,#44483d);font-size:12px;line-height:16px;margin-top:4px;';
        target.textContent = row.target;
        val.appendChild(target);
      }
      line.appendChild(lab);
      line.appendChild(val);
      if (row.kind && opts.form && opts.correctLabel) {
        const correct = document.createElement('button');
        correct.className = 'review-action';
        correct.type = 'button';
        correct.textContent = opts.correctLabel;
        correct.style.cssText =
          'min-height:40px;padding:8px 12px;border-radius:20px;border:0;background:transparent;color:var(--md-primary,#4c662b);cursor:pointer;font-size:14px;font-weight:500;';
        correct.onclick = () => {
          selectingKind = row.kind || null;
          backdrop.style.pointerEvents = 'none';
          panel.removeAttribute('aria-modal');
          releaseFocusTrap?.();
          releaseFocusTrap = null;
          prompt.style.display = 'block';
          for (const candidate of Array.from(
            opts.form?.querySelectorAll<HTMLElement>('input,select,textarea') || []
          )) {
            originalOutlines.set(candidate, candidate.style.outline);
            candidate.style.outline = '2px solid var(--md-primary,#4c662b)';
          }
          document.addEventListener('click', onDocumentClick, true);
          opts.form
            ?.querySelector<HTMLElement>(
              'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'
            )
            ?.focus();
        };
        line.appendChild(correct);
      }
      list.appendChild(line);
    }
    panel.appendChild(list);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';
    const cancel = document.createElement('button');
    cancel.className = 'review-action';
    cancel.type = 'button';
    cancel.textContent = opts.cancelLabel;
    cancel.style.cssText =
      'padding:8px 12px;border-radius:20px;border:0;background:var(--md-surface-variant,#e1e4d5);color:var(--md-on-surface-variant,#44483d);cursor:pointer;font-weight:500;font-size:14px;';
    const ok = document.createElement('button');
    ok.className = 'review-action';
    ok.type = 'button';
    ok.textContent = opts.confirmLabel;
    ok.style.cssText =
      'padding:8px 14px;border-radius:20px;border:0;background:var(--md-primary,#4c662b);color:var(--md-on-primary,#fff);cursor:pointer;font-weight:600;font-size:14px;';
    ok.style.setProperty('--review-state-color', 'var(--md-on-primary,#fff)');
    cancel.onclick = () => {
      finish('cancel');
    };
    ok.onclick = () => {
      finish(Object.keys(corrections).length ? corrections : 'fill');
    };
    actions.appendChild(cancel);
    if (opts.changeIdentityLabel) {
      const changeIdentity = document.createElement('button');
      changeIdentity.className = 'review-action';
      changeIdentity.type = 'button';
      changeIdentity.textContent = opts.changeIdentityLabel;
      changeIdentity.style.cssText =
        'padding:8px 12px;border-radius:20px;border:1px solid var(--md-outline-variant,#c5c8ba);background:var(--md-surface,#fff);color:var(--md-on-surface,#1a1c16);cursor:pointer;font-weight:500;font-size:14px;';
      changeIdentity.onclick = () => {
        finish('change-identity');
      };
      actions.appendChild(changeIdentity);
    }
    actions.appendChild(ok);
    panel.appendChild(actions);
    backdrop.appendChild(panel);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        finish('cancel');
      }
    });
    root.appendChild(backdrop);
    actionsLayout = responsiveButtonLayout(actions, { tier: 'S' });
    document.addEventListener('keydown', onKeydown, true);
    releaseFocusTrap = setupFocusTrap(panel, { initialFocus: cancel });
  });
}
