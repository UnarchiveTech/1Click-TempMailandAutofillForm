# E2E test assets

## roboto-latin-700-normal.woff2

Roboto Bold, Latin subset, v5.2.6 of `@fontsource/roboto`
(downloaded from `https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.2.6/files/roboto-latin-700-normal.woff2`).

Used by `tests/e2e/avatar-geometry.e2e.ts` to pin the glyph metrics of the
avatar letter, so the pixel-measured centering assertions are byte-identical
on every OS/CI runner regardless of which system fonts are installed.

License: Apache License 2.0 - © 2011 Google Inc.
See `https://github.com/google/fonts/blob/main/apache/roboto/LICENSE.txt`.
