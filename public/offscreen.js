/**
 * Offscreen audio player for the MV3 service worker (Chrome).
 *
 * The background has no AudioContext, so `chrome.offscreen` hosts a document
 * that CAN create one and plays the notification beep when the background
 * sends a `playNotificationSound` runtime message. Plain script (no module
 * imports) so it works as a static asset from the extension root.
 */
(() => {
  const runtime = globalThis.browser?.runtime ?? globalThis.chrome?.runtime;

  function playBeep() {
    const AudioContextClass =
      globalThis.AudioContext ??
      (typeof globalThis.webkitAudioContext === 'function' ? globalThis.webkitAudioContext : null);
    if (!AudioContextClass) return;

    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800; // Hz
    oscillator.type = 'sine';
    gainNode.gain.value = 0.1; // Volume

    const cleanup = () => {
      try {
        if (audioContext.state !== 'closed') {
          void audioContext.close();
        }
      } catch {
        /* ignore cleanup errors */
      }
    };

    oscillator.onended = cleanup;
    setTimeout(cleanup, 500);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2); // 200ms beep
  }

  runtime?.onMessage.addListener((message) => {
    if (message?.type === 'playNotificationSound') {
      playBeep();
    }
  });
})();
