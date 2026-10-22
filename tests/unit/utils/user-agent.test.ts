import { describe, expect, test } from 'bun:test';
import { isSafeUserAgentString, USER_AGENT_PRESETS } from '@/utils/content/user-agent.js';

describe('isSafeUserAgentString', () => {
  test('accepts preset user agents', () => {
    expect(isSafeUserAgentString(USER_AGENT_PRESETS.chrome_windows.userAgent)).toBe(true);
  });

  test('rejects script-breaking characters', () => {
    expect(isSafeUserAgentString('Mozilla/5.0 <script>')).toBe(false);
    expect(isSafeUserAgentString('Mozilla/5.0\nalert(1)')).toBe(false);
  });

  test('rejects empty and oversized strings', () => {
    expect(isSafeUserAgentString('')).toBe(false);
    expect(isSafeUserAgentString('a'.repeat(600))).toBe(false);
  });

  test('accepts valid custom Mozilla UA', () => {
    expect(
      isSafeUserAgentString(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Custom/1.0'
      )
    ).toBe(true);
  });
});
