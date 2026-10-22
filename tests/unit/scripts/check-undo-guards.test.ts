/**
 * Unit tests for the undo-guard ratchet in scripts/check-undo-guards.ts.
 *
 * The file-level scan is thin I/O (walk src/, read, classify); everything that
 * decides pass/fail lives in the pure functions covered here:
 * findUndoRegistrations (registration + guard detection over a synthetic
 * source file), parseBaseline/formatBaseline (round-trip, malformed rejection,
 * reason preservation), and diffAgainstBaseline (the ratchet: growth fails,
 * shrinks pass). One end-to-end assertion pins the repo's own state: the
 * shipped baseline covers every unguarded registration in src/ right now.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BaselineRow,
  countFindings,
  diffAgainstBaseline,
  type FileFinding,
  findUndoRegistrations,
  formatBaseline,
  GUARD_NAME,
  parseBaseline,
  scanFile,
} from '../../../scripts/check-undo-guards';
import { REPO_ROOT } from '../../../scripts/source-files';
import { REPO_SCAN_TIMEOUT_MS } from '../harness/repo-scan-timeout.js';

const scan = (text: string, lineOffset = 0) => findUndoRegistrations(text, lineOffset);

// ---------------------------------------------------------------------------
// Registration detection.
// ---------------------------------------------------------------------------

describe('findUndoRegistrations', () => {
  test('a bare showToast call with no undo arg is not a registration', () => {
    expect(scan(`showToast('saved', 'success');`)).toHaveLength(0);
    expect(scan(`showToast('saved');`)).toHaveLength(0);
  });

  test('an explicit null/undefined undo arg is not a registration', () => {
    expect(scan(`showToast('saved', 'success', null);`)).toHaveLength(0);
    expect(scan(`showToast('saved', 'success', undefined);`)).toHaveLength(0);
  });

  test('an inline arrow undo callback is an UNGUARDED registration', () => {
    const regs = scan(`showToast('deleted', 'success', async () => { await restore(); });`);
    expect(regs).toHaveLength(1);
    expect(regs[0]?.guarded).toBe(false);
    expect(regs[0]?.callee).toBe('showToast');
  });

  test('an inline callback that calls the guard is GUARDED', () => {
    const regs = scan(
      `showToast('deleted', 'success', async () => {\n  if (!${GUARD_NAME}(rev)) return;\n  await restore();\n});`
    );
    expect(regs).toHaveLength(1);
    expect(regs[0]?.guarded).toBe(true);
  });

  test('a same-file const callback resolves and is classified by its body', () => {
    const guarded = scan(
      [
        'const undo = async () => {',
        `  if (!${GUARD_NAME}(rev)) return;`,
        '  await restore();',
        '};',
        "showToast('deleted', 'success', undo);",
      ].join('\n')
    );
    expect(guarded).toHaveLength(1);
    expect(guarded[0]?.guarded).toBe(true);

    const unguarded = scan(
      [
        'const undo = async () => {',
        '  await restore();',
        '};',
        "setShowToast(msg, 'success', undo);",
      ].join('\n')
    );
    expect(unguarded).toHaveLength(1);
    expect(unguarded[0]?.guarded).toBe(false);
  });

  test('an unknown identifier arg is conservatively UNGUARDED (cannot see through)', () => {
    // `undoHandler` is not declared in this file: the gate cannot know whether
    // it guards, so the site must be baselined to ship.
    const regs = scan(`showToast('deleted', 'success', undoHandler);`);
    expect(regs).toHaveLength(1);
    expect(regs[0]?.guarded).toBe(false);
  });

  test('all canonical toast emitters map to their undo position', () => {
    const cases: Array<[string, string]> = [
      ["setShowToast('m', 'success', () => {});", 'setShowToast'],
      ["toastStore.success('m', 8000, () => {});", 'toastStore.success'],
      ["toastStore.warning('m', 8000, () => {});", 'toastStore.warning'],
      ["toastStore.info('m', 8000, () => {});", 'toastStore.info'],
      ["toastStore.error('m', 8000, () => {});", 'toastStore.error'],
      ["toastStore.add('warning', 'm', 8000, () => {}, 'Undo');", 'toastStore.add'],
    ];
    for (const [code, callee] of cases) {
      const regs = scan(code);
      expect(regs).toHaveLength(1);
      expect(regs[0]?.callee).toBe(callee);
      expect(regs[0]?.guarded).toBe(false);
    }
  });

  test('non-toast emitters with an isUndoCurrent-named arg elsewhere do not false-positive', () => {
    // `add`/`success` at index 2/3 of unrelated receivers still match the name
    // table - but a call without an arg there is simply not a registration.
    expect(scan(`listeners.add(listener);`)).toHaveLength(0);
    expect(scan(`map.set('success', fn);`)).toHaveLength(0);
  });

  test('line numbers include the Svelte segment offset', () => {
    const text = [
      '<script lang="ts">',
      'let x = 1;',
      "showToast('m', 'success', () => {});",
      '</script>',
    ].join('\n');
    const m = /showToast/.exec(text);
    const offset = m ? m.index : 0;
    const lineOffset = (text.slice(0, offset).match(/\n/g) ?? []).length;
    const regs = findUndoRegistrations(text.slice(offset), lineOffset);
    expect(regs).toHaveLength(1);
    expect(regs[0]?.line).toBe(3);
  });

  test(
    'the repo itself carries no NEW unguarded registration',
    async () => {
      const baselinePath = join(REPO_ROOT, 'scripts', 'baselines', 'undo-guards.txt');
      expect(existsSync(baselinePath)).toBe(true);
      const baseline = parseBaseline(readFileSync(baselinePath, 'utf8'));
      const { collectAbsoluteFiles } = await import('../../../scripts/source-files');
      const files = collectAbsoluteFiles(join(REPO_ROOT, 'src'), [
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.svelte',
      ]);
      const findings: FileFinding[] = [];
      for (const file of files) {
        findings.push(...(await scanFile(file)));
      }
      const current = countFindings(findings);
      const { violations } = diffAgainstBaseline(current, baseline);
      expect(violations).toEqual([]);
    },
    REPO_SCAN_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// Baseline ratchet.
// ---------------------------------------------------------------------------

describe('undo-guard baseline', () => {
  const B = (rows: Array<[string, number, string?]>): Map<string, BaselineRow> =>
    new Map(rows.map(([p, c, r]) => [p, { count: c, reason: r ?? '' }]));

  test('parse/format round-trip preserves counts and reasons', () => {
    const text = ['# header', 'src/a.ts 2 # PLUMBING: pass-through', 'src/b.svelte 1', ''].join(
      '\n'
    );
    const parsed = parseBaseline(text);
    expect(parsed.get('src/a.ts')).toEqual({ count: 2, reason: 'PLUMBING: pass-through' });
    expect(parsed.get('src/b.svelte')).toEqual({ count: 1, reason: '' });
    const out = formatBaseline(
      new Map([
        ['src/a.ts', 2],
        ['src/b.svelte', 1],
      ]),
      parsed
    );
    expect(out).toContain('src/a.ts 2 # PLUMBING: pass-through');
    expect(out).toContain('src/b.svelte 1');
  });

  test('malformed rows throw (a typo can never silently shrink the ratchet)', () => {
    expect(() => parseBaseline('src/a.ts two')).toThrow();
    expect(() => parseBaseline('src/a.ts 0')).toThrow();
  });

  test('a new file or a grown count FAILS; a shrunk count or gone file passes', () => {
    const baseline = B([['src/known.ts', 1, 'DEBT: pre-existing']]);
    // New file.
    expect(diffAgainstBaseline(new Map([['src/new.ts', 1]]), baseline).violations).toHaveLength(1);
    // Grown.
    expect(diffAgainstBaseline(new Map([['src/known.ts', 2]]), baseline).violations).toHaveLength(
      1
    );
    // Shrunk - passes, flagged as improved.
    const shrunk = diffAgainstBaseline(new Map([['src/known.ts', 0]]), baseline);
    expect(shrunk.violations).toHaveLength(0);
    expect(shrunk.improved).toHaveLength(1);
    // Whole file gone - passes, flagged as improved.
    expect(diffAgainstBaseline(new Map(), baseline).improved).toHaveLength(1);
  });

  test('--update output preserves existing reasons verbatim', () => {
    const previous = B([['src/known.ts', 3, 'DEBT: pre-existing']]);
    const out = formatBaseline(new Map([['src/known.ts', 2]]), previous);
    expect(out).toContain('src/known.ts 2 # DEBT: pre-existing');
  });
});
