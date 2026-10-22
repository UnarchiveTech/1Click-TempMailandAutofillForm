import { observeResizeOnFrame } from './resize-observer.js';

/** Product density profiles, independent of popup/app names or input target sizes. */
export function dialogDensityFor(width: number, availableHeight: number): 'compact' | 'roomy' {
  return width >= 480 && availableHeight >= 720 ? 'roomy' : 'compact';
}

/** Own one dialog's measurement and release every listener when it closes. */
export function observeDialogDensity(element: HTMLElement): () => void {
  const surface = element.matches('.dialog-surface, .dialog-padding')
    ? element
    : element.querySelector<HTMLElement>('.dialog-surface, .dialog-padding');
  if (!surface) return () => {};
  const view = surface.ownerDocument.defaultView;
  if (!view) return () => {};
  const previous = surface.getAttribute('data-dialog-density');
  const measure = () => {
    // clientWidth is unaffected by dialog entry transforms.
    const height = view.visualViewport?.height ?? view.innerHeight;
    const density = dialogDensityFor(surface.clientWidth, height);
    if (surface.dataset.dialogDensity !== density) surface.dataset.dialogDensity = density;
  };
  measure();
  const stopResize = observeResizeOnFrame(surface, measure);
  view.addEventListener('resize', measure);
  view.visualViewport?.addEventListener('resize', measure);
  return () => {
    stopResize();
    view.removeEventListener('resize', measure);
    view.visualViewport?.removeEventListener('resize', measure);
    if (previous === null) surface.removeAttribute('data-dialog-density');
    else surface.setAttribute('data-dialog-density', previous);
  };
}
