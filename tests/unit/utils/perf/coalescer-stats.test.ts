/**
 * Unit tests for the dev-only coalescer hit-rate aggregation
 * (src/utils/perf/coalescer-stats.ts).
 *
 * The Diagnostics view turns the background's `bg.readCoalesced` (hit - a
 * caller shared an in-flight or TTL-retained run) and `bg.readRun` (miss - a
 * fresh run) marks into per-family stats. These tests pin the grouping (first
 * `|` segment), the exact hit-rate arithmetic (every call is a hit or a miss,
 * exactly once), the ordering (heaviest run burden first), and the
 * input-shape tolerance the perf-report payload needs.
 */

import { describe, expect, test } from 'bun:test';
import {
  aggregateCoalescerStats,
  type CoalescerMarkLike,
  coalescerFamilyOf,
} from '@/utils/perf/coalescer-stats.js';

const hit = (key: string): CoalescerMarkLike => ({ name: 'bg.readCoalesced', meta: { key } });
const run = (key: string): CoalescerMarkLike => ({ name: 'bg.readRun', meta: { key } });

describe('coalescerFamilyOf', () => {
  test('returns the first |-delimited segment', () => {
    expect(coalescerFamilyOf('settings')).toBe('settings');
    expect(coalescerFamilyOf('session|example.com|7')).toBe('session');
    expect(coalescerFamilyOf('ext|addresses,latestOtp')).toBe('ext');
    expect(coalescerFamilyOf('replay|example.com')).toBe('replay');
  });
});

describe('aggregateCoalescerStats', () => {
  test('hits and runs per family; hit rate is hits over total', () => {
    const rows = aggregateCoalescerStats([
      run('settings'),
      hit('settings'),
      hit('settings'),
      run('provider'),
    ]);
    const settings = rows.find((r) => r.family === 'settings');
    const provider = rows.find((r) => r.family === 'provider');
    expect(settings).toEqual({ family: 'settings', hits: 2, runs: 1, hitRate: 2 / 3 });
    expect(provider).toEqual({ family: 'provider', hits: 0, runs: 1, hitRate: 0 });
  });

  test('key prefixes group: ext and content storage reads are separate families', () => {
    const rows = aggregateCoalescerStats([
      hit('ext|addresses'),
      run('ext|addresses,latestOtp'),
      hit('content|selectedProvider'),
      hit('content|selectedProvider'),
    ]);
    const ext = rows.find((r) => r.family === 'ext');
    const content = rows.find((r) => r.family === 'content');
    expect(ext).toEqual({ family: 'ext', hits: 1, runs: 1, hitRate: 0.5 });
    expect(content).toEqual({ family: 'content', hits: 2, runs: 0, hitRate: 1 });
  });

  test('unrelated marks are ignored; missing meta falls into a (unknown) family', () => {
    const rows = aggregateCoalescerStats([
      { name: 'bg.inboxCheckCoalesced', meta: { key: 'addr-1' } },
      { name: 'content.scan' },
      run('inbox-check'), // a | less key is its own family (e.g. the inbox check)
      { name: 'bg.readRun' }, // no meta at all
    ]);
    // The inbox-check HIT mark is NOT counted: it predates the run/hit
    // pairing and has no bg.readRun counterpart, so it would skew any rate.
    expect(rows.find((r) => r.family === 'addr-1')).toBeUndefined();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.family === 'inbox-check')).toEqual({
      family: 'inbox-check',
      hits: 0,
      runs: 1,
      hitRate: 0,
    });
    expect(rows.find((r) => r.family === '(unknown)')).toEqual({
      family: '(unknown)',
      hits: 0,
      runs: 1,
      hitRate: 0,
    });
  });

  test('orders by run burden first, then hits, then family name', () => {
    const rows = aggregateCoalescerStats([
      hit('a'),
      hit('a'),
      hit('a'),
      run('b'),
      run('b'),
      hit('c'),
      hit('c'),
      hit('c'),
      hit('c'),
      run('d'),
    ]);
    expect(rows.map((r) => r.family)).toEqual(['b', 'd', 'c', 'a']);
  });

  test('empty input yields no rows (view shows the empty state)', () => {
    expect(aggregateCoalescerStats([])).toEqual([]);
  });
});
