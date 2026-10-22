/**
 * Locale-aware base scale for nav/label fonts - longer languages start smaller
 * so labels fit the fixed-width nav pill. Shared by AppLayout's nav-label
 * measurement (stage selection) and Footer's font fitting, so both always
 * agree on the reference font size.
 */
export function localeFontScale(lang: string | null | undefined): number {
  const l = (lang || 'en').toLowerCase().split('-')[0];
  switch (l) {
    case 'de':
    case 'fr':
      return 0.88;
    case 'es':
    case 'ar':
      return 0.9;
    case 'ja':
    case 'zh':
    case 'th':
      return 0.95;
    default:
      return 1;
  }
}
