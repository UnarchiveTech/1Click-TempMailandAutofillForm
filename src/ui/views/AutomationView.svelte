<script lang="ts">
import { onMount } from 'svelte';
import { cubicOut } from 'svelte/easing';
import { slide } from 'svelte/transition';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import {
  type AllowlistEntryError,
  validateAllowlistInput,
} from '@/features/address/mailbox-rule-validation.js';
import type {
  MailboxRule,
  MailboxRuleAction,
  MailboxRuleField,
  MailboxRuleMatchStats,
} from '@/features/address/mailbox-rules.js';
import {
  hasMailboxRuleAction,
  hasSiteRuleAction,
  normalizeRuleDomain,
  validArchiveDays,
  validateMailboxRuleInput,
} from '@/features/intelligence/rule-validation.js';
import type { SiteRule } from '@/features/intelligence/site-rules.js';
import ConfirmDialog from '@/ui/blocks/dialogs/ConfirmDialog.svelte';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import FloatingAction from '@/ui/components/composites/FloatingAction.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import SearchFilterHeader from '@/ui/components/composites/SearchFilterHeader.svelte';
import Tabs from '@/ui/components/composites/Tabs.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn, Checkbox, Dropdown, InputField } from '@/ui/components/primitives';
import type { EmailLabelDef } from '@/utils/email/email-label-catalog.js';
import {
  getEmailLabelCatalog,
  labelColorFor,
  mergeLabelsIntoCatalog,
  setEmailLabelCatalog,
} from '@/utils/email/email-label-catalog.js';
import { getAllProviderConfigs } from '@/utils/email/email-service.js';
import { pluralMessage } from '@/utils/i18n/i18n-plural.js';
import { logError } from '@/utils/logger.js';
import {
  archivedEmailsByAddressKey,
  storedEmailsByAddressKey,
} from '@/utils/storage/storage-keys.js';
import { isUndoCurrent, markAddressMutation } from '@/utils/storage/undo-generation.js';
import { timeAgo } from '@/utils/time/time-format.js';
import type { Email, Identity } from '@/utils/types.js';
import { PORTAL_Z, PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import { useReducedMotion } from '@/utils/ui/reduced-motion.svelte.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { rowSurface } from '@/utils/ui/row-surface.js';
import { toastStore } from '@/utils/ui/toastStore.js';

const tabsIdPrefix = $props.id();

let {
  initialRecipient = '',
  initialSender = '',
}: {
  initialRecipient?: string;
  initialSender?: string;
} = $props();

// Only pre-fill the recipient on the FIRST Automation visit per session, so a
// returning user never has a half-typed form overwritten by the pre-fill.
// Module-level flag covers component remounts; storage.session covers page
// reloads within the same browser session.
const RULE_RECIPIENT_PREFILL_KEY = 'mailboxRulesRecipientPrefilled';
let recipientPrefilled = false;
/** Recipient value granted by the session prefill ('' = none). The form reset
 * restores exactly this value, so returning visits never re-prefill. */
let sessionRecipient = '';

// ── Tabs: Mailbox rules / Site rules ────────────────────────────────────────
type AutomationTab = 'mailbox' | 'sites';
let activeTabId = $state<AutomationTab>('mailbox');

// Add-rule dialogs - opened by the contextual FAB for the active tab.
let mailboxRuleDialogOpen = $state(false);
let siteRuleDialogOpen = $state(false);

// Delete-rule confirmation - guards against accidental taps on the Delete button.
// Supports both single-rule deletions and "Clear all" bulk deletions per tab.
let deleteConfirm = $state<
  | { kind: 'mailbox'; id: string; name: string }
  | { kind: 'sites'; id: string; name: string }
  | { kind: 'mailboxAll'; count: number }
  | { kind: 'sitesAll'; count: number }
  | null
>(null);

// Edit-rule targets - when set, the add dialogs pre-fill and save (upsert) in place.
let editingMailboxRuleId = $state<string | null>(null);
let editingSiteRuleId = $state<string | null>(null);

// Live search - narrows the active tab's rule list by sender, domain, or label.
let ruleSearch = $state('');

// Focused rule - keyboard shortcuts (E edit · D duplicate · Del delete) act on
// the rule row currently focused in the active tab's (filtered) list.
let focusedRuleId = $state<string | null>(null);

function focusRuleInList(
  list: ReadonlyArray<{ id: string }>,
  currentId: string | null,
  delta: -1 | 1
) {
  if (list.length === 0) return;
  let idx = currentId ? list.findIndex((r) => r.id === currentId) : -1;
  if (idx < 0) idx = delta > 0 ? -1 : 0;
  const next = Math.min(list.length - 1, Math.max(0, idx + delta));
  focusedRuleId = list[next].id;
  document.getElementById(`rule-row-${list[next].id}`)?.focus({ preventScroll: false });
}

function handleRuleShortcut(e: KeyboardEvent) {
  // Never hijack typing in the search box, dialog inputs, or dropdowns.
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return;
  }
  if (mailboxRuleDialogOpen || siteRuleDialogOpen || deleteConfirm) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // "/" focuses the rule search box (Gmail-style). Captured before the app's
  // global "/" handler so it never falls through to mailbox navigation.
  if (e.key === '/') {
    e.preventDefault();
    e.stopPropagation();
    const searchEl = document.querySelector<HTMLInputElement>('[data-rule-search]');
    searchEl?.focus();
    searchEl?.select?.();
    return;
  }

  const list = activeTabId === 'mailbox' ? filteredMailboxRules : filteredSiteRules;
  if (list.length === 0) return;

  // Arrow Up/Down move focus between the visible (filtered) rule rows.
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    focusRuleInList(list, focusedRuleId, e.key === 'ArrowUp' ? -1 : 1);
    return;
  }

  // Action shortcuts require a focused rule in the active tab's list.
  if (!focusedRuleId || !list.some((r) => r.id === focusedRuleId)) return;
  const key = e.key.toLowerCase();
  if (key !== 'e' && key !== 'd' && e.key !== 'Delete') return;
  const rule = list.find((r) => r.id === focusedRuleId);
  if (!rule) return;
  e.preventDefault();
  if (activeTabId === 'mailbox') {
    const mailboxRule = rule as MailboxRule;
    if (key === 'e') editMailboxRule(mailboxRule);
    else if (key === 'd') duplicateMailboxRule(mailboxRule);
    else deleteConfirm = { kind: 'mailbox', id: mailboxRule.id, name: mailboxRule.contains };
  } else {
    const siteRule = rule as SiteRuleRow;
    if (key === 'e') editSiteRule(siteRule);
    else if (key === 'd') duplicateSiteRule(siteRule);
    else deleteConfirm = { kind: 'sites', id: siteRule.id, name: siteRule.domainPattern };
  }
}

// Last active tab (Mailbox vs Site rules), persisted per browser session so
// Automation opens where you left off.
const ACTIVE_TAB_STORAGE_KEY = 'automationActiveTab';

async function loadActiveTab() {
  try {
    const res = (await browser.storage.session.get([ACTIVE_TAB_STORAGE_KEY])) as Record<
      string,
      unknown
    >;
    const val = res[ACTIVE_TAB_STORAGE_KEY];
    if (val === 'mailbox' || val === 'sites') activeTabId = val;
  } catch {
    /* ignore */
  }
}

async function persistActiveTab(tab: AutomationTab) {
  try {
    await browser.storage.session.set({ [ACTIVE_TAB_STORAGE_KEY]: tab });
  } catch {
    /* ignore */
  }
}

// Search query, persisted per browser session (debounced) so a filtered view
// survives view switches.
const RULE_SEARCH_STORAGE_KEY = 'automationRuleSearch';
let ruleSearchTimer: ReturnType<typeof setTimeout> | null = null;

async function loadRuleSearch() {
  try {
    const res = (await browser.storage.session.get([RULE_SEARCH_STORAGE_KEY])) as Record<
      string,
      unknown
    >;
    const val = res[RULE_SEARCH_STORAGE_KEY];
    if (typeof val === 'string') ruleSearch = val;
  } catch {
    /* ignore */
  }
}

function persistRuleSearchDebounced() {
  if (ruleSearchTimer) clearTimeout(ruleSearchTimer);
  ruleSearchTimer = setTimeout(() => {
    ruleSearchTimer = null;
    void browser.storage.session.set({ [RULE_SEARCH_STORAGE_KEY]: ruleSearch }).catch(() => {});
  }, 250);
}

$effect(() => {
  void ruleSearch;
  persistRuleSearchDebounced();
});

// Per-tab collapsed state, persisted per browser session so long rule lists
// stay navigable in the popup (survives view switches and reloads).
const COLLAPSED_STORAGE_KEY = 'automationRulesCollapsed';
let mailboxRulesCollapsed = $state(false);
const motionPreference = useReducedMotion();
let siteRulesCollapsed = $state(false);

async function loadCollapsedState() {
  try {
    const res = (await browser.storage.session.get([COLLAPSED_STORAGE_KEY])) as Record<
      string,
      unknown
    >;
    const val = res[COLLAPSED_STORAGE_KEY] as { mailbox?: boolean; sites?: boolean } | undefined;
    if (typeof val?.mailbox === 'boolean') mailboxRulesCollapsed = val.mailbox;
    if (typeof val?.sites === 'boolean') siteRulesCollapsed = val.sites;
  } catch {
    /* ignore */
  }
}

function toggleMailboxRulesCollapsed() {
  mailboxRulesCollapsed = !mailboxRulesCollapsed;
  void persistCollapsedState();
}

function toggleSiteRulesCollapsed() {
  siteRulesCollapsed = !siteRulesCollapsed;
  void persistCollapsedState();
}

async function persistCollapsedState() {
  try {
    await browser.storage.session.set({
      [COLLAPSED_STORAGE_KEY]: { mailbox: mailboxRulesCollapsed, sites: siteRulesCollapsed },
    });
  } catch {
    /* ignore */
  }
}

// ── Site rules (domain → identity / provider / auto-archive) ────────────────
/** Site rules: domain → identity / provider / auto-archive */
type SiteRuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  domainPattern: string;
  includeSubdomains?: boolean;
  identityId?: string | null;
  providerId?: string | null;
  autoArchiveDays?: number | null;
};
let siteRules = $state<SiteRuleRow[]>([]);
let newRuleDomain = $state('');
let newRuleIncludeSubdomains = $state(true);
let ruleFormError = $state('');
let savingRule = $state(false);
let previewWebsite = $state('');
let rulePreviewText = $state('');
let rulePreviewRows = $state<{ subject: string; conflict: string }[]>([]);
let testingRule = $state(false);
let newRuleIdentityId = $state('');
let newRuleProviderId = $state('');
let newRuleArchiveDays = $state(0);
let ruleIdentities = $state<Identity[]>([]);
let ruleProviders = $state<{ id: string; label: string }[]>([]);

async function loadSiteRulesData() {
  try {
    const { loadSiteRules } = await import('@/features/intelligence/site-rules.js');
    siteRules = await loadSiteRules();
    const idRes = (await browser.storage.local.get(['identities'])) as {
      identities?: Identity[];
    };
    ruleIdentities = idRes.identities || [];
    ruleProviders = getAllProviderConfigs().map((p) => ({
      id: p.id,
      label: p.displayName || p.name || p.id,
    }));
  } catch {
    /* ignore */
  }
}

function mailboxRuleMatchesSearch(rule: MailboxRule, q: string): boolean {
  return [
    rule.contains,
    rule.label,
    rule.forwardTo,
    ...(rule.recipientAllowlist ?? []),
    ...(rule.senderAllowlist ?? []),
  ].some((s) => s?.toLowerCase().includes(q));
}

function siteRuleMatchesSearch(rule: SiteRuleRow, q: string): boolean {
  const identityName = rule.identityId
    ? (ruleIdentities.find((i) => i.id === rule.identityId)?.name ?? '')
    : '';
  const providerLabel = rule.providerId
    ? (ruleProviders.find((p) => p.id === rule.providerId)?.label ?? '')
    : '';
  return [rule.domainPattern, identityName, providerLabel].some((s) => s.toLowerCase().includes(q));
}

let filteredMailboxRules = $derived.by(() => {
  const q = ruleSearch.trim().toLowerCase();
  if (!q) return mailboxRules;
  return mailboxRules.filter((r) => mailboxRuleMatchesSearch(r, q));
});

let filteredSiteRules = $derived.by(() => {
  const q = ruleSearch.trim().toLowerCase();
  if (!q) return siteRules;
  return siteRules.filter((r) => siteRuleMatchesSearch(r, q));
});

async function addSiteRule() {
  if (savingRule) return;
  const domain = newRuleDomain.trim();
  ruleFormError = !normalizeRuleDomain(domain)
    ? $t('automation.ruleInvalidDomain')
    : !validArchiveDays(newRuleArchiveDays)
      ? $t('automation.ruleInvalidDays')
      : !hasSiteRuleAction({
            identityId: newRuleIdentityId,
            providerId: newRuleProviderId,
            autoArchiveDays: newRuleArchiveDays,
          })
        ? $t('automation.ruleNoAction')
        : '';
  if (ruleFormError) return;
  if (
    (newRuleIdentityId && !ruleIdentities.some((identity) => identity.id === newRuleIdentityId)) ||
    (newRuleProviderId && !ruleProviders.some((provider) => provider.id === newRuleProviderId))
  ) {
    ruleFormError = $t('automation.ruleMissingReference');
    return;
  }
  savingRule = true;
  try {
    const { upsertSiteRule } = await import('@/features/intelligence/site-rules.js');
    const editingId = editingSiteRuleId;
    await upsertSiteRule({
      id: editingId ?? undefined,
      domainPattern: domain,
      name: domain,
      enabled: editingId
        ? (siteRules.find((rule) => rule.id === editingId)?.enabled ?? false)
        : true,
      includeSubdomains: newRuleIncludeSubdomains,
      identityId: newRuleIdentityId || null,
      providerId: newRuleProviderId || null,
      autoArchiveDays: newRuleArchiveDays > 0 ? newRuleArchiveDays : null,
    });
    await markAddressMutation();
    resetSiteRuleForm();
    await loadSiteRulesData();
    siteRuleDialogOpen = false;
    toastStore.success($t(editingId ? 'intelligence.ruleUpdated' : 'intelligence.ruleSaved'));
  } catch (e) {
    logError('Failed to save site rule', undefined, e instanceof Error ? e : new Error(String(e)));
    ruleFormError = ruleSaveError(e);
    toastStore.error(ruleFormError);
  } finally {
    savingRule = false;
  }
}

async function toggleSiteRule(id: string, enabled: boolean, control?: HTMLInputElement) {
  const row = siteRules.find((r) => r.id === id);
  if (!row) return;
  if (
    enabled &&
    (!hasSiteRuleAction(row) ||
      (row.identityId && !ruleIdentities.some((identity) => identity.id === row.identityId)) ||
      (row.providerId && !ruleProviders.some((provider) => provider.id === row.providerId)))
  ) {
    toastStore.error(
      !hasSiteRuleAction(row)
        ? $t('automation.ruleNoAction')
        : $t('automation.ruleMissingReference')
    );
    if (control) control.checked = row.enabled;
    return;
  }
  const previousEnabled = row.enabled;
  row.enabled = enabled;
  try {
    const { upsertSiteRule } = await import('@/features/intelligence/site-rules.js');
    await upsertSiteRule({ ...row, enabled, domainPattern: row.domainPattern });
    await markAddressMutation();
    await loadSiteRulesData();
  } catch (error) {
    if (row.enabled === enabled) row.enabled = previousEnabled;
    logError(
      'Failed to update site rule',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    toastStore.error($t('toasts.operationFailed'));
  }
}

async function removeSiteRule(rule: SiteRule, index: number) {
  focusedRuleId = null;
  try {
    const { deleteSiteRule, loadSiteRules, saveSiteRules } = await import(
      '@/features/intelligence/site-rules.js'
    );
    await deleteSiteRule(rule.id);
    await loadSiteRulesData();
    // The delete LANDED: invalidate older undos and stamp this one (shared
    // counter - a delete/import/domain-switch elsewhere also stales it).
    const undoRevision = await markAddressMutation();
    toastStore.success($t('intelligence.ruleDeleted'), undefined, async () => {
      if (!(await isUndoCurrent(undoRevision))) {
        toastStore.warning($t('toasts.undoSuperseded') as string);
        return;
      }
      const rules = await loadSiteRules();
      rules.splice(Math.min(index, rules.length), 0, rule);
      await saveSiteRules(rules);
      await loadSiteRulesData();
    });
  } catch (error) {
    logError(
      'Failed to delete site rule',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    toastStore.error($t('toasts.operationFailed'));
  }
}

// ── Mailbox rules (sender/subject/body match → label · auto-archive · silence) ─
const RULE_FIELD_OPTIONS: { value: MailboxRuleField; label: string }[] = $derived([
  { value: 'sender', label: $t('automation.ruleFieldSender') },
  { value: 'senderOrRecipient', label: $t('automation.ruleFieldSenderOrRecipient') },
  { value: 'recipient', label: $t('automation.ruleFieldRecipient') },
  { value: 'subject', label: $t('automation.ruleFieldSubject') },
  { value: 'body', label: $t('automation.ruleFieldBody') },
  { value: 'anywhere', label: $t('automation.ruleFieldAnywhere') },
]);

let mailboxRules = $state<MailboxRule[]>([]);
/** Per-rule match stats (count + last match), shown under each rule row. */
let mailboxRuleStats = $state<Record<string, MailboxRuleMatchStats>>({});
/** Label catalog with colors - drives the rule label color picker and row dots. */
let labelCatalog = $state<EmailLabelDef[]>([]);
let newRuleField = $state<MailboxRuleField>('sender');
let newRuleContains = $state('');
let newRuleRecipient = $state('');
let newRuleAllowlist = $state('');
let newRuleRecipientError = $state('');
let newRuleAllowlistError = $state('');
let newRuleLabel = $state('');
let newRuleLabelColor = $state('#6750a4');
/** False until the user edits the picker, so it can track the typed label's color. */
let newRuleLabelColorTouched = $state(false);
let newRuleArchiveInboxDays = $state(0);
let newRuleSilence = $state(false);
let newRuleAutoCopyOtp = $state(false);
let newRuleForwardTo = $state('');

const previewSignature = $derived(
  JSON.stringify([
    newRuleDomain,
    newRuleIncludeSubdomains,
    newRuleIdentityId,
    newRuleProviderId,
    newRuleArchiveDays,
    previewWebsite,
    newRuleField,
    newRuleContains,
    newRuleRecipient,
    newRuleAllowlist,
    newRuleLabel,
    newRuleArchiveInboxDays,
    newRuleSilence,
    newRuleAutoCopyOtp,
    newRuleForwardTo,
    editingMailboxRuleId,
    editingSiteRuleId,
    mailboxRuleDialogOpen,
    siteRuleDialogOpen,
  ])
);
$effect(() => {
  void previewSignature;
  rulePreviewText = '';
  rulePreviewRows = [];
});

async function previewRule() {
  if (testingRule) return;
  testingRule = true;
  const signature = previewSignature;
  try {
    if (siteRuleDialogOpen) {
      const { hostMatchesPattern } = await import('@/features/intelligence/site-rules.js');
      const host = normalizeRuleDomain(previewWebsite);
      if (!host || host.startsWith('*.')) {
        ruleFormError = $t('automation.ruleInvalidDomain');
        return;
      }
      const draft = {
        id: editingSiteRuleId ?? 'preview',
        enabled: true,
        domainPattern: newRuleDomain,
        includeSubdomains: newRuleIncludeSubdomains,
      };
      const candidates = siteRules.map((rule) => (rule.id === editingSiteRuleId ? draft : rule));
      if (!editingSiteRuleId) candidates.unshift(draft);
      const winner = candidates.find(
        (rule) =>
          rule.enabled &&
          hostMatchesPattern(host, rule.domainPattern, rule.includeSubdomains !== false)
      );
      if (signature !== previewSignature) return;
      rulePreviewText = winner
        ? $t('automation.rulePreviewWinner', { values: { rule: winner.domainPattern } })
        : $t('automation.rulePreviewNoMatch');
      if (winner && winner.id !== draft.id)
        rulePreviewRows = [{ subject: '', conflict: winner.domainPattern }];
    } else {
      const validation = validateMailboxRuleInput({
        contains: newRuleContains,
        field: newRuleField,
      });
      if (validation) {
        ruleFormError = ruleSaveError(new Error(validation));
        return;
      }
      const { matchMailboxRule } = await import('@/features/address/mailbox-rules.js');
      const snapshot = await browser.storage.local.get([
        'emailStorageAddressIndex',
        'storedEmails',
        'archivedEmails',
      ]);
      const index = snapshot.emailStorageAddressIndex as Record<string, string> | undefined;
      const bags = await browser.storage.local.get(
        Object.keys(index ?? {}).flatMap((id) => [
          storedEmailsByAddressKey(id),
          archivedEmailsByAddressKey(id),
        ])
      );
      const draft: MailboxRule = {
        id: editingMailboxRuleId ?? 'preview',
        name: newRuleContains,
        contains: newRuleContains,
        field: newRuleField,
        enabled: true,
        senderAllowlist: parseAllowlist(newRuleAllowlist),
        recipientAllowlist: parseAllowlist(newRuleRecipient),
        createdAt: 0,
        updatedAt: 0,
      };
      const candidates = mailboxRules.map((rule) =>
        rule.id === editingMailboxRuleId ? draft : rule
      );
      if (!editingMailboxRuleId) candidates.unshift(draft);
      const samples: { subject: string; conflict: string }[] = [];
      let count = 0;
      const inspect = (messages: unknown, address: string) => {
        if (!Array.isArray(messages)) return;
        for (const message of messages as Email[]) {
          if (!message || typeof message !== 'object') continue;
          const recipient = message.original_inbox || address;
          if (!matchMailboxRule(message, [draft], recipient)) continue;
          count++;
          const winner = matchMailboxRule(message, candidates, recipient);
          if (samples.length < 5)
            samples.push({
              subject: message.subject || $t('notifications.noSubject'),
              conflict: winner && winner.id !== draft.id ? winner.contains : '',
            });
        }
      };
      if (index && Object.keys(index).length) {
        for (const [id, address] of Object.entries(index)) {
          inspect(
            bags[storedEmailsByAddressKey(id)] ??
              (snapshot.storedEmails as Record<string, Email[]> | undefined)?.[address],
            address
          );
          inspect(
            bags[archivedEmailsByAddressKey(id)] ??
              (snapshot.archivedEmails as Record<string, Email[]> | undefined)?.[address],
            address
          );
        }
      } else {
        for (const map of [snapshot.storedEmails, snapshot.archivedEmails]) {
          if (map && typeof map === 'object')
            for (const [address, messages] of Object.entries(map)) inspect(messages, address);
        }
      }
      if (signature !== previewSignature) return;
      rulePreviewText = pluralMessage(
        $t,
        { oneKey: 'automation.rulePreviewCount', otherKey: 'automation.rulePreviewCountPlural' },
        count
      );
      rulePreviewRows = samples;
    }
    ruleFormError = '';
  } catch (error) {
    logError('Could not preview automation rule', error);
    ruleFormError = $t('toasts.operationFailed');
  } finally {
    testingRule = false;
  }
}

/** Parse a comma/whitespace-separated list of senders/domains into entries. */
function parseAllowlist(raw: string): string[] | undefined {
  const items = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function ruleFieldLabel(field: MailboxRuleField): string {
  if (field === 'senderOrRecipient') return $t('automation.ruleFieldSenderOrRecipient');
  if (field === 'recipient') return $t('automation.ruleFieldRecipient');
  if (field === 'subject') return $t('automation.ruleFieldSubject');
  if (field === 'body') return $t('automation.ruleFieldBody');
  if (field === 'anywhere') return $t('automation.ruleFieldAnywhere');
  return $t('automation.ruleFieldSender');
}

function completedActionLabel(action: MailboxRuleAction): string {
  switch (action) {
    case 'label':
      return $t('automation.ruleSucceededLabel');
    case 'archive':
      return $t('automation.ruleSucceededArchive');
    case 'silence':
      return $t('automation.ruleSucceededSilence');
    case 'copy':
      return $t('automation.ruleSucceededCopy');
    case 'forward':
      return $t('automation.ruleSucceededForward');
  }
}

async function loadMailboxRulesData() {
  try {
    const { loadMailboxRuleStats, loadMailboxRules } = await import(
      '@/features/address/mailbox-rules.js'
    );
    mailboxRules = await loadMailboxRules();
    mailboxRuleStats = await loadMailboxRuleStats();
  } catch {
    /* ignore */
  }
}

async function loadLabelCatalog() {
  try {
    labelCatalog = await getEmailLabelCatalog();
  } catch {
    labelCatalog = [];
  }
}

// Default the rule label color to the label's catalog/hash color until the
// user picks their own, so new labels get a distinct color without extra work.
$effect(() => {
  const label = newRuleLabel.trim();
  if (!label || newRuleLabelColorTouched) return;
  newRuleLabelColor = labelColorFor(labelCatalog, label);
});

function allowlistErrorMessage(code: AllowlistEntryError | undefined): string {
  switch (code) {
    case 'spaceAroundAt':
      return $t('automation.allowlistErrorSpaceAt');
    case 'multipleAt':
      return $t('automation.allowlistErrorMultipleAt');
    case 'missingDomain':
      return $t('automation.allowlistErrorMissingDomain');
    case 'missingTld':
      return $t('automation.allowlistErrorMissingTld');
    case 'invalidPrefix':
      return $t('automation.allowlistErrorPrefix');
    default:
      return '';
  }
}

async function addMailboxRule() {
  if (savingRule) return;
  const contains = newRuleContains.trim();
  const validation = validateMailboxRuleInput({
    contains,
    field: newRuleField,
    autoArchiveDays: newRuleArchiveInboxDays,
    forwardTo: newRuleForwardTo.trim(),
  });
  ruleFormError = validation
    ? ruleSaveError(new Error(validation))
    : !hasMailboxRuleAction({
          label: newRuleLabel,
          autoArchiveDays: newRuleArchiveInboxDays,
          silenceNotifications: newRuleSilence,
          autoCopyOtp: newRuleAutoCopyOtp,
          forwardTo: newRuleForwardTo,
        })
      ? $t('automation.ruleNoAction')
      : '';
  if (ruleFormError) return;
  // Validate allowlist inputs at save time so typos never get persisted.
  newRuleRecipientError = allowlistErrorMessage(
    newRuleRecipient.trim() ? validateAllowlistInput(newRuleRecipient)[0] : undefined
  );
  newRuleAllowlistError = allowlistErrorMessage(
    newRuleAllowlist.trim() ? validateAllowlistInput(newRuleAllowlist)[0] : undefined
  );
  if (newRuleRecipientError || newRuleAllowlistError) return;
  savingRule = true;
  try {
    const { upsertMailboxRule } = await import('@/features/address/mailbox-rules.js');
    const editingId = editingMailboxRuleId;
    await upsertMailboxRule({
      id: editingId ?? undefined,
      name: contains,
      enabled: editingId
        ? (mailboxRules.find((rule) => rule.id === editingId)?.enabled ?? false)
        : true,
      field: newRuleField,
      contains,
      recipientAllowlist: parseAllowlist(newRuleRecipient),
      senderAllowlist: parseAllowlist(newRuleAllowlist),
      label: newRuleLabel.trim() || undefined,
      autoArchiveDays: newRuleArchiveInboxDays > 0 ? newRuleArchiveInboxDays : null,
      silenceNotifications: newRuleSilence,
      autoCopyOtp: newRuleAutoCopyOtp,
      forwardTo: newRuleForwardTo.trim() || undefined,
    });
    await markAddressMutation();
    // Register the rule's label in the catalog with the picked color so mail
    // labeled by this rule renders in that color.
    const labelName = newRuleLabel.trim();
    if (labelName) {
      const merged = mergeLabelsIntoCatalog(labelCatalog, [labelName]);
      const withColor = merged.map((def) =>
        def.name.toLowerCase() === labelName.toLowerCase()
          ? { ...def, color: newRuleLabelColor }
          : def
      );
      labelCatalog = withColor;
      try {
        await setEmailLabelCatalog(withColor);
      } catch {
        /* label color write is non-fatal for the rule itself */
      }
    }
    resetMailboxRuleForm();
    await loadMailboxRulesData();
    mailboxRuleDialogOpen = false;
    toastStore.success($t(editingId ? 'automation.ruleUpdated' : 'automation.ruleSaved'));
  } catch (e) {
    logError('Failed to save inbox rule', undefined, e instanceof Error ? e : new Error(String(e)));
    ruleFormError = ruleSaveError(e);
    toastStore.error(ruleFormError);
  } finally {
    savingRule = false;
  }
}

async function toggleMailboxRule(id: string, enabled: boolean, control?: HTMLInputElement) {
  const row = mailboxRules.find((r) => r.id === id);
  if (!row) return;
  if (enabled && !hasMailboxRuleAction(row)) {
    toastStore.error($t('automation.ruleNoAction'));
    if (control) control.checked = row.enabled;
    return;
  }
  const previousEnabled = row.enabled;
  row.enabled = enabled;
  try {
    const { upsertMailboxRule } = await import('@/features/address/mailbox-rules.js');
    await upsertMailboxRule({ ...row, enabled, contains: row.contains });
    await markAddressMutation();
    await loadMailboxRulesData();
  } catch (error) {
    if (row.enabled === enabled) row.enabled = previousEnabled;
    logError(
      'Failed to update mailbox rule',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    toastStore.error($t('toasts.operationFailed'));
  }
}

async function removeMailboxRule(rule: MailboxRule, index: number) {
  focusedRuleId = null;
  try {
    const { deleteMailboxRule, loadMailboxRules, saveMailboxRules } = await import(
      '@/features/address/mailbox-rules.js'
    );
    await deleteMailboxRule(rule.id);
    await loadMailboxRulesData();
    // The delete LANDED: invalidate older undos and stamp this one (shared
    // counter - a delete/import/domain-switch elsewhere also stales it).
    const undoRevision = await markAddressMutation();
    toastStore.success($t('intelligence.ruleDeleted'), undefined, async () => {
      if (!(await isUndoCurrent(undoRevision))) {
        toastStore.warning($t('toasts.undoSuperseded') as string);
        return;
      }
      const rules = await loadMailboxRules();
      rules.splice(Math.min(index, rules.length), 0, rule);
      await saveMailboxRules(rules);
      await loadMailboxRulesData();
    });
  } catch (error) {
    logError(
      'Failed to delete inbox rule',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    toastStore.error($t('toasts.operationFailed'));
  }
}

async function moveMailboxRule(id: string, delta: -1 | 1) {
  try {
    const { moveMailboxRule } = await import('@/features/address/mailbox-rules.js');
    await moveMailboxRule(id, delta);
    await markAddressMutation();
    await loadMailboxRulesData();
  } catch (error) {
    logError(
      'Failed to reorder mailbox rule',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    toastStore.error($t('toasts.operationFailed'));
  }
}

async function moveSiteRule(id: string, delta: -1 | 1) {
  try {
    const { moveSiteRule } = await import('@/features/intelligence/site-rules.js');
    await moveSiteRule(id, delta);
    await markAddressMutation();
    await loadSiteRulesData();
  } catch (error) {
    logError('Failed to reorder site rule', error);
    toastStore.error($t('toasts.operationFailed'));
  }
}

function ruleSaveError(error: unknown): string {
  switch (error instanceof Error ? error.message : '') {
    case 'rule-limit-exceeded':
      return $t('automation.ruleLimit');
    case 'rule-invalid-domain':
      return $t('automation.ruleInvalidDomain');
    case 'rule-invalid-days':
      return $t('automation.ruleInvalidDays');
    case 'rule-invalid-match':
      return $t('automation.ruleInvalidMatch');
    case 'rule-invalid-forward':
      return $t('automation.ruleInvalidForward');
    default:
      return $t('intelligence.ruleSaveFailed');
  }
}

onMount(() => {
  // Pre-fill the recipient condition with the mailbox the user came from
  // (active inbox, or the address of the message they were reading) - but
  // only on the first Automation visit of this session. The sender prefill is
  // applied by resetMailboxRuleForm() whenever the add-rule dialog opens.
  void (async () => {
    const recipient = initialRecipient?.trim();
    if (!recipient || recipientPrefilled) return;
    try {
      const res = (await browser.storage.session.get([RULE_RECIPIENT_PREFILL_KEY])) as Record<
        string,
        unknown
      >;
      if (res[RULE_RECIPIENT_PREFILL_KEY]) {
        recipientPrefilled = true;
        return;
      }
      await browser.storage.session.set({ [RULE_RECIPIENT_PREFILL_KEY]: true });
    } catch {
      /* session storage unavailable → still pre-fill (fallback) */
    }
    recipientPrefilled = true;
    sessionRecipient = recipient;
    newRuleRecipient = recipient;
  })();
  void loadSiteRulesData();
  void loadMailboxRulesData();
  void loadLabelCatalog();
  void loadCollapsedState();
  void loadActiveTab();
  void loadRuleSearch();

  const onLabelCatalogChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes.emailLabelCatalog) void loadLabelCatalog();
    if (area === 'local' && (changes.mailboxRules || changes.mailboxRuleMatchStats))
      void loadMailboxRulesData();
    if (area === 'local' && (changes.siteRules || changes.identities || changes.providerInstances))
      void loadSiteRulesData();
  };
  browser.storage.onChanged.addListener(onLabelCatalogChanged);

  // Capture-phase so "/" (and rule shortcuts) run before AppLayout's global
  // keydown handler - otherwise "/" would fall through to mailbox search nav.
  window.addEventListener('keydown', handleRuleShortcut, { capture: true });
  return () => {
    window.removeEventListener('keydown', handleRuleShortcut, { capture: true });
    browser.storage.onChanged.removeListener(onLabelCatalogChanged);
    // Flush any pending debounced search write so the last keystroke survives.
    if (ruleSearchTimer) {
      clearTimeout(ruleSearchTimer);
      ruleSearchTimer = null;
      void browser.storage.session.set({ [RULE_SEARCH_STORAGE_KEY]: ruleSearch }).catch(() => {});
    }
  };
});

/** Matched/total counts for the active tab - feeds the search match counter. */
let visibleRuleCounts = $derived(
  activeTabId === 'mailbox'
    ? { matched: filteredMailboxRules.length, total: mailboxRules.length }
    : { matched: filteredSiteRules.length, total: siteRules.length }
);

// Dismiss a pending delete confirmation if its target is already gone before
// the user confirms - confirming a rule that no longer exists (or an
// already-empty list) is meaningless.
$effect(() => {
  const target = deleteConfirm;
  if (!target) return;
  if (target.kind === 'mailboxAll' && mailboxRules.length === 0) {
    deleteConfirm = null;
  } else if (target.kind === 'sitesAll' && siteRules.length === 0) {
    deleteConfirm = null;
  } else if (target.kind === 'mailbox' && !mailboxRules.some((r) => r.id === target.id)) {
    deleteConfirm = null;
  } else if (target.kind === 'sites' && !siteRules.some((r) => r.id === target.id)) {
    deleteConfirm = null;
  }
});

function resetMailboxRuleForm() {
  ruleFormError = '';
  editingMailboxRuleId = null;
  newRuleField = 'sender';
  newRuleContains = '';
  newRuleRecipient = '';
  newRuleAllowlist = '';
  newRuleLabel = '';
  newRuleLabelColor = '#6750a4';
  newRuleLabelColorTouched = false;
  newRuleArchiveInboxDays = 0;
  newRuleSilence = false;
  newRuleAutoCopyOtp = false;
  newRuleForwardTo = '';
  newRuleRecipientError = '';
  newRuleAllowlistError = '';
  // Re-apply the contextual sender prefill (always applied per email).
  const sender = initialSender?.trim();
  if (sender) {
    newRuleField = 'sender';
    newRuleContains = sender;
  }
  // Re-apply the session-based recipient prefill if it was granted.
  newRuleRecipient = sessionRecipient;
}

function resetSiteRuleForm() {
  ruleFormError = '';
  newRuleIncludeSubdomains = true;
  previewWebsite = '';
  editingSiteRuleId = null;
  newRuleDomain = '';
  newRuleIdentityId = '';
  newRuleProviderId = '';
  newRuleArchiveDays = 0;
}

function openRuleDialogForActiveTab() {
  if (activeTabId === 'mailbox') {
    resetMailboxRuleForm();
    mailboxRuleDialogOpen = true;
  } else {
    resetSiteRuleForm();
    siteRuleDialogOpen = true;
  }
}

function confirmDeleteRule() {
  if (!deleteConfirm) return;
  const target = deleteConfirm;
  if (target.kind === 'mailbox') {
    const idx = mailboxRules.findIndex((r) => r.id === target.id);
    if (idx >= 0) void removeMailboxRule(mailboxRules[idx], idx);
  } else if (target.kind === 'sites') {
    const idx = siteRules.findIndex((r) => r.id === target.id);
    if (idx >= 0) void removeSiteRule(siteRules[idx] as SiteRule, idx);
  } else if (target.kind === 'mailboxAll') {
    void clearAllMailboxRules();
  } else {
    void clearAllSiteRules();
  }
}

async function clearAllMailboxRules() {
  focusedRuleId = null;
  try {
    const { clearMailboxRuleStats, loadMailboxRules, saveMailboxRules } = await import(
      '@/features/address/mailbox-rules.js'
    );
    const snapshot = await loadMailboxRules();
    await saveMailboxRules([]);
    await clearMailboxRuleStats();
    await loadMailboxRulesData();
    // The clear LANDED: invalidate older undos and stamp this one (shared
    // counter - a delete/import/domain-switch elsewhere also stales it).
    const undoRevision = await markAddressMutation();
    toastStore.success($t('automation.ruleClearedAll'), undefined, async () => {
      if (!(await isUndoCurrent(undoRevision))) {
        toastStore.warning($t('toasts.undoSuperseded') as string);
        return;
      }
      await saveMailboxRules(snapshot);
      await loadMailboxRulesData();
    });
  } catch (error) {
    logError('Failed to clear all mailbox rules', error);
    toastStore.error($t('toasts.operationFailed'));
  }
}

async function clearAllSiteRules() {
  focusedRuleId = null;
  try {
    const { loadSiteRules, saveSiteRules } = await import('@/features/intelligence/site-rules.js');
    const snapshot = await loadSiteRules();
    await saveSiteRules([]);
    await loadSiteRulesData();
    // The clear LANDED: invalidate older undos and stamp this one (shared
    // counter - a delete/import/domain-switch elsewhere also stales it).
    const undoRevision = await markAddressMutation();
    toastStore.success($t('intelligence.ruleClearedAll'), undefined, async () => {
      if (!(await isUndoCurrent(undoRevision))) {
        toastStore.warning($t('toasts.undoSuperseded') as string);
        return;
      }
      await saveSiteRules(snapshot);
      await loadSiteRulesData();
    });
  } catch (error) {
    logError('Failed to clear all site rules', error);
    toastStore.error($t('toasts.operationFailed'));
  }
}

function populateMailboxRuleForm(rule: MailboxRule) {
  ruleFormError = '';
  newRuleField = rule.field;
  newRuleContains = rule.contains;
  newRuleRecipient = rule.recipientAllowlist?.join(', ') ?? '';
  newRuleAllowlist = rule.senderAllowlist?.join(', ') ?? '';
  newRuleLabel = rule.label ?? '';
  newRuleLabelColorTouched = false;
  newRuleArchiveInboxDays = rule.autoArchiveDays ?? 0;
  newRuleSilence = rule.silenceNotifications === true;
  newRuleAutoCopyOtp = rule.autoCopyOtp === true;
  newRuleForwardTo = rule.forwardTo ?? '';
  newRuleRecipientError = '';
  newRuleAllowlistError = '';
}

function editMailboxRule(rule: MailboxRule) {
  editingMailboxRuleId = rule.id;
  populateMailboxRuleForm(rule);
  mailboxRuleDialogOpen = true;
}

function duplicateMailboxRule(rule: MailboxRule) {
  // Copy the rule's values into a fresh add (no id → upsert creates a new rule).
  editingMailboxRuleId = null;
  populateMailboxRuleForm(rule);
  mailboxRuleDialogOpen = true;
}

function populateSiteRuleForm(rule: SiteRuleRow) {
  ruleFormError = '';
  newRuleDomain = rule.domainPattern;
  newRuleIncludeSubdomains = rule.includeSubdomains !== false;
  newRuleIdentityId = rule.identityId ?? '';
  newRuleProviderId = rule.providerId ?? '';
  newRuleArchiveDays = rule.autoArchiveDays ?? 0;
}

function editSiteRule(rule: SiteRuleRow) {
  editingSiteRuleId = rule.id;
  populateSiteRuleForm(rule);
  siteRuleDialogOpen = true;
}

function duplicateSiteRule(rule: SiteRuleRow) {
  // Copy the rule's values into a fresh add (no id → upsert creates a new rule).
  editingSiteRuleId = null;
  populateSiteRuleForm(rule);
  siteRuleDialogOpen = true;
}
</script>

<div class="scroll-frame flex flex-col h-full min-h-0 bg-md-surface text-md-on-surface">
  <!-- Tabs: Mailbox rules / Site rules - pill style like AddressesView/OrganizeView -->
  <div class="scroll-edge shrink-0 pt-3 pb-2">
    <Tabs
      idPrefix={tabsIdPrefix}
      ariaLabel={$t('nav.automation')}
      tabs={[
        {
          id: 'mailbox',
          label: $t('automation.mailboxRulesTitle'),
          badge: mailboxRules.length,
        },
        {
          id: 'sites',
          label: $t('intelligence.rulesTitle'),
          badge: siteRules.length,
        },
      ]}
      bind:activeTab={activeTabId}
      variant="pill"
      fullWidth
      showInSidebar={true}
      onchange={(id) => {
        focusedRuleId = null;
        if (id === 'mailbox' || id === 'sites') void persistActiveTab(id);
      }}
    />
  </div>

  <!-- Search / filter the active tab's rules - reusable search bar -->
  <div class="scroll-edge shrink-0 relative {PORTAL_Z_CLASS.chrome}">
    <SearchFilterHeader
      scope="automation"
      bind:value={ruleSearch}
      placeholder={$t('automation.searchRules')}
      ariaLabel={$t('automation.searchRules')}
      settingsStyle={true}
      showSlashButton={false}
      filteredCount={visibleRuleCounts.matched}
      totalCount={visibleRuleCounts.total}
      onChange={(v) => (ruleSearch = v)}
    />
    <p class="text-xs text-md-on-surface-variant mt-1">{$t('automation.ruleShortcutsHint')}</p>
  </div>

  <div
    id="{tabsIdPrefix}-panel-{activeTabId}"
    class="scroll-body scroll-body-framed flex-1 min-h-0 overflow-y-auto py-3 pb-24"
    role="tabpanel"
    aria-labelledby="{tabsIdPrefix}-tab-{activeTabId}"
    tabindex="0"
  >
    {#if activeTabId === 'mailbox'}
      <!-- Mailbox rules -->
      {#if mailboxRules.length === 0}
        <EmptyState
          icon="threads"
          title={$t('automation.ruleEmpty')}
          description={$t('automation.mailboxRulesHint')}
          compact
          fillParent
        />
      {:else}
        <div class="rounded-xl border border-md-outline-variant/20 bg-md-surface-container-low px-3 py-2.5 space-y-2">
          <div class="flex items-center justify-between gap-2">
            {#if mailboxRulesCollapsed}
              <p class="text-xs text-md-on-surface-variant">
                {$t('automation.mailboxRulesTitle')} · {mailboxRules.length}
              </p>
            {:else}
              <p class="text-xs text-md-on-surface-variant">{$t('automation.rulePriorityHint')}</p>
            {/if}
            <div class="flex flex-nowrap items-center gap-2 shrink-0" use:responsiveButtonLayout data-action-tier="XS">
              <button
                type="button"
                class="md-action h-8 flex items-center justify-center rounded-full text-md-on-surface-variant transition-colors"
                aria-label={mailboxRulesCollapsed ? $t('common.expand') : $t('common.collapse')}
                title={mailboxRulesCollapsed ? $t('common.expand') : $t('common.collapse')}
                aria-expanded={!mailboxRulesCollapsed}
                onclick={toggleMailboxRulesCollapsed}
              >
                <Icon
                  name="chevronRight"
                  class="w-4 h-4 rtl-flip transition-transform {mailboxRulesCollapsed ? '' : 'rotate-90'}"
                />
              </button>
              <button
                type="button"
                class="h-8 font-semibold text-md-error/80 hover:text-md-error transition-colors"
                onclick={() => (deleteConfirm = { kind: 'mailboxAll', count: mailboxRules.length })}
              >
                {$t('automation.ruleClearAll')}
              </button>
            </div>
          </div>
          {#if !mailboxRulesCollapsed}
            {#if filteredMailboxRules.length === 0}
              <p
                class="ui-support text-md-on-surface-variant text-center py-6"
                transition:slide={{ duration: motionPreference.enabled ? 0 : 180, easing: cubicOut }}
              >
                {$t('automation.ruleNoMatch')}
              </p>
            {:else}
          <div
            class="space-y-1.5"
            transition:slide={{ duration: motionPreference.enabled ? 0 : 180, easing: cubicOut }}
          >
            {#each filteredMailboxRules as rule (rule.id)}
              {@const fullIdx = mailboxRules.indexOf(rule)}
              <div
                id={`rule-row-${rule.id}`}
                role="button"
                tabindex="0"
                class="flex items-start gap-2 rounded-lg bg-md-surface/70 px-2 py-1.5 border border-md-outline-variant/20 cursor-default focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-2 {rowSurface(
                  { active: focusedRuleId === rule.id }
                )}"
                onfocus={() => (focusedRuleId = rule.id)}
                onclick={() => (focusedRuleId = rule.id)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).focus();
                    focusedRuleId = rule.id;
                  }
                }}
              >
                <label class="flex items-center pt-0.5 cursor-pointer shrink-0">
                  <Checkbox
                    checked={rule.enabled}
                    onchange={(e) => void toggleMailboxRule(rule.id, e.currentTarget.checked, e.currentTarget)}
                  />
                </label>
                <div class="flex flex-col items-center shrink-0 gap-0.5 pt-0.5">
                  <button
                    type="button"
                    class="md-action h-8 w-8 flex items-center justify-center rounded-full disabled:opacity-30 disabled:cursor-default text-md-on-surface-variant"
                    onclick={() => void moveMailboxRule(rule.id, -1)}
                    disabled={fullIdx === 0}
                    aria-label={$t('automation.ruleMoveUp')}
                    title={$t('automation.ruleMoveUp')}
                  >
                    <Icon name="chevronUp" class="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    class="md-action h-8 w-8 flex items-center justify-center rounded-full disabled:opacity-30 disabled:cursor-default text-md-on-surface-variant"
                    onclick={() => void moveMailboxRule(rule.id, 1)}
                    disabled={fullIdx === mailboxRules.length - 1}
                    aria-label={$t('automation.ruleMoveDown')}
                    title={$t('automation.ruleMoveDown')}
                  >
                    <Icon name="chevronDown" class="w-5 h-5" />
                  </button>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="ui-row-primary text-md-on-surface truncate">
                    {ruleFieldLabel(rule.field)} “{rule.contains}”
                  </div>
                  {#if mailboxRuleStats[rule.id]?.count}
                    <div class="text-xs text-md-primary truncate">
                      {pluralMessage(
                        $t,
                        {
                          oneKey: 'automation.ruleMatchedCount',
                          otherKey: 'automation.ruleMatchedCountPlural',
                        },
                        mailboxRuleStats[rule.id].count
                      )}
                      · {$t('automation.ruleLastMatch', {
                        values: { time: timeAgo(mailboxRuleStats[rule.id].lastMatchedAt) },
                      })}
                    </div>
                  {/if}
                  {#if mailboxRuleStats[rule.id]?.failedActions}
                    <div class="ui-support text-md-error">{pluralMessage($t,
                      { oneKey: 'automation.ruleFailedActions', otherKey: 'automation.ruleFailedActionsPlural' },
                      mailboxRuleStats[rule.id].failedActions ?? 0)}</div>
                  {/if}
                  {#if mailboxRuleStats[rule.id]?.lastSucceeded?.length}
                    <div class="ui-support text-md-on-surface-variant">{$t('automation.ruleSucceededActions', {
                      values: { actions: (mailboxRuleStats[rule.id].lastSucceeded ?? []).map(completedActionLabel).join(' · ') }
                    })}</div>
                  {/if}
                  <div class="text-xs text-md-on-surface/50 truncate">
                    {#if rule.recipientAllowlist?.length}
                      {$t('automation.ruleRecipientApplied', {
                        values: { list: rule.recipientAllowlist.join(', ') },
                      })}
                    {/if}
                    {#if rule.senderAllowlist?.length}
                      {#if rule.recipientAllowlist?.length} · {/if}
                      {$t('automation.ruleAllowlistApplied', {
                        values: { list: rule.senderAllowlist.join(', ') },
                      })}
                    {/if}
                    {#if rule.label}
                      {#if rule.recipientAllowlist?.length || rule.senderAllowlist?.length} · {/if}
                      <span
                        class="inline-block w-2 h-2 rounded-full me-1 align-middle shrink-0"
                        style="background-color: {labelColorFor(labelCatalog, rule.label)};"
                      ></span>
                      {$t('automation.ruleLabelApplied', { values: { label: rule.label } })}
                    {/if}
                    {#if rule.autoArchiveDays}
                      {#if rule.recipientAllowlist?.length || rule.senderAllowlist?.length || rule.label} · {/if}
                      {$t('automation.ruleArchiveApplied', {
                        values: { n: rule.autoArchiveDays },
                      })}
                    {/if}
                    {#if rule.silenceNotifications}
                      {#if rule.recipientAllowlist?.length || rule.senderAllowlist?.length || rule.label || rule.autoArchiveDays} · {/if}
                      {$t('automation.ruleSilenceApplied')}
                    {/if}
                    {#if rule.autoCopyOtp}
                      {#if rule.recipientAllowlist?.length || rule.senderAllowlist?.length || rule.label || rule.autoArchiveDays || rule.silenceNotifications}
                        ·
                      {/if}
                      {$t('automation.ruleAutoCopyOtpApplied')}
                    {/if}
                    {#if rule.forwardTo}
                      {#if rule.recipientAllowlist?.length || rule.senderAllowlist?.length || rule.label || rule.autoArchiveDays || rule.silenceNotifications || rule.autoCopyOtp}
                        ·
                      {/if}
                      {$t('automation.ruleForwardApplied', { values: { email: rule.forwardTo } })}
                    {/if}
                  </div>
                </div>
                <div class="flex flex-nowrap items-center gap-2 shrink-0" use:responsiveButtonLayout data-action-tier="XS">
                <button
                  type="button"
                  class="h-8 flex items-center justify-center rounded-full text-md-on-surface/60 hover:text-md-primary transition-colors"
                  aria-label={$t('common.edit')}
                  title={$t('common.edit')}
                  onclick={() => editMailboxRule(rule)}
                >
                  <Icon name="edit" class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="h-8 flex items-center justify-center rounded-full text-md-on-surface/60 hover:text-md-primary transition-colors"
                  aria-label={$t('common.duplicate')}
                  title={$t('common.duplicate')}
                  onclick={() => duplicateMailboxRule(rule)}
                >
                  <Icon name="contentCopy" class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="h-8 font-semibold text-md-error"
                  onclick={() =>
                    (deleteConfirm = { kind: 'mailbox', id: rule.id, name: rule.contains })
                  }
                >
                  {$t('common.delete')}
                </button>
                </div>
              </div>
            {/each}
          </div>
            {/if}
          {/if}
        </div>
      {/if}
    {:else}
      <!-- Site rules -->
      {#if siteRules.length === 0}
        <EmptyState
          icon="filter"
          title={$t('intelligence.rulesEmpty')}
          description={$t('intelligence.rulesHint')}
          compact
          fillParent
        />
      {:else}
        <div class="rounded-xl border border-md-outline-variant/20 bg-md-surface-container-low px-3 py-2.5 space-y-2">
          <div class="flex items-center justify-between gap-2">
            {#if siteRulesCollapsed}
              <p class="text-xs text-md-on-surface-variant">
                {$t('intelligence.rulesTitle')} · {siteRules.length}
              </p>
            {:else}
              <p class="text-xs text-md-on-surface-variant">{$t('automation.rulePriorityHint')}</p>
            {/if}
            <div class="flex flex-nowrap items-center gap-2 shrink-0" use:responsiveButtonLayout data-action-tier="XS">
              <button
                type="button"
                class="md-action h-8 flex items-center justify-center rounded-full text-md-on-surface-variant transition-colors"
                aria-label={siteRulesCollapsed ? $t('common.expand') : $t('common.collapse')}
                title={siteRulesCollapsed ? $t('common.expand') : $t('common.collapse')}
                aria-expanded={!siteRulesCollapsed}
                onclick={toggleSiteRulesCollapsed}
              >
                <Icon
                  name="chevronRight"
                  class="w-4 h-4 rtl-flip transition-transform {siteRulesCollapsed ? '' : 'rotate-90'}"
                />
              </button>
              <button
                type="button"
                class="h-8 font-semibold text-md-error/80 hover:text-md-error transition-colors"
                onclick={() => (deleteConfirm = { kind: 'sitesAll', count: siteRules.length })}
              >
                {$t('intelligence.ruleClearAll')}
              </button>
            </div>
          </div>
          {#if !siteRulesCollapsed}
            {#if filteredSiteRules.length === 0}
              <p
                class="ui-support text-md-on-surface-variant text-center py-6"
                transition:slide={{ duration: motionPreference.enabled ? 0 : 180, easing: cubicOut }}
              >
                {$t('intelligence.ruleNoMatch')}
              </p>
            {:else}
          <div
            class="space-y-1.5"
            transition:slide={{ duration: motionPreference.enabled ? 0 : 180, easing: cubicOut }}
          >
            {#each filteredSiteRules as rule (rule.id)}
              {@const fullIdx = siteRules.indexOf(rule)}
              <div
                id={`rule-row-${rule.id}`}
                role="button"
                tabindex="0"
                class="flex items-start gap-2 rounded-lg bg-md-surface/70 px-2 py-1.5 border border-md-outline-variant/20 cursor-default focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-2 {rowSurface(
                  { active: focusedRuleId === rule.id }
                )}"
                onfocus={() => (focusedRuleId = rule.id)}
                onclick={() => (focusedRuleId = rule.id)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).focus();
                    focusedRuleId = rule.id;
                  }
                }}
              >
                <label class="flex items-center pt-0.5 cursor-pointer shrink-0">
                  <Checkbox
                    checked={rule.enabled}
                    onchange={(e) => void toggleSiteRule(rule.id, e.currentTarget.checked, e.currentTarget)}
                  />
                </label>
                <div class="flex flex-col items-center shrink-0 gap-0.5 pt-0.5">
                  <button type="button" class="md-action h-8 w-8 flex items-center justify-center rounded-full disabled:opacity-30 disabled:cursor-default text-md-on-surface-variant"
                    onclick={() => void moveSiteRule(rule.id, -1)} disabled={fullIdx === 0}
                    aria-label={$t('automation.ruleMoveUp')} title={$t('automation.ruleMoveUp')}>
                    <Icon name="chevronUp" class="w-5 h-5" />
                  </button>
                  <button type="button" class="md-action h-8 w-8 flex items-center justify-center rounded-full disabled:opacity-30 disabled:cursor-default text-md-on-surface-variant"
                    onclick={() => void moveSiteRule(rule.id, 1)} disabled={fullIdx === siteRules.length - 1}
                    aria-label={$t('automation.ruleMoveDown')} title={$t('automation.ruleMoveDown')}>
                    <Icon name="chevronDown" class="w-5 h-5" />
                  </button>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="ui-row-primary text-md-on-surface truncate">{rule.domainPattern}</div>
                  <div class="text-xs text-md-on-surface/50 truncate">
                    {#if rule.identityId}
                      {$t('intelligence.ruleIdentityLabel')}:
                      {ruleIdentities.find((i) => i.id === rule.identityId)?.name || rule.identityId}
                    {/if}
                    {#if rule.providerId}
                      · {$t('intelligence.ruleProviderLabel')}:
                      {ruleProviders.find((p) => p.id === rule.providerId)?.label || rule.providerId}
                    {/if}
                    {#if rule.autoArchiveDays}
                      · {$t('intelligence.ruleArchiveLabel', {
                        values: { n: rule.autoArchiveDays },
                      })}
                    {/if}
                  </div>
                </div>
                <div class="flex flex-nowrap items-center gap-2 shrink-0" use:responsiveButtonLayout data-action-tier="XS">
                <button
                  type="button"
                  class="h-8 flex items-center justify-center rounded-full text-md-on-surface/60 hover:text-md-primary transition-colors"
                  aria-label={$t('common.edit')}
                  title={$t('common.edit')}
                  onclick={() => editSiteRule(rule)}
                >
                  <Icon name="edit" class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="h-8 flex items-center justify-center rounded-full text-md-on-surface/60 hover:text-md-primary transition-colors"
                  aria-label={$t('common.duplicate')}
                  title={$t('common.duplicate')}
                  onclick={() => duplicateSiteRule(rule)}
                >
                  <Icon name="contentCopy" class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="h-8 font-semibold text-md-error"
                  onclick={() =>
                    (deleteConfirm = { kind: 'sites', id: rule.id, name: rule.domainPattern })
                  }
                >
                  {$t('common.delete')}
                </button>
                </div>
              </div>
            {/each}
          </div>
            {/if}
          {/if}
        </div>
      {/if}
    {/if}
  </div>

  <!-- Contextual FAB: opens the add-rule dialog for the active tab -->
  <FloatingAction
    icon="add"
    labelKey={activeTabId === 'mailbox' ? 'automation.ruleAdd' : 'intelligence.ruleAdd'}
    onclick={openRuleDialogForActiveTab}
  />

  <!-- Add mailbox rule dialog -->
  <ModalDialog
    open={mailboxRuleDialogOpen}
    title={editingMailboxRuleId ? $t('common.edit') : $t('automation.mailboxRulesTitle')}
    subtitle={$t('automation.mailboxRulesHint')}
    maxWidth="lg"
    onClose={() => {
      mailboxRuleDialogOpen = false;
      editingMailboxRuleId = null;
    }}
  >
    {#snippet children()}
      <div class="dialog-content-stack">
        <div class="dialog-field-grid">
          <Dropdown
            class="min-w-0"
            label={$t('automation.ruleField')}
            size="sm"
            variant="outlined"
            ariaLabel={$t('automation.ruleField')}
            bind:value={newRuleField}
            options={RULE_FIELD_OPTIONS}
            zIndex={PORTAL_Z.dialogMenu}
          />
          <InputField
            type="text"
            label={$t('automation.ruleMatchText')}
            placeholder={$t('automation.ruleContainsPlaceholder')}
            bind:value={newRuleContains}
          />
          <InputField
            type="text"
            label={$t('automation.ruleRecipients')}
            placeholder={$t('automation.ruleRecipientPlaceholder')}
            bind:value={newRuleRecipient}
            error={newRuleRecipientError}
            oninput={() => {
              newRuleRecipientError = '';
            }}
          />
        </div>
        <div class="dialog-field-grid">
          <InputField
            type="text"
            label={$t('automation.ruleAllowedSenders')}
            placeholder={$t('automation.ruleAllowlistPlaceholder')}
            bind:value={newRuleAllowlist}
            error={newRuleAllowlistError}
            oninput={() => {
              newRuleAllowlistError = '';
            }}
          />
          <InputField
            type="email"
            label={$t('automation.ruleForwardTo')}
            placeholder={$t('automation.ruleForwardToPlaceholder')}
            bind:value={newRuleForwardTo}
          />
        </div>
        <div class="dialog-content-stack">
          {#if newRuleLabel.trim()}
            <input
              type="color"
              class="w-7 h-7 rounded-lg cursor-pointer border-0 p-0.5 bg-transparent shrink-0"
              bind:value={newRuleLabelColor}
              oninput={() => {
                newRuleLabelColorTouched = true;
              }}
              aria-label={$t('automation.ruleLabelColor')}
              title={$t('automation.ruleLabelColor')}
            />
          {/if}
          <InputField
            type="text"
            label={$t('automation.ruleLabelPlaceholder')}
            bind:value={newRuleLabel}
          />
          <InputField
            type="number"
            min="0"
            max="365"
            label={$t('automation.ruleArchiveDaysLabel')}
            bind:value={newRuleArchiveInboxDays}
          />
          <div class="dialog-section">
          <label
            class="flex items-center gap-1.5 px-1 text-sm text-md-on-surface-variant cursor-pointer select-none"
          >
            <Checkbox class="shrink-0" bind:checked={newRuleSilence} />
            <span class="whitespace-nowrap">{$t('automation.ruleSilence')}</span>
          </label>
          <label
            class="flex items-center gap-1.5 px-1 text-sm text-md-on-surface-variant cursor-pointer select-none"
          >
            <Checkbox class="shrink-0" bind:checked={newRuleAutoCopyOtp} />
            <span class="whitespace-nowrap">{$t('automation.ruleAutoCopyOtp')}</span>
          </label>
          </div>
        </div>
        {#if ruleFormError}<p class="ui-support text-md-error" role="alert">{ruleFormError}</p>{/if}
        {@render rulePreviewControls()}
        <Btn
          variant="primary"
          size="md"
          class="w-full"
          disabled={savingRule}
          onclick={() => void addMailboxRule()}
        >
          {editingMailboxRuleId ? $t('common.save') : $t('automation.ruleAdd')}
        </Btn>
      </div>
    {/snippet}
  </ModalDialog>

  <!-- Add site rule dialog -->
  <ModalDialog
    open={siteRuleDialogOpen}
    title={editingSiteRuleId ? $t('common.edit') : $t('intelligence.rulesTitle')}
    subtitle={$t('intelligence.rulesHint')}
    maxWidth="sm"
    onClose={() => {
      siteRuleDialogOpen = false;
      editingSiteRuleId = null;
    }}
  >
    {#snippet children()}
      <div class="dialog-content-stack">
        <InputField
          type="text"
          label={$t('intelligence.ruleDomainLabel')}
          placeholder={$t('intelligence.ruleDomainPlaceholder')}
          bind:value={newRuleDomain}
        />
        <label class="flex items-center gap-2 ui-label text-md-on-surface-variant">
          <Checkbox bind:checked={newRuleIncludeSubdomains} />
          <span>{$t('automation.ruleIncludeSubdomains')}</span>
        </label>
        <div class="dialog-content-stack">
          <Dropdown
            class="min-w-0"
            label={$t('intelligence.ruleIdentityLabel')}
            size="sm"
            variant="outlined"
            ariaLabel={$t('intelligence.ruleAnyIdentity')}
            bind:value={newRuleIdentityId}
            options={[
              { value: '', label: $t('intelligence.ruleAnyIdentity') },
              ...ruleIdentities.map((id) => ({ value: id.id, label: id.name })),
            ]}
            zIndex={PORTAL_Z.dialogMenu}
          />
          <Dropdown
            class="min-w-0"
            label={$t('intelligence.ruleProviderLabel')}
            size="sm"
            variant="outlined"
            ariaLabel={$t('intelligence.ruleAnyProvider')}
            bind:value={newRuleProviderId}
            options={[
              { value: '', label: $t('intelligence.ruleAnyProvider') },
              ...ruleProviders.map((p) => ({ value: p.id, label: p.label })),
            ]}
            zIndex={PORTAL_Z.dialogMenu}
          />
          <InputField
            type="number"
            min="0"
            max="365"
            label={$t('intelligence.ruleArchiveDays')}
            bind:value={newRuleArchiveDays}
          />
        </div>
        {#if ruleFormError}<p class="ui-support text-md-error" role="alert">{ruleFormError}</p>{/if}
        <InputField label={$t('automation.rulePreviewWebsite')} bind:value={previewWebsite} />
        {@render rulePreviewControls()}
        <Btn
          variant="primary"
          size="md"
          class="w-full"
          disabled={savingRule}
          onclick={() => void addSiteRule()}
        >
          {editingSiteRuleId ? $t('common.save') : $t('intelligence.ruleAdd')}
        </Btn>
      </div>
    {/snippet}
  </ModalDialog>

  {#snippet rulePreviewControls()}
    <div class="dialog-section">
      <Btn variant="secondary" size="sm" disabled={testingRule || savingRule} onclick={() => void previewRule()}>{$t('automation.rulePreview')}</Btn>
      <p class="ui-support text-md-on-surface-variant">{$t('automation.rulePreviewHint')}</p>
      {#if rulePreviewText}
        <div aria-live="polite" class="dialog-section ui-support">
          <p>{rulePreviewText}</p>
          {#each rulePreviewRows as row}
            <div>
              {#if row.subject}<p class="truncate">{row.subject}</p>{/if}
              {#if row.conflict}<p class="text-md-error">{$t('automation.rulePreviewConflict', { values: { rule: row.conflict } })}</p>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/snippet}

  <!-- Delete-rule confirmation -->
  <ConfirmDialog
    confirmDialog={deleteConfirm
      ? {
          title:
            deleteConfirm.kind === 'mailbox' || deleteConfirm.kind === 'mailboxAll'
              ? $t('automation.mailboxRulesTitle')
              : $t('intelligence.rulesTitle'),
          message:
            deleteConfirm.kind === 'mailboxAll'
              ? $t('automation.ruleClearAllConfirm', {
                  values: { n: deleteConfirm.count },
                })
              : deleteConfirm.kind === 'sitesAll'
                ? $t('intelligence.ruleClearAllConfirm', {
                    values: { n: deleteConfirm.count },
                  })
                : deleteConfirm.kind === 'mailbox'
                  ? $t('automation.ruleDeleteConfirm', {
                      values: { name: deleteConfirm.name },
                    })
                  : $t('intelligence.ruleDeleteConfirm', {
                      values: { name: deleteConfirm.name },
                    }),
          confirmLabel: $t('common.delete'),
          onConfirm: confirmDeleteRule,
          destructive: true,
        }
      : null}
    onClose={() => (deleteConfirm = null)}
  />
</div>
