/** Keep the usable inline edges equal with classic or overlay scrollbars.
 * Explicit .scroll-body markers opt in; .scroll-frame owns matching chrome.
 * The observer lives for one AppLayout mount, including its portaled dialogs.
 */
export function observeScrollGutters(root: HTMLElement): () => void {
  const bodies = new Set<HTMLElement>();
  const frames = new Set<HTMLElement>();
  let pending = 0;
  let disposed = false;

  function schedule() {
    if (!disposed && !pending) pending = requestAnimationFrame(refresh);
  }

  const resize = new ResizeObserver(schedule);
  const mutations = new MutationObserver(schedule);

  function clearBody(body: HTMLElement) {
    resize.unobserve(body);
    body.style.removeProperty('--scroll-base-padding');
    body.style.removeProperty('--scrollbar-space');
    delete body.dataset.scrollBalanced;
    bodies.delete(body);
  }

  function refresh() {
    pending = 0;
    const current = new Set(root.querySelectorAll<HTMLElement>('.scroll-body'));
    for (const body of bodies) {
      if (!current.has(body)) clearBody(body);
    }
    const measurements: { body: HTMLElement; padding: string; space: number }[] = [];
    const frameSpaces = new Map<HTMLElement, number>();
    // Batch reads before writes. Never infer scrollbar width from a platform.
    for (const body of current) {
      if (!bodies.has(body)) {
        bodies.add(body);
        resize.observe(body);
      }
      const style = getComputedStyle(body);
      const border = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      const space = Math.max(0, body.offsetWidth - body.clientWidth - border);
      measurements.push({ body, padding: style.paddingInlineEnd, space });
      if (body.classList.contains('scroll-body-framed')) {
        const frame = body.closest<HTMLElement>('.scroll-frame');
        if (frame) frameSpaces.set(frame, Math.max(frameSpaces.get(frame) ?? 0, space));
      }
    }
    for (const { body, padding, space } of measurements) {
      body.style.setProperty('--scroll-base-padding', padding);
      body.style.setProperty('--scrollbar-space', `${space}px`);
      body.dataset.scrollBalanced = 'true';
    }
    for (const frame of frames) {
      if (!frameSpaces.has(frame)) {
        frame.style.removeProperty('--scroll-edge-space');
        frames.delete(frame);
      }
    }
    for (const [frame, space] of frameSpaces) {
      frames.add(frame);
      frame.style.setProperty('--scroll-edge-space', `${space}px`);
    }
  }

  mutations.observe(root, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'dir'],
  });
  window.addEventListener('resize', schedule);
  schedule();
  return () => {
    disposed = true;
    mutations.disconnect();
    resize.disconnect();
    window.removeEventListener('resize', schedule);
    if (pending) cancelAnimationFrame(pending);
    for (const body of bodies) clearBody(body);
    for (const frame of frames) frame.style.removeProperty('--scroll-edge-space');
    frames.clear();
  };
}
