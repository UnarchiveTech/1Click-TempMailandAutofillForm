export interface VirtualListWindow {
  start: number;
  end: number;
  paddingBefore: number;
  paddingAfter: number;
}

export type VirtualItemHeight = number | ((index: number) => number);

export interface VirtualListMeasurementCache {
  heights: number[];
  offsets: number[];
  lastCount: number;
  lastHeightSource?: VirtualItemHeight;
}

export function createVirtualListMeasurementCache(): VirtualListMeasurementCache {
  return { heights: [], offsets: [0], lastCount: 0 };
}

export function invalidateVirtualListMeasurements(
  cache: VirtualListMeasurementCache,
  fromIndex = 0
): void {
  const start = Math.max(0, Math.floor(fromIndex));
  cache.offsets.length = Math.min(cache.offsets.length, start + 1);
  cache.heights.length = Math.min(cache.heights.length, start);
  cache.lastCount = Math.min(cache.lastCount, start);
}

function resolveItemHeight(itemHeight: VirtualItemHeight, index: number): number {
  const value = typeof itemHeight === 'function' ? itemHeight(index) : itemHeight;
  return Number.isFinite(value) ? Math.max(1, value) : 1;
}

/**
 * Calculate the visible item range for a variable-height virtual list.
 * The caller should render items in [start, end) and reserve the returned
 * padding above and below that range to preserve the scroll geometry.
 *
 * Heights may be estimates or measured values. Recalculating the prefix sums
 * is intentionally cheap for the mailbox's bounded list and avoids the scroll
 * drift caused by treating short gap rows and expanded thread rows as equal.
 */
export function getVirtualListWindow(
  totalCount: number,
  scrollTop: number,
  viewportHeight: number,
  estimatedItemHeight: VirtualItemHeight,
  overscan = 6,
  measurementCache?: VirtualListMeasurementCache
): VirtualListWindow {
  const count = Math.max(0, Math.floor(totalCount));
  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewportHeight = Math.max(1, viewportHeight);
  const safeOverscan = Math.max(0, Math.floor(overscan));

  if (count === 0) {
    return { start: 0, end: 0, paddingBefore: 0, paddingAfter: 0 };
  }

  const cache = measurementCache;
  const offsets = cache?.offsets ?? new Array<number>(count + 1);
  if (cache) {
    if (cache.lastHeightSource !== estimatedItemHeight) {
      cache.heights.length = 0;
      cache.offsets.length = 1;
      cache.offsets[0] = 0;
      cache.lastCount = 0;
      cache.lastHeightSource = estimatedItemHeight;
    }
    offsets.length = count + 1;
    offsets[0] = 0;
  } else {
    offsets[0] = 0;
  }
  const startIndex = cache ? Math.min(cache.lastCount, count) : 0;
  if (cache && startIndex > 0) offsets[startIndex] = cache.offsets[startIndex] ?? 0;
  for (let i = startIndex; i < count; i++) {
    const height = resolveItemHeight(estimatedItemHeight, i);
    if (cache) cache.heights[i] = height;
    offsets[i + 1] = offsets[i] + height;
  }
  if (cache) cache.lastCount = count;

  // Find the first item whose bottom is after the current scroll position.
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] <= safeScrollTop) low = middle + 1;
    else high = middle;
  }
  const firstVisible = Math.min(count - 1, low);

  // Find the first item whose top is at or below the viewport bottom.
  const viewportBottom = safeScrollTop + safeViewportHeight;
  low = 0;
  high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] < viewportBottom) low = middle + 1;
    else high = middle;
  }
  const lastVisibleExclusive = Math.max(firstVisible + 1, low);
  const start = Math.max(0, firstVisible - safeOverscan);
  const end = Math.min(count, lastVisibleExclusive + safeOverscan);
  const totalHeight = offsets[count];

  return {
    start,
    end,
    paddingBefore: offsets[start],
    paddingAfter: Math.max(0, totalHeight - offsets[end]),
  };
}
