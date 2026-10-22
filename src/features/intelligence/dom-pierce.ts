/**
 * DOM piercing: open shadow roots + same-origin iframes.
 */

/** Walk light DOM + open shadow roots (closed shadows stay opaque). Max 10 levels deep to prevent stack overflow. */
export function queryAllDeep<T extends Element = Element>(
  root: Document | ShadowRoot | Element,
  selector: string,
  _depth = 0
): T[] {
  if (_depth > 10) return [];
  const out: T[] = [];
  try {
    out.push(...Array.from(root.querySelectorAll(selector) as NodeListOf<T>));
  } catch {
    /* intentional: selector may be invalid in hostile DOM */
  }
  try {
    const all = root.querySelectorAll('*');
    for (const el of Array.from(all)) {
      try {
        const sr = (el as HTMLElement).shadowRoot;
        if (sr) out.push(...queryAllDeep<T>(sr, selector, _depth + 1));
      } catch {
        /* intentional: closed shadow root */
      }
    }
  } catch {
    /* intentional: shadow tree walk teardown */
  }
  return out;
}

/** Collect forms from document, open shadows, and same-origin iframes (including iframes inside shadow roots). */
export function collectFormsDeep(
  doc: Document = document,
  _depth = 0,
  visited = new Set<Document>()
): HTMLFormElement[] {
  if (_depth > 10 || visited.has(doc)) return [];
  visited.add(doc);
  const forms = queryAllDeep<HTMLFormElement>(doc, 'form');
  // Use queryAllDeep so iframes inside shadow roots are also found
  try {
    const iframes = queryAllDeep<HTMLIFrameElement>(doc, 'iframe');
    for (const frame of iframes) {
      try {
        const idoc = frame.contentDocument;
        if (idoc) forms.push(...collectFormsDeep(idoc, _depth + 1, visited));
      } catch {
        /* intentional: cross-origin iframe */
      }
    }
  } catch {
    /* intentional: selector may be invalid in hostile DOM */
  }
  // Dedupe
  return Array.from(new Set(forms));
}

/** Collect inputs deep (shadow + same-origin iframes, including iframes inside shadow roots). */
export function collectInputsDeep(
  root: Document | ShadowRoot | Element = document,
  _depth = 0,
  visited = new Set<Document>()
): Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> {
  if (_depth > 10) return [];
  if (root instanceof Document) {
    if (visited.has(root)) return [];
    visited.add(root);
  }

  const out: Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = [];
  const sel =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), select, textarea';

  try {
    out.push(
      ...Array.from(
        root.querySelectorAll(sel) as NodeListOf<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >
      )
    );
  } catch {
    /* intentional: hostile DOM may reject querySelectorAll */
  }

  // Find shadow roots by checking elements with shadowRoot attached
  try {
    const all = root.querySelectorAll('*');
    for (const el of Array.from(all)) {
      try {
        const sr = (el as HTMLElement).shadowRoot;
        if (sr) out.push(...collectInputsDeep(sr, _depth + 1, visited));
      } catch {
        /* intentional: closed shadow root */
      }
    }
  } catch {
    /* intentional: shadow host walk teardown */
  }

  if (root instanceof Document) {
    try {
      for (const frame of Array.from(root.querySelectorAll('iframe'))) {
        try {
          const idoc = frame.contentDocument;
          if (idoc) out.push(...collectInputsDeep(idoc, _depth + 1, visited));
        } catch {
          /* intentional: cross-origin iframe */
        }
      }
    } catch {
      /* intentional: iframe walk teardown */
    }
  }

  return Array.from(new Set(out));
}
