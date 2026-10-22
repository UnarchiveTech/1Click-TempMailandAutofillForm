/** Tap ? for the full sheet; hold it for a non-modal, focus-preserving hint. */
export function createShortcutDiscovery(
  onReveal: (open: boolean) => void,
  onTap: () => void,
  canReveal: () => boolean,
  delayMs = 450
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pressed = false;
  let revealed = false;
  let pressedCode = '';
  function cancel() {
    clearTimeout(timer);
    timer = undefined;
    pressed = false;
    pressedCode = '';
    if (revealed) onReveal(false);
    revealed = false;
  }
  return {
    press(code = '') {
      if (pressed) return;
      pressed = true;
      pressedCode = code;
      timer = setTimeout(() => {
        timer = undefined;
        if (!canReveal()) {
          cancel();
          return;
        }
        revealed = true;
        onReveal(true);
      }, delayMs);
    },
    release(event: KeyboardEvent) {
      // Shift can be released first; '?' is on different keys across layouts.
      if (
        !pressed ||
        (event.key !== '?' &&
          !(pressedCode && event.code === pressedCode) &&
          !(!pressedCode && (event.key === '/' || event.code === 'Slash')))
      )
        return;
      const tapped = !revealed;
      cancel();
      if (tapped && canReveal()) onTap();
    },
    cancel,
  };
}
