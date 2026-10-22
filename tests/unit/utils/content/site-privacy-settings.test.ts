import { afterAll, describe, expect, test } from 'bun:test';
import {
  cacheSitePrivacySettings,
  getCachedSitePrivacySettings,
  invalidateCachedSitePrivacySettings,
} from '@/utils/content/site-privacy-settings.js';

const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');

function setHost(hostname: string): void {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { hostname },
  });
}

afterAll(() => {
  invalidateCachedSitePrivacySettings();
  if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
  else Reflect.deleteProperty(globalThis, 'location');
});

describe('site privacy settings cache', () => {
  test('site settings never carry over to another hostname', () => {
    setHost('first.example');
    cacheSitePrivacySettings({ otpDetection: false, formScanning: false });
    expect(getCachedSitePrivacySettings()).toEqual({ otpDetection: false, formScanning: false });

    setHost('second.example');
    expect(getCachedSitePrivacySettings()).toEqual({ otpDetection: true, formScanning: true });
  });

  test('invalidation drops a cached preference on the same site', () => {
    setHost('first.example');
    cacheSitePrivacySettings({ otpDetection: false, formScanning: false });
    invalidateCachedSitePrivacySettings();
    expect(getCachedSitePrivacySettings()).toEqual({ otpDetection: true, formScanning: true });
  });
});
