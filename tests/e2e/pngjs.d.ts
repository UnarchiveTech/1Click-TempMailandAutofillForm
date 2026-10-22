/**
 * Minimal ambient types for pngjs (no @types package exists) - just enough for
 * the avatar geometry spec, which decodes Playwright screenshot PNGs to
 * measure glyph ink against the avatar disc.
 */
declare module 'pngjs' {
  export const PNG: {
    sync: {
      read(buffer: Buffer): { width: number; height: number; data: Buffer };
    };
  };
}
