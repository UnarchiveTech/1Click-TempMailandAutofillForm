/**
 * Normalize a server-supplied favicon `Content-Type` into an image MIME type.
 *
 * The header is untrusted - whichever host the favicon fetcher is pointed at
 * chooses it - and the value is embedded into a `data:<type>;base64,…` URL that
 * is cached and later handed to `<img src>` / `new Image()`. Accepting a
 * non-image type such as `text/html` would let a host park arbitrary non-image
 * bytes in the favicon cache under a foreign MIME, so anything that is not
 * `image/*` collapses to the generic icon type. Real favicons
 * (`image/png`, `image/svg+xml`, `image/x-icon`, …) pass through unchanged.
 * Media-type parameters (`;charset=…`) are dropped.
 *
 * Lives outside `favicon.ts` because the fetcher runs in the background service
 * worker, and `favicon.ts` performs a module-scope cache hydration on import.
 */
export function normalizeFaviconContentType(rawContentType: string | null | undefined): string {
  const bare = (rawContentType || '').split(';')[0]?.trim().toLowerCase() || '';
  return bare.startsWith('image/') ? bare : 'image/x-icon';
}
