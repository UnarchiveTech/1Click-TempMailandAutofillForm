import { describe, expect, test } from 'bun:test';
import { evaluateFit, fillPlaceholders, measureTextWidth } from '@/utils/i18n-fit-metrics';
import { flattenLocale, scanLocaleFit } from '@/utils/i18n-fit-scan';

describe('measureTextWidth', () => {
  test('empty is 0', () => {
    expect(measureTextWidth('')).toBe(0);
  });

  test('longer strings are wider', () => {
    const a = measureTextWidth('Delete', { sizePx: 12 });
    const b = measureTextWidth('Löschen', { sizePx: 12 });
    // German may be similar or wider; "endgültig löschen" definitely wider
    const c = measureTextWidth('endgültig löschen', { sizePx: 12 });
    expect(a).toBeGreaterThan(0);
    expect(c).toBeGreaterThan(a);
    expect(b).toBeGreaterThan(0);
  });

  test('CJK characters are wider per glyph than Latin', () => {
    const latin = measureTextWidth('aaaa', { sizePx: 12 });
    const cjk = measureTextWidth('删除邮件', { sizePx: 12 });
    expect(cjk).toBeGreaterThan(latin);
  });

  test('bold is slightly wider', () => {
    const regular = measureTextWidth('Settings', { sizePx: 12, weight: 400 });
    const bold = measureTextWidth('Settings', { sizePx: 12, weight: 700 });
    expect(bold).toBeGreaterThanOrEqual(regular);
  });
});

describe('fillPlaceholders', () => {
  test('replaces known samples', () => {
    expect(fillPlaceholders('Inbox ({count})', { count: '12' })).toBe('Inbox (12)');
  });

  test('defaults count to 99', () => {
    expect(fillPlaceholders('{count} items')).toBe('99 items');
  });
});

describe('evaluateFit', () => {
  test('reports free space when under slot budget', () => {
    const r = evaluateFit({
      enText: 'Delete',
      localeText: 'Delete',
      paddingX: 12,
      maxControlPx: 200,
    });
    expect(r.status).toBe('ok');
    expect(r.freeSpace).toBeGreaterThan(0);
    expect(r.budgetSource).toBe('slot');
  });

  test('overflow when locale exceeds slot', () => {
    const r = evaluateFit({
      enText: 'OK',
      localeText: 'This is a very long translated label',
      paddingX: 8,
      maxControlPx: 40,
    });
    expect(r.status).toBe('overflow');
    expect(r.freeSpace).toBeLessThan(0);
  });

  test('en-growth budget when no slot', () => {
    const r = evaluateFit({
      enText: 'Save',
      localeText: 'Save',
      growthFactor: 1.4,
      paddingX: 0,
    });
    expect(r.budgetSource).toBe('en-growth');
    expect(r.maxWidth).toBe(Math.ceil(r.enWidth * 1.4));
    expect(r.status).toBe('ok');
  });

  test('deltaVsEn is locale - en', () => {
    const r = evaluateFit({
      enText: 'Hi',
      localeText: 'Hello there friend',
      maxControlPx: 500,
    });
    expect(r.deltaVsEn).toBe(r.localeWidth - r.enWidth);
    expect(r.deltaVsEn).toBeGreaterThan(0);
  });
});

describe('scanLocaleFit', () => {
  test('flags budget overflow and orphans', () => {
    const en = new Map([
      ['common.delete', 'Delete'],
      ['common.save', 'Save'],
    ]);
    const de = new Map([
      ['common.delete', 'Dauerhaft endgültig löschen bitte'],
      ['common.save', 'Save'],
    ]);
    const result = scanLocaleFit(
      en,
      { de },
      {
        budgets: {
          'common.delete': { maxControlPx: 50, paddingX: 4, font: { sizePx: 12 } },
          'missing.key': { maxControlPx: 100 },
        },
        budgetedOnly: true,
      }
    );
    expect(result.summary.orphanBudgets).toContain('missing.key');
    expect(result.summary.budgetedOverflow).toBeGreaterThanOrEqual(1);
    const row = result.rows.find((r) => r.key === 'common.delete' && r.locale === 'de');
    expect(row?.status).toBe('overflow');
  });

  test('flattenLocale handles nesting', () => {
    const m = flattenLocale({
      a: { b: 'x', c: { d: 'y' } },
      e: 'z',
    });
    expect(m.get('a.b')).toBe('x');
    expect(m.get('a.c.d')).toBe('y');
    expect(m.get('e')).toBe('z');
  });
});
