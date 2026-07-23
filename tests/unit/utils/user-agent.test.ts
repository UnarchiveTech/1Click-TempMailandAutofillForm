import { describe, expect, test } from 'bun:test';
import {
  getRandomUserAgentConfig,
  inferPlatformFromUA,
  USER_AGENT_PRESETS,
} from '@/utils/user-agent';

describe('inferPlatformFromUA', () => {
  test('correctly infers Win32 for Windows User-Agents', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    expect(inferPlatformFromUA(ua)).toBe('Win32');
  });

  test('correctly infers MacIntel for Macintosh/MacOS User-Agents', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    expect(inferPlatformFromUA(ua)).toBe('MacIntel');
  });

  test('correctly infers Linux armv8l for Android User-Agents', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';
    expect(inferPlatformFromUA(ua)).toBe('Linux armv8l');
  });

  test('correctly infers Linux x86_64 for Linux Desktop User-Agents', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    expect(inferPlatformFromUA(ua)).toBe('Linux x86_64');
  });

  test('correctly infers iPhone for iOS Mobile User-Agents', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(inferPlatformFromUA(ua)).toBe('iPhone');
  });

  test('defaults to Win32 for unrecognized user agents', () => {
    expect(inferPlatformFromUA('Some unrecognized agent/1.0')).toBe('Win32');
  });
});

describe('getRandomUserAgentConfig', () => {
  test('returns a valid UserAgentConfig object', () => {
    const config = getRandomUserAgentConfig();
    expect(config).toBeObject();
    expect(typeof config.userAgent).toBe('string');
    expect(typeof config.platform).toBe('string');
    expect(config.userAgent.length).toBeGreaterThan(0);
    expect(config.platform.length).toBeGreaterThan(0);
  });

  test('only returns Chrome-based user agents', () => {
    const config = getRandomUserAgentConfig();
    expect(config.userAgent).toContain('Chrome');
    expect(config.userAgent).toContain('Safari');
    expect(config.userAgent).toContain('AppleWebKit');
  });
});

describe('USER_AGENT_PRESETS', () => {
  test('has all expected browser options', () => {
    expect(USER_AGENT_PRESETS.chrome_windows).toBeDefined();
    expect(USER_AGENT_PRESETS.chrome_mac).toBeDefined();
    expect(USER_AGENT_PRESETS.chrome_linux).toBeDefined();
    expect(USER_AGENT_PRESETS.chrome_android).toBeDefined();
  });

  test('presets match their respective platforms', () => {
    expect(USER_AGENT_PRESETS.chrome_windows.platform).toBe('Win32');
    expect(USER_AGENT_PRESETS.chrome_mac.platform).toBe('MacIntel');
    expect(USER_AGENT_PRESETS.chrome_linux.platform).toBe('Linux x86_64');
    expect(USER_AGENT_PRESETS.chrome_android.platform).toBe('Linux armv8l');
  });
});
