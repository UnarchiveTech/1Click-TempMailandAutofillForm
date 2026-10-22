import { describe, expect, test } from 'bun:test';
import { detailToolbarBtnClass } from '../../../src/ui/detail-toolbar';

describe('detail toolbar fitting and motion', () => {
  for (const labels of [false, true]) {
    test(`labels=${labels}: fitting dimensions do not animate`, () => {
      const classes = detailToolbarBtnClass(labels);
      expect(classes).not.toContain('transition-all');
      expect(classes).toContain('transition-[color,background-color,transform]');
      expect(classes).toContain('motion-reduce:transition-none');
      expect(classes).toContain('active:scale-95');
    });
  }
});
