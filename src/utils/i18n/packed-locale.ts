import { strFromU8, unzlibSync } from 'fflate/browser';

/**
 * Decode a build-generated locale pack once when its module loads. Source
 * dictionaries stay readable JSON; the shipped strings are losslessly packed.
 * Uses the existing browser-only codec, without fetch, eval or browser-specific
 * decompression APIs. English fallbacks are deliberately left unpacked.
 */
export function decodePackedLocale(packed: string): Record<string, unknown> {
  const binary = atob(packed);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(strFromU8(unzlibSync(bytes))) as Record<string, unknown>;
}
