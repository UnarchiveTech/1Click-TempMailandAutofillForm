/** Site-scoped controls that can be read by content scripts. */
export const SITE_PRIVACY_SETTINGS_KEY = 'sitePrivacySettings_v1';

export type SitePrivacyFeature = 'otpDetection' | 'formScanning';
export interface SitePrivacySettings {
  otpDetection: boolean;
  formScanning: boolean;
}
export type SitePrivacySettingsMap = Record<string, Partial<SitePrivacySettings>>;

export const DEFAULT_SITE_PRIVACY_SETTINGS: SitePrivacySettings = {
  otpDetection: true,
  formScanning: true,
};

const DISABLED_SITE_PRIVACY_SETTINGS: SitePrivacySettings = {
  otpDetection: false,
  formScanning: false,
};

/** A stable host key shared by the page UI, storage, and the background. */
export function normalizeSitePrivacyHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

export function readSitePrivacySettings(value: unknown, host: string): SitePrivacySettings {
  const normalizedHost = normalizeSitePrivacyHost(host);
  if (!normalizedHost || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_SITE_PRIVACY_SETTINGS };
  }
  const record = (value as Record<string, unknown>)[normalizedHost];
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return { ...DEFAULT_SITE_PRIVACY_SETTINGS };
  }
  const settings = record as Record<string, unknown>;
  return {
    otpDetection:
      typeof settings.otpDetection === 'boolean'
        ? settings.otpDetection
        : DEFAULT_SITE_PRIVACY_SETTINGS.otpDetection,
    formScanning:
      typeof settings.formScanning === 'boolean'
        ? settings.formScanning
        : DEFAULT_SITE_PRIVACY_SETTINGS.formScanning,
  };
}

/** Remove malformed entries before a background write. */
export function sanitizeSitePrivacySettingsMap(value: unknown): SitePrivacySettingsMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result = Object.create(null) as SitePrivacySettingsMap;
  for (const [host, rawSettings] of Object.entries(value)) {
    const normalizedHost = normalizeSitePrivacyHost(host);
    if (!normalizedHost || typeof rawSettings !== 'object' || rawSettings === null) continue;
    const settings = rawSettings as Record<string, unknown>;
    const clean: Partial<SitePrivacySettings> = {};
    if (typeof settings.otpDetection === 'boolean') clean.otpDetection = settings.otpDetection;
    if (typeof settings.formScanning === 'boolean') clean.formScanning = settings.formScanning;
    if (Object.keys(clean).length > 0) result[normalizedHost] = clean;
  }
  return result;
}

let cachedSiteSettings: Partial<SitePrivacySettings> = {};
let cachedSiteHost = '';

export function getCachedSitePrivacySettings(): SitePrivacySettings {
  return cachedSiteHost === normalizeSitePrivacyHost(location.hostname)
    ? { ...DEFAULT_SITE_PRIVACY_SETTINGS, ...cachedSiteSettings }
    : { ...DEFAULT_SITE_PRIVACY_SETTINGS };
}

/**
 * Content features that inspect page data must fail closed until this tab has
 * successfully loaded its site preferences from the background.
 */
export function getCachedSitePrivacySettingsOrDisabled(): SitePrivacySettings {
  return cachedSiteHost === normalizeSitePrivacyHost(location.hostname)
    ? { ...DEFAULT_SITE_PRIVACY_SETTINGS, ...cachedSiteSettings }
    : { ...DISABLED_SITE_PRIVACY_SETTINGS };
}

export function cacheSitePrivacySettings(settings: SitePrivacySettings): void {
  cachedSiteSettings = { ...settings };
  cachedSiteHost = normalizeSitePrivacyHost(location.hostname);
}

export function invalidateCachedSitePrivacySettings(): void {
  cachedSiteSettings = {};
  cachedSiteHost = '';
}
