import { describe, expect, test } from 'bun:test';
import nativeConfig from '../../../playwright.config';
import mirrorConfig from '../../../playwright.mirror.config';

describe('browser scenario discovery parity', () => {
  test('every engine schedules the native Chrome scenario directory without file exclusions', () => {
    expect(mirrorConfig.testDir).toBe(nativeConfig.testDir);
    expect(mirrorConfig.testMatch).toBe(nativeConfig.testMatch);
    expect(mirrorConfig.testIgnore).toBeUndefined();
    for (const project of mirrorConfig.projects ?? []) {
      expect(project.testDir).toBeUndefined();
      expect(project.testMatch).toBeUndefined();
      expect(project.testIgnore).toBeUndefined();
      expect(project.metadata?.preview).toBe(true);
      expect(project.metadata?.lane).toBe('engine-preview');
    }
  });

  test('each build is paired with its corresponding browser engine', () => {
    expect(
      mirrorConfig.projects?.map((project) => ({
        target: project.metadata?.target,
        engine: project.use?.browserName,
      }))
    ).toEqual([
      { target: 'chrome', engine: 'chromium' },
      { target: 'firefox', engine: 'firefox' },
      { target: 'safari', engine: 'webkit' },
    ]);
  });
});
