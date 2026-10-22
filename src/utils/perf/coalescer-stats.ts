/**
 * Dev-only aggregation of the read-coalescer telemetry marks.
 *
 * The background emits two mark kinds per keyed read cache:
 * - `bg.readCoalesced` - a caller SHARED an in-flight or TTL-retained run
 *   (one saved background round-trip); meta.key identifies the cache family.
 * - `bg.readRun` - a caller started a FRESH run (cache miss; the background
 *   work actually happened).
 *
 * Hits ÷ (hits + runs) is the cache's exact hit rate: the coalescer invokes
 * the task only on a fresh run, so every call is counted exactly once as a
 * hit or a miss.
 *
 * The "family" is the key's first segment - message-handler encodes every
 * cache key with a distinctive prefix (`settings`, `session|…`, `active-meta`,
 * `map|…`, `ext|…`, `content|…`, `provider`, `providerName|…`, `replay|…`,
 * and the inbox check's address ids), so the segment groups marks per cache
 * without another registry. Pure data in → data out: no DOM, no i18n, no
 * browser APIs, so it stays unit-testable and trivially tree-shakeable.
 */

/** Marks of interest, narrowed from the perf-report row shape. */
export interface CoalescerMarkLike {
  name: string;
  meta?: Record<string, string | number | boolean> | undefined;
}

export interface CoalescerFamilyStat {
  /** Cache family - the mark key's first segment (e.g. 'settings', 'replay'). */
  family: string;
  /** Calls that SHARED a run (in-flight or TTL-retained). */
  hits: number;
  /** Calls that started a FRESH run (cache misses). */
  runs: number;
  /** hits ÷ (hits + runs), 0 when nothing was recorded. */
  hitRate: number;
}

const HIT_MARK = 'bg.readCoalesced';
const RUN_MARK = 'bg.readRun';

/** Cache family for a mark key: the first `|`-delimited segment. */
export function coalescerFamilyOf(key: string): string {
  const i = key.indexOf('|');
  return i === -1 ? key : key.slice(0, i);
}

/**
 * Aggregate marks into per-family stats, heaviest burden first: families
 * with the most RUNS (the background work the coalescer exists to avoid)
 * lead, then most hits. Families with no activity are omitted entirely.
 */
export function aggregateCoalescerStats(marks: CoalescerMarkLike[]): CoalescerFamilyStat[] {
  const byFamily = new Map<string, { hits: number; runs: number }>();
  for (const mark of marks) {
    if (mark.name !== HIT_MARK && mark.name !== RUN_MARK) continue;
    const rawKey = mark.meta?.key;
    const family = coalescerFamilyOf(typeof rawKey === 'string' ? rawKey : '(unknown)');
    const stat = byFamily.get(family) ?? { hits: 0, runs: 0 };
    if (mark.name === HIT_MARK) stat.hits += 1;
    else stat.runs += 1;
    byFamily.set(family, stat);
  }
  const rows: CoalescerFamilyStat[] = [];
  for (const [family, { hits, runs }] of byFamily) {
    const total = hits + runs;
    rows.push({ family, hits, runs, hitRate: total === 0 ? 0 : hits / total });
  }
  rows.sort((a, b) => b.runs - a.runs || b.hits - a.hits || (a.family < b.family ? -1 : 1));
  return rows;
}
