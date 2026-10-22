import { describe, expect, test } from 'bun:test';
import { instanceLabelFor } from '@/utils/provider/provider-instance.js';

describe('instanceLabelFor (real provider configs)', () => {
  test('no instance → no bracket', () => {
    expect(instanceLabelFor('guerrilla', '')).toBe('');
    expect(instanceLabelFor('burner', '')).toBe('');
  });

  test('guerrilla on any of its own domains → no bracket', () => {
    expect(instanceLabelFor('guerrilla', 'https://guerrillamail.com/ajax.php')).toBe('');
    expect(instanceLabelFor('guerrilla', 'https://sharklasers.com/x')).toBe('');
    expect(instanceLabelFor('guerrilla', 'https://spam4.me/y')).toBe('');
  });

  test('burner on a configured third-party instance → display name', () => {
    expect(instanceLabelFor('burner', 'https://alphac.qzz.io/api/v2')).toBe('Alphac');
    expect(instanceLabelFor('burner', 'https://raceco.dpdns.org/api/v2')).toBe('Raceco');
  });

  test('burner on its own instance → no bracket', () => {
    expect(instanceLabelFor('burner', 'https://burner.kiwi/api/v2')).toBe('');
  });

  test('unlisted / custom instance → host fallback', () => {
    expect(instanceLabelFor('burner', 'https://selfhost.example.org/api/v2')).toBe(
      'selfhost.example.org'
    );
  });

  test('unknown provider with an instance → host fallback', () => {
    expect(instanceLabelFor('nope', 'https://example.org/api')).toBe('example.org');
  });
});
