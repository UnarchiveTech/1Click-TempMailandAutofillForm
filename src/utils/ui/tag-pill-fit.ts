/**
 * Fit a single row of tag pills. When tags overflow, the final visible pill
 * includes +N, so its measured summary width replaces its ordinary width.
 */
export function fitTagPillCount(
  fullWidths: readonly number[],
  summaryWidths: readonly number[],
  availableWidth: number,
  gap: number
): number {
  const total = fullWidths.length;
  if (total === 0) return 0;

  for (let count = total; count >= 1; count--) {
    let used = gap * (count - 1);
    for (let index = 0; index < count; index++) {
      used +=
        index === count - 1 && count < total
          ? (summaryWidths[index] ?? fullWidths[index] ?? 0)
          : (fullWidths[index] ?? 0);
    }
    if (used <= availableWidth || count === 1) return count;
  }

  return 1;
}
