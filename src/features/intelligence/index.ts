/**
 * Intelligence layer public API.
 */

export type { AddressUsageMap, AddressUsageSite } from './address-usage.js';
export { getAddressUsageDomains, getAddressUsageMap } from './address-usage.js';
export { buildAutofillPlan, getActiveInboxMeta } from './autofill-plan.js';
export { scoreForm, uniqueFieldKinds } from './form-score.js';
export { rememberIdentityForDomain, routeIdentityForDomain } from './identity-router.js';
export {
  getLifecycleForInbox,
  recomputeLifecycleFromStorage,
  recordInboxAutofill,
  recordInboxMailSignals,
  suggestLifecycleActions,
} from './inbox-lifecycle.js';
export {
  filterEmailsForNotification,
  getNotificationIntelligenceSettings,
  isInQuietHours,
  isOtpOrMagic,
} from './notification-policy.js';
export {
  getBestHealthyProvider,
  getProviderFailoverOrder,
  getProviderHealth,
  providerHealthScore,
  rankProvidersByHealth,
  recordProviderCreate,
  recordProviderFetch,
  resolveCreateProvider,
} from './provider-health.js';
export { recordAutofillOutcome, shouldPreferReplay } from './site-memory.js';
export type { SiteRule, SiteRuleMatch } from './site-rules.js';
export {
  clearArchiveSchedule,
  deleteSiteRule,
  getDueArchiveInboxIds,
  loadSiteRules,
  matchSiteRule,
  resolveRuleIdentityId,
  resolveRuleProviderId,
  saveSiteRules,
  scheduleArchiveFromRule,
  upsertSiteRule,
} from './site-rules.js';
export {
  getSiteProfile,
  loadIdentityStickyMap,
  loadInboxLifecycleMap,
  loadNotificationIntelligence,
  loadProviderHealthMap,
  loadSiteProfiles,
  normalizeDomain,
  saveNotificationIntelligence,
} from './storage.js';
export * from './types.js';
