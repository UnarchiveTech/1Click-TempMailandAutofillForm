/**
 * perf-marks.ts - dev-only performance instrumentation.
 *
 * A tiny ring buffer of named timing marks shared by every context (content
 * scripts, service worker, extension pages). Zero imports, so it is safe to
 * pull into any bundle without dragging dependencies along.
 *
 * Everything is compiled away in production builds (`NODE_ENV ===
 * 'production'`): every exported function becomes a no-op / empty getter, so
 * call sites cost one branch and ship no buffer.
 *
 * Usage:
 *   const t0 = perfStart('content.scan');
 *   …work…
 *   perfEnd('content.scan', t0, { force });        // duration mark
 *   perfMark('bg.swStart', { reason });            // point mark (dur 0)
 *
 * Report: getPerfReport() returns newest-last copies of the buffer for the
 * Diagnostics view (dev builds only). clearPerfReport() empties it.
 */

export interface PerfMark {
  /** Span/point name - 'context.what' convention (e.g. 'content.scan'). */
  name: string;
  /** Epoch ms when the span/point began. */
  at: number;
  /** Span duration in ms; 0 for point marks. */
  durMs: number;
  /** Optional free-form metadata (kept small - it ships in the report). */
  meta?: Record<string, string | number | boolean>;
}

const RING_MAX = 200;

/** True in development builds; false compiles every call site to a no-op. */
export const PERF_ENABLED = process.env.NODE_ENV !== 'production';

const ring: PerfMark[] = [];

function push(mark: PerfMark): void {
  ring.push(mark);
  if (ring.length > RING_MAX) ring.shift();
}

/** Begin a span; pair with perfEnd using the returned timestamp. */
export function perfStart(_name: string): number {
  return PERF_ENABLED ? Date.now() : 0;
}

/** Complete a span begun with perfStart. */
export function perfEnd(name: string, start: number, meta?: PerfMark['meta']): void {
  if (!PERF_ENABLED) return;
  push({ name, at: start, durMs: Math.max(0, Date.now() - start), meta });
}

/** Point-in-time mark (duration 0) - wake reasons, dispatch events. */
export function perfMark(name: string, meta?: PerfMark['meta']): void {
  if (!PERF_ENABLED) return;
  const at = Date.now();
  push({ name, at, durMs: 0, meta });
}

/** Copy of the current buffer, oldest first. Empty in production. */
export function getPerfReport(): PerfMark[] {
  if (!PERF_ENABLED) return [];
  return ring.slice();
}

/** Aggregated per-type count of sends through the content→background bridge. */
export interface MessageCounterEntry {
  /** Message discriminant, e.g. 'getWizardSession'; '*' sums every type. */
  type: string;
  /** Sends since page load (cache-flush: invalidated context counts a page hit). */
  count: number;
  /** Epoch ms of the most recent send of this type. */
  lastAt: number;
}

/** Monotonic page-load sequence for content contexts (per document). */
let pageLoadSeq = 0;

interface PageLoadCounters {
  /** Per-type counts, insertion-ordered (first-seen order = report order). */
  byType: Map<string, { count: number; lastAt: number }>;
  /** Page identity for the report: `origin` if derivable, else a monotonic load #. */
  page: string;
}

const counters: PageLoadCounters = {
  byType: new Map(),
  // Placeholder until setPerfPageLabel() runs in content; SW stays page-agnostic.
  page: `load#${++pageLoadSeq}`,
};

/**
 * Record one content→background send. Call sites funnel through
 * `safeSendCall`, so this is the single instrumentation point - dev builds
 * only; production compiles to a no-op.
 */
export function trackBgMessage(type: string): void {
  if (!PERF_ENABLED) return;
  const entry = counters.byType.get(type);
  if (entry) {
    entry.count += 1;
    entry.lastAt = Date.now();
  } else {
    counters.byType.set(type, { count: 1, lastAt: Date.now() });
  }
}

/**
 * Attach the page identity label the report will show. Content scripts call
 * this once at startup (and on SPA origin changes); the SW never does, so its
 * counters read as page-agnostic totals. No webNavigation permission exists,
 * so content uses origin/location fallbacks rather than frame probing.
 */
export function setPerfPageLabel(label: string): void {
  if (!PERF_ENABLED) return;
  counters.page = label;
}

/**
 * Snapshot of the page-load counters, heaviest type first. Empty in
 * production. `total` is the sum across all types. Cache-flush sends are
 * never counted (they are not page events), so counts stay page-true.
 */
export function getMessageCountReport(): {
  page: string;
  total: number;
  entries: MessageCounterEntry[];
} {
  if (!PERF_ENABLED) return { page: '', total: 0, entries: [] };
  const entries: MessageCounterEntry[] = [];
  for (const [type, { count, lastAt }] of counters.byType) {
    entries.push({ type, count, lastAt });
  }
  entries.sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : 1));
  return {
    page: counters.page,
    total: entries.reduce((sum, e) => sum + e.count, 0),
    entries,
  };
}

/** Drop all recorded marks AND message counters (test/refresh reset). */
export function clearPerfReport(): void {
  ring.length = 0;
  counters.byType.clear();
}
