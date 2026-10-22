/**
 * Safe DOM property getters that guard against HTML Form Element Named Access shadowing.
 * In HTML forms, `<input name="id">` or `<input id="id">` causes `form.id` or `el.id`
 * to return an HTMLInputElement (Object) instead of a string, which causes
 * `(el.id || '').toLowerCase()` to throw `TypeError: ...toLowerCase is not a function`.
 */

export function safeStringProp(obj: unknown, prop: string): string {
  if (!obj || typeof obj !== 'object') return '';
  const val = (obj as Record<string, unknown>)[prop];
  if (typeof val === 'string') return val;
  if ('getAttribute' in obj && typeof (obj as Element).getAttribute === 'function') {
    const attr = (obj as Element).getAttribute(prop);
    if (typeof attr === 'string') return attr;
  }
  return '';
}

export function safeId(el: unknown): string {
  return safeStringProp(el, 'id');
}

export function safeName(el: unknown): string {
  return safeStringProp(el, 'name');
}

export function safePlaceholder(el: unknown): string {
  return safeStringProp(el, 'placeholder');
}

/**
 * Resolve a field's accessible label text without throwing on hostile DOM.
 * Combines `aria-label`, `aria-labelledby` targets and associated `<label>`
 * elements (both wrapping labels and `for`-linked labels) - the same signals
 * a screen reader uses to name the field. Returns '' when there is none.
 *
 * Many React SPAs (Canva etc.) label inputs ONLY via `aria-labelledby` or an
 * associated label while leaving `name`/`id`/`placeholder`/`autocomplete`
 * empty - field classification must read this name or it cannot tell an email
 * field from a phone field.
 */
export function safeAccessibleName(el: unknown): string {
  if (!el || typeof el !== 'object') return '';
  const element = el as Element;
  const parts: string[] = [];

  try {
    const aria = element.getAttribute?.('aria-label');
    if (aria) parts.push(aria);
    const labelledBy = element.getAttribute?.('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        if (!id) continue;
        try {
          const ref = element.ownerDocument?.getElementById(id);
          if (ref?.textContent) parts.push(ref.textContent);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const labels = (element as HTMLInputElement).labels;
    if (labels) {
      for (const lab of Array.from(labels)) parts.push(lab.textContent || '');
    }
  } catch {
    /* ignore */
  }

  // Explicit `for` fallback for engines where `.labels` is unavailable.
  try {
    const id = safeStringProp(element, 'id');
    if (id) {
      const escaped =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : null;
      const lab = escaped ? element.ownerDocument?.querySelector(`label[for="${escaped}"]`) : null;
      if (lab?.textContent) parts.push(lab.textContent);
    }
  } catch {
    /* ignore */
  }

  // A label can be reached through aria-labelledby, .labels and the for fallback.
  // Keep distinct signals, but never repeat the same label in the review.
  return [...new Set(parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean))].join(
    ' '
  );
}
