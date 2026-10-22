/**
 * Regression tests for the storage read-modify-write gate.
 *
 * The gate exists because `storage.local.set({ K: … })` replaces the WHOLE value
 * of K: a flow that reads K, mutates what it read and writes it back loses a
 * concurrent write to the same key. The tests below pin both halves of the rule
 * - the shape that is the bug, and the shapes that are not (a fresh preference
 * value, a parameter, a pair already inside `withLock`/`updateStoredObject`, a
 * write that precedes its read, and a binding that is out of scope at the write
 * site) - plus the ratchet's own arithmetic and the live repository's agreement
 * with `scripts/baselines/storage-rmw.txt`.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  type BaselineRow,
  diffBaseline,
  formatBaseline,
  parseBaseline,
  scanSource,
} from '../../../scripts/check-storage-rmw';
import { collectAbsoluteFiles, REPO_ROOT } from '../../../scripts/source-files';
import { REPO_SCAN_TIMEOUT_MS } from '../harness/repo-scan-timeout.js';

const sitesOf = (source: string) => scanSource(source).sites.map((s) => s.key);

describe('scanSource flags a whole-key read-modify-write', () => {
  test('a whole-result binding mutated through a member, then written back', () => {
    const source = [
      'async function applySnooze() {',
      "  const res = await browser.storage.local.get(['notificationSnoozeByAddress']);",
      '  const map = { ...(res.notificationSnoozeByAddress || {}) };',
      '  map[addr] = until;',
      '  await browser.storage.local.set({ notificationSnoozeByAddress: map });',
      '}',
    ].join('\n');
    const scan = scanSource(source);
    expect(scan.sites.map((s) => [s.key, s.readLine, s.writeLine])).toEqual([
      ['notificationSnoozeByAddress', 2, 5],
    ]);

    // A signature carrying a return type is still a scope, so the pair INSIDE it
    // keeps being reported - the scope fix must not suppress real findings.
    const annotated = [
      'async function applySnooze(): Promise<void> {',
      "  const res = await browser.storage.local.get(['notificationSnoozeByAddress']);",
      '  const map = { ...(res.notificationSnoozeByAddress || {}) };',
      '  map[addr] = until;',
      '  await browser.storage.local.set({ notificationSnoozeByAddress: map });',
      '}',
    ].join('\n');
    expect(scanSource(annotated).sites.map((s) => s.key)).toEqual(['notificationSnoozeByAddress']);
  });

  test('a destructured binding written back with shorthand', () => {
    const source = [
      'async function seed() {',
      "  const { identities = [] } = await ext.storage.local.get(['identities']);",
      '  identities.push(defaultIdentity);',
      '  await ext.storage.local.set({ identities });',
      '}',
    ].join('\n');
    expect(sitesOf(source)).toEqual(['identities']);
  });

  test('a destructuring ALIAS is traced to the key it carries', () => {
    const source = [
      'async function seed() {',
      "  const { identities: list = [] } = await ext.storage.local.get(['identities']);",
      '  list.push(extra);',
      '  await ext.storage.local.set({ identities: list });',
      '}',
    ].join('\n');
    expect(sitesOf(source)).toEqual(['identities']);
  });

  test('taint reaches a local derived from the read (spread / || default)', () => {
    const source = [
      'async function clearSnooze() {',
      "  const res = await browser.storage.local.get(['notificationSnoozeByAddress']);",
      '  const map = { ...(res.notificationSnoozeByAddress || {}) };',
      '  delete map[addr];',
      '  await browser.storage.local.set({ notificationSnoozeByAddress: map });',
      '}',
    ].join('\n');
    expect(sitesOf(source)).toEqual(['notificationSnoozeByAddress']);
  });

  test('a file-local const key resolves on both sides', () => {
    const source = [
      "const ANALYTICS_KEY = 'analytics';",
      'async function bump() {',
      '  const stored = await ext.storage.local.get([ANALYTICS_KEY]);',
      '  const next = { ...(stored.analytics || {}), opens: 1 };',
      '  await ext.storage.local.set({ [ANALYTICS_KEY]: next });',
      '}',
    ].join('\n');
    // A computed set key is deliberately NOT resolvable - this pins that the
    // gate does not guess one, while the get side still resolves.
    expect(sitesOf(source)).toEqual([]);
    const declared = [
      "const ANALYTICS_KEY = 'analytics';",
      'async function bump() {',
      '  const stored = await ext.storage.local.get([ANALYTICS_KEY]);',
      '  const next = { ...(stored.analytics || {}), opens: 1 };',
      '  await ext.storage.local.set({ analytics: next });',
      '}',
    ].join('\n');
    expect(sitesOf(declared)).toEqual(['analytics']);
  });
});

describe('scanSource never flags these', () => {
  test('a write that precedes its read is two operations, not a modify', () => {
    const source = [
      'async function save(next) {',
      '  await ext.storage.local.set({ uiDensity: next });',
      "  const read = await ext.storage.local.get(['uiDensity']);",
      '  return read.uiDensity;',
      '}',
    ].join('\n');
    expect(sitesOf(source)).toEqual([]);
  });

  test('a fresh value - a literal, or a function parameter - is not derived state', () => {
    const source = [
      'async function saveDensity(next) {',
      "  const current = await ext.storage.local.get(['uiDensity']);",
      '  await ext.storage.local.set({ uiDensity: next });',
      '  await ext.storage.local.set({ showImages: true });',
      '  return current;',
      '}',
    ].join('\n');
    expect(sitesOf(source)).toEqual([]);
  });

  test('a pair already inside withLock is serialized - that IS the fix', () => {
    const source = [
      'async function remove(n) {',
      "  await withLock('identities_lock', async () => {",
      "    const { identities = [] } = await ext.storage.local.get(['identities']);",
      '    const next = identities.filter((i) => i.id !== n);',
      '    await ext.storage.local.set({ identities: next });',
      '  });',
      '}',
    ].join('\n');
    const scan = scanSource(source);
    expect(scan.sites).toEqual([]);
    expect(scan.serialized).toBe(1);
  });

  test('a pair inside updateStoredObject is serialized by the helper', () => {
    const source = [
      'async function bump() {',
      "  await updateStoredObject('analytics', (current) => {",
      '    const stored = current.analytics ?? {};',
      '    return { ...stored, opens: (stored.opens || 0) + 1 };',
      '  }, parseAnalytics);',
      '}',
    ].join('\n');
    expect(scanSource(source).sites).toEqual([]);
  });

  test('a binding out of scope at the write site cannot taint it - return types included', () => {
    // A `): Promise<T> {` signature IS a scope. Reading the `{` as "not after a
    // `)`, so not a function body" left the body invisible, and the write of an
    // unrelated same-named PARAMETER below was reported as this read's
    // read-modify-write - the false positive two baseline rows carried.
    const source = [
      'export async function getAnalyticsRecord(): Promise<Analytics> {',
      "  const { analytics } = await ext.storage.local.get(['analytics']);",
      '  return analytics || DEFAULT_ANALYTICS;',
      '}',
      'export async function setAnalyticsRecord(analytics: Analytics): Promise<void> {',
      '  await writeWithRetry({ analytics });',
      '}',
    ].join('\n');
    expect(sitesOf(source)).toEqual([]);

    // The same collision spelled as METHODS of one class.
    const methods = [
      'class Store {',
      '  async getAnalytics(): Promise<Analytics> {',
      "    const { analytics } = await ext.storage.local.get(['analytics']);",
      '    return analytics;',
      '  }',
      '  async setAnalytics(analytics: Analytics): Promise<void> {',
      '    await writeWithRetry({ analytics });',
      '  }',
      '}',
    ].join('\n');
    expect(sitesOf(methods)).toEqual([]);

    // A nested generic return type is the same shape with more brackets.
    const generic = [
      'async function load(): Promise<Record<string, number>> {',
      "  const { map } = await ext.storage.local.get(['map']);",
      '  return map;',
      '}',
      'async function save(map: Record<string, number>): Promise<void> {',
      '  await ext.storage.local.set({ map });',
      '}',
    ].join('\n');
    expect(sitesOf(generic)).toEqual([]);
  });

  test('a binding out of scope at the write site cannot taint it', () => {
    // The shape that motivated scope tracking: `provider` is a destructured
    // alias in loadSettings, and an unrelated PARAMETER of the same name is
    // written by switchProvider. Name-keyed taint called that a finding.
    const source = [
      'async function loadSettings(ext) {',
      "  const { selectedProvider: provider } = await ext.storage.local.get(['selectedProvider']);",
      '  return provider;',
      '}',
      'async function switchProvider(ext, provider) {',
      '  await ext.storage.local.set({ selectedProvider: provider });',
      '}',
    ].join('\n');
    expect(sitesOf(source)).toEqual([]);
  });

  test('a different key’s value written into K is not K’s read-modify-write', () => {
    const source = [
      'async function move() {',
      "  const { source } = await ext.storage.local.get(['source']);",
      '  await ext.storage.local.set({ destination: source });',
      '}',
    ].join('\n');
    expect(sitesOf(source)).toEqual([]);
  });

  test('a call written inside a comment or a string is not a call', () => {
    const source = [
      '// await ext.storage.local.set({ identities });',
      "const doc = 'await ext.storage.local.set({ identities })';",
      'async function run() {',
      "  const { identities } = await ext.storage.local.get(['identities']);",
      '  return identities;',
      '}',
    ].join('\n');
    expect(sitesOf(source)).toEqual([]);
  });
});

describe('the baseline ratchet', () => {
  const rows: BaselineRow[] = [
    { file: 'src/a.ts', key: 'identities' },
    { file: 'src/b.ts', key: 'analytics' },
  ];

  test('format → parse round-trips, sorted, with comments ignored', () => {
    const text = `# a comment\n\n${formatBaseline(rows)}`;
    expect(parseBaseline(text)).toEqual(rows);
    expect(formatBaseline([...rows].reverse())).toBe(formatBaseline(rows));
  });

  test('a row excuses only its exact file AND key', () => {
    const { added, stale } = diffBaseline(
      [
        { file: 'src/a.ts', key: 'identities' },
        { file: 'src/a.ts', key: 'other' },
      ],
      rows
    );
    expect(added).toEqual([{ file: 'src/a.ts', key: 'other' }]);
    expect(stale).toEqual([{ file: 'src/b.ts', key: 'analytics' }]);
  });
});

describe('this repository', () => {
  test(
    'the scan and scripts/baselines/storage-rmw.txt agree - no new site, no stale row',
    () => {
      const baseline = parseBaseline(
        readFileSync(`${REPO_ROOT}/scripts/baselines/storage-rmw.txt`, 'utf8')
      );
      const found: BaselineRow[] = [];
      let serialized = 0;
      for (const file of collectAbsoluteFiles(`${REPO_ROOT}/src`, ['.ts', '.svelte'])) {
        const scan = scanSource(readFileSync(file, 'utf8'));
        serialized += scan.serialized;
        for (const site of scan.sites) {
          const repoPath = file.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
          if (!found.some((r) => r.file === repoPath && r.key === site.key)) {
            found.push({ file: repoPath, key: site.key });
          }
        }
      }
      const { added, stale } = diffBaseline(found, baseline);
      expect(added).toEqual([]);
      expect(stale).toEqual([]);
      // Non-vacuity: the exemption path is exercised on the real tree, so a
      // scanner that stopped classifying anything cannot pass by finding nothing.
      expect(serialized).toBeGreaterThan(0);
    },
    REPO_SCAN_TIMEOUT_MS
  );
});
