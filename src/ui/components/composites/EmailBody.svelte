<script lang="ts">
import { onMount, tick } from 'svelte';
import { applyPersistedBodyZoom } from '@/utils/email/email-body-zoom.js';
import { PORTAL_Z } from '@/utils/ui/portal-layers.js';

/**
 * EmailBody - renders already-sanitized email HTML inside an OPEN Shadow DOM
 * root. This is the belt-and-braces second layer on top of `sanitize-html`
 * (which remains the security boundary: scripts, event attributes, style/link
 * tags and forbidden CSS props are stripped there).
 *
 * WHY SHADOW DOM
 *  - TOTAL style isolation: app/Tailwind CSS can never leak INTO the email
 *    content (no more `.email-body h1` descendant selectors competing with
 *    global utilities), and whatever styling an email carries can never leak
 *    OUT and restyle the extension UI.
 *  - CSS custom properties DO inherit across the boundary, so `--md-primary`,
 *    `--md-on-surface`, etc. keep working and the email follows the theme and
 *    dark mode for free. Inherited properties (font, color, line-height,
 *    direction) flow through too.
 *
 * TRADE-OFFS (documented)
 *  + Containment is absolute - no selector can cross the boundary in either
 *    direction, so email markup can never hide/shift/recolor the app.
 *  − Events inside the shadow are "composed" (they bubble up), but a document
 *    listener calling `target.closest()` cannot see past the boundary - code
 *    that needs to match elements inside the email must walk the shadow chain
 *    (getRootNode() → ShadowRoot.host). The global contextmenu lock in
 *    AppLayout was updated to do exactly that.
 *  − Content is inserted via shadowRoot fragments (bypassing Svelte {@html}),
 *    so the component must re-sync when the `html` prop changes - handled by
 *    the $effect below.
 *  − Browser find-in-page matches open shadow roots in modern Chrome/Firefox/
 *    Safari, but very old engines may skip the content.
 *  − Screen readers expose open shadow DOM fine, but assistive-tech bugs on
 *    legacy stacks are possible - the sanitizer stays the security boundary.
 *  − Link hover/focus shows a custom "destination host" preview tooltip. It
 *    MUST live here (shadow-root delegation + a document.body portal), because
 *    the AppLayout global tooltip can't see past the shadow boundary.
 *    Native `title` attributes are stripped from anchors to avoid double
 *    tooltips.
 *  − `user-select: none` rules from the light-DOM stylesheet no longer reach
 *    email tables - table text inside emails becomes selectable (desirable
 *    for copying), and the host keeps `data-selectable-text` so the global
 *    "allow native context menu" exception still matches.
 */

interface Props {
  /** Sanitized HTML to render (must NOT be passed raw/unsanitized input). */
  html?: string;
}

let { html = '' }: Props = $props();

let host: HTMLDivElement | null = $state(null);
let shadow: ShadowRoot | null = null;
let styleEl: HTMLStyleElement | null = null;
let lastHtml: string | null = null;
let shadowListenersAttached = false;

/** Email-body typography - lives INSIDE the shadow root so it can never
 * affect (or be affected by) the rest of the app. */
const EMAIL_BODY_CSS = `
:host {
  display: block;
  line-height: 1.55;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-size: 0.875rem;
}
h1, h2, h3, h4, h5, h6 {
  font-weight: 700;
  letter-spacing: -0.01em;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}
h1 { font-size: 1.5rem; }
h2 { font-size: 1.25rem; }
h3 { font-size: 1.125rem; }
h4 { font-size: 1rem; }
p { margin: 0 0 0.75rem 0; }
ul, ol { margin: 0 0 0.75rem 0; padding-inline-start: 1.5rem; }
li { margin: 0.15rem 0; }
img {
  max-width: 100%;
  height: auto;
  object-fit: contain;
  display: inline-block;
  border-radius: 4px;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--md-shadow) 8%, transparent);
}
table { max-width: 100%; border-collapse: collapse; }
td, th { word-break: normal; }
a {
  color: var(--md-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: color-mix(in srgb, var(--md-primary) 55%, transparent);
}
a:hover {
  color: var(--md-primary);
  filter: brightness(1.1);
}
/* Mark links with a small ↗ so clickable URLs are visible at a glance - even
   bare URLs the sender didn't anchor (linkifyHtmlBareUrls adds class). */
a[href]::after {
  content: "↗";
  display: inline-block;
  margin-inline-start: 0.2em;
  font-size: 0.72em;
  vertical-align: super;
  opacity: 0.55;
  text-decoration: none;
}
pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  background: color-mix(in srgb, var(--md-on-surface) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--md-outline-variant) 30%, transparent);
  border-radius: 8px;
  padding: 0.75rem;
  overflow-x: auto;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  background: color-mix(in srgb, var(--md-on-surface) 4%, transparent);
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  color: var(--md-on-surface);
}
blockquote {
  margin: 0.5rem 0;
  padding-inline-start: 0.75rem;
  border-inline-start: 3px solid color-mix(in srgb, var(--md-outline-variant) 70%, transparent);
  color: color-mix(in srgb, var(--md-on-surface) 70%, transparent);
}
hr {
  margin: 1rem 0;
  border: none;
  border-top: 1px solid color-mix(in srgb, var(--md-outline-variant) 30%, transparent);
}
.plain-text-email {
  font-size: 0.875rem;
  line-height: 1.6;
}
`;

// --- Link hover preview tooltip ---
// The AppLayout global tooltip can't see past the shadow boundary (composed
// events retarget to the host, so `closest('[title]')` from a document
// listener never matches links inside the email). This preview is therefore
// self-contained: delegation listeners live ON the shadow root (no
// retargeting - e.target is the real element), and the tooltip itself is
// portaled to document.body so the MailView scroll container can't clip it.
const TOOLTIP_DELAY_MS = 250;
const TOOLTIP_CSS = `
  position: fixed;
  z-index: ${PORTAL_Z.tooltip};
  pointer-events: none;
  background: var(--md-inverse-surface);
  color: var(--md-inverse-on-surface);
  border-radius: 8px;
  padding: 7px 10px;
  box-shadow: var(--md-elevation-2);
  font-size: 12px;
  line-height: 1.45;
  max-width: min(360px, 92vw);
  opacity: 0;
  transition: opacity 120ms ease;
  direction: ltr;
  text-align: left;
`;

// Singleton state shared by ALL EmailBody instances - thread entries render
// several bodies at once, and moving between links across messages must keep
// exactly ONE tooltip on screen (the next request hides the previous).
let tooltipEl: HTMLDivElement | null = null;
let tooltipTimer: ReturnType<typeof setTimeout> | null = null;
let currentAnchor: HTMLAnchorElement | null = null;
let tooltipInstanceCount = 0;
/** The anchor currently under the mouse pointer (null when over non-link
 * content). Lets the focusout handler tell a mouse-driven preview (keep - the
 * pointer still sits on the link) apart from a focus-driven one (dismiss). */
let hoveredAnchor: HTMLAnchorElement | null = null;

/** The anchor under the mouse/keyboard focus, or null. */
function targetAnchor(e: Event): HTMLAnchorElement | null {
  const t = e.target;
  if (!(t instanceof Element)) return null;
  return t.closest('a[href]');
}

function buildTooltipContent(host: string, url: string): HTMLDivElement {
  const inner = document.createElement('div');
  const hostRow = document.createElement('div');
  hostRow.textContent = `↗ ${host}`;
  hostRow.style.cssText =
    'font-weight: 500; font-size: var(--md-type-body-small-size, 12px); line-height: var(--md-type-body-small-line, 16px);';
  const urlRow = document.createElement('div');
  urlRow.textContent = url;
  urlRow.style.cssText =
    'font-size: var(--md-type-body-small-size, 12px); line-height: var(--md-type-body-small-line, 16px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: min(340px, 88vw);';
  inner.append(hostRow, urlRow);
  return inner;
}

function positionTooltip(anchor: HTMLElement): void {
  if (!tooltipEl) return;
  const linkRect = anchor.getBoundingClientRect();
  const tRect = tooltipEl.getBoundingClientRect();
  const padding = 8;
  let left = linkRect.left + linkRect.width / 2;
  let top = linkRect.bottom + 6;
  if (left < tRect.width / 2 + padding) left = tRect.width / 2 + padding;
  if (left + tRect.width / 2 > window.innerWidth - padding) {
    left = window.innerWidth - tRect.width / 2 - padding;
  }
  if (top + tRect.height > window.innerHeight - padding) {
    top = linkRect.top - tRect.height - 6;
  }
  if (top < padding) top = padding;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.transform = 'translate(-50%, 0)';
  tooltipEl.style.opacity = '1';
}

function showTooltip(anchor: HTMLAnchorElement, host: string, url: string): void {
  if (tooltipInstanceCount === 0) return;
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.setAttribute('aria-hidden', 'true');
    tooltipEl.style.cssText = TOOLTIP_CSS;
    document.body.appendChild(tooltipEl);
  }
  tooltipEl.setAttribute('aria-hidden', 'false');
  tooltipEl.replaceChildren(buildTooltipContent(host, url));
  positionTooltip(anchor);
}

function hideTooltip(): void {
  if (tooltipTimer) {
    clearTimeout(tooltipTimer);
    tooltipTimer = null;
  }
  currentAnchor = null;
  if (tooltipEl) {
    tooltipEl.style.opacity = '0';
    // Keep the hidden tooltip out of the accessibility tree - an invisible
    // div with content must not be announced by screen readers.
    tooltipEl.setAttribute('aria-hidden', 'true');
  }
}

/** Schedule the preview for an anchor (http/https only - mailto/tel/data and
 * relative hrefs have no meaningful destination host). */
function scheduleTooltip(anchor: HTMLAnchorElement): void {
  const href = anchor.getAttribute('href') || '';
  let url: URL;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    // No usable URL - if another link's preview is showing, the cursor has
    // moved onto a non-preview target (mailto/tel/relative); drop it instead
    // of letting it float over the wrong link.
    if (currentAnchor) hideTooltip();
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    if (currentAnchor) hideTooltip();
    return;
  }
  const host = url.hostname.replace(/^www\./i, '') || url.host;
  if (currentAnchor === anchor) return; // already showing/pending for this link
  hideTooltip(); // take over from any other link (same or different message)
  currentAnchor = anchor;
  tooltipTimer = setTimeout(() => {
    tooltipTimer = null;
    showTooltip(anchor, host, url.href);
  }, TOOLTIP_DELAY_MS);
}

function handleMouseOut(e: Event): void {
  const me = e as MouseEvent;
  const from = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!from) return;
  const rt = me.relatedTarget;
  if (rt instanceof Node && from.contains(rt)) return; // still inside the link
  if (rt instanceof Element && rt.closest('a[href]')) return; // its mouseover takes over
  hoveredAnchor = null;
  hideTooltip();
}

function attachShadowTooltipListeners(): void {
  if (!shadow || shadowListenersAttached) return;
  shadowListenersAttached = true;
  shadow.addEventListener('mouseover', (e) => {
    const anchor = targetAnchor(e);
    if (anchor) {
      hoveredAnchor = anchor;
      scheduleTooltip(anchor);
    }
  });
  shadow.addEventListener('mouseout', handleMouseOut);
  shadow.addEventListener('focusin', (e) => {
    const anchor = targetAnchor(e);
    if (anchor) scheduleTooltip(anchor);
  });
  shadow.addEventListener('focusout', () => {
    // Dismiss on focus loss only when the pointer ISN'T on the previewed
    // link - otherwise tabbing past an unrelated link would kill a preview
    // the mouse is still actively showing.
    if (hoveredAnchor !== currentAnchor) hideTooltip();
  });
  shadow.addEventListener('click', () => hideTooltip());
}

async function syncShadow(next: string): Promise<void> {
  if (!host || typeof document === 'undefined') return;
  await tick();
  if (!host) return;
  if (!shadow) {
    shadow = host.attachShadow({ mode: 'open' });
    styleEl = document.createElement('style');
    styleEl.textContent = EMAIL_BODY_CSS;
    shadow.appendChild(styleEl);
  }
  if (next === lastHtml) return;
  lastHtml = next;
  // Keep the injected <style> as the first node; replace everything after it.
  let child = shadow.firstChild;
  while (child) {
    const sibling = child.nextSibling;
    if (child !== styleEl) shadow.removeChild(child);
    child = sibling;
  }
  if (next) {
    const frag = document.createRange().createContextualFragment(next);
    // Native browser title tooltips would double up with our custom hover
    // preview - drop them so only the app-styled tooltip shows.
    frag.querySelectorAll('a[title]').forEach((a) => {
      a.removeAttribute('title');
    });
    shadow.appendChild(frag);
  }
  // The body was just replaced - if the visible tooltip was anchored to a link
  // that no longer exists, drop it (a detached element measures as 0×0).
  if (currentAnchor && !currentAnchor.isConnected) hideTooltip();
  attachShadowTooltipListeners();
  // Re-apply the user's persisted body-only zoom (page-level browser zoom stays
  // blocked by AppLayout; host-level zoom/attrs survive content swaps, and this
  // call skips hosts the user already scaled by hand).
  await applyPersistedBodyZoom(host);
}

// Reading `html` here registers the reactive dependency; the DOM sync is async.
$effect(() => {
  const next = html || '';
  void syncShadow(next);
});

// Hiding on scroll/resize/blur: any scroll (nested containers included) moves
// the link away from where the preview is anchored - scroll events don't bubble
// but they DO capture, so a window listener with `capture: true` sees them all.
onMount(() => {
  tooltipInstanceCount += 1;
  const hide = () => hideTooltip();
  window.addEventListener('scroll', hide, { capture: true, passive: true });
  window.addEventListener('resize', hide, { passive: true });
  window.addEventListener('blur', hide);
  return () => {
    tooltipInstanceCount -= 1;
    // This body's anchors are gone - drop any preview (or pending preview
    // timer) anchored to one of them. currentAnchor is set synchronously in
    // scheduleTooltip, so an anchor inside this body's shadow means the
    // pending/shown state is ours even while the node still reads connected
    // during teardown; without this the timer fires showTooltip on a detached
    // element (measures 0×0) and the tooltip floats ghosted at the top-left.
    if (currentAnchor && (!currentAnchor.isConnected || shadow?.contains(currentAnchor))) {
      hideTooltip();
    }
    if (tooltipInstanceCount <= 0) {
      // Last body unmounted - tear down the shared tooltip entirely.
      hideTooltip();
      tooltipEl?.remove();
      tooltipEl = null;
    }
    window.removeEventListener('scroll', hide, { capture: true });
    window.removeEventListener('resize', hide);
    window.removeEventListener('blur', hide);
  };
});
</script>

<div
  bind:this={host}
  class="email-body text-sm text-md-on-surface break-words select-text cursor-text"
  data-selectable-text="true"
  style="margin-left: auto; margin-right: auto;"
></div>
