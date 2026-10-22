import { describe, expect, test } from 'bun:test';
import { formatDobForField } from '@/entrypoints/content/autofill/form-filler.js';

/** Minimal input stub - no full DOM required for type/placeholder paths */
function fakeInput(partial: {
  type?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  title?: string;
}): HTMLInputElement {
  return {
    type: partial.type || 'text',
    placeholder: partial.placeholder || '',
    name: partial.name || '',
    id: partial.id || '',
    getAttribute(name: string) {
      if (name === 'title') return partial.title || '';
      if (name === 'aria-label') return '';
      return null;
    },
    labels: null,
    parentElement: null,
  } as unknown as HTMLInputElement;
}

describe('formatDobForField', () => {
  test('keeps ISO for type=date', () => {
    const el = fakeInput({ type: 'date', name: 'dob' });
    expect(formatDobForField('1990-06-15', el)).toBe('1990-06-15');
  });

  test('uses mm/dd/yyyy for US format hint', () => {
    const el = fakeInput({ type: 'text', placeholder: 'Format: mm/dd/yyyy', name: 'dob' });
    expect(formatDobForField('1990-06-15', el)).toBe('06/15/1990');
  });

  test('defaults text fields to mm/dd/yyyy', () => {
    const el = fakeInput({ type: 'text', name: 'dob' });
    expect(formatDobForField('2001-01-02', el)).toBe('01/02/2001');
  });
});
