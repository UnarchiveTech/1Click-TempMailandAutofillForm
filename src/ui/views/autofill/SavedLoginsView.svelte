<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { registerEscapeTier } from '@/features/keyboard-shortcuts/escape-stack.js';
import {
  auditLoginHealth,
  type LoginHealthIssue,
  type LoginHealthIssueKind,
  type LoginHealthSeverity,
} from '@/features/login-info/login-auditor.js';
import { setPolicyReviewed } from '@/features/login-info/policy-review.js';
import ConfirmDialog from '@/ui/blocks/dialogs/ConfirmDialog.svelte';
import RelatedMessagesDialog from '@/ui/blocks/dialogs/RelatedMessagesDialog.svelte';
import CopyButton from '@/ui/components/composites/CopyButton.svelte';
import DragHint from '@/ui/components/composites/DragHint.svelte';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import SearchBar from '@/ui/components/composites/SearchBar.svelte';
import SearchFilterHeader from '@/ui/components/composites/SearchFilterHeader.svelte';
import TotpBadge from '@/ui/components/composites/TotpBadge.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Checkbox } from '@/ui/components/primitives';
import Badge from '@/ui/components/primitives/Badge.svelte';
import FaviconImage from '@/ui/components/primitives/FaviconImage.svelte';
import { downloadCSV, exportLoginsToBitwardenCSV } from '@/utils/email/csv-export.js';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import {
  getVaultConfig,
  isVaultLocked,
  unlockVaultWithBiometrics,
  unlockVaultWithPassword,
} from '@/utils/storage/vault-lock.js';
import { formatCompactDuration, localDateStamp } from '@/utils/time/time-format.js';
import type { Address, CredentialsHistoryItem, Identity } from '@/utils/types.js';
import { anchoredFlyout } from '@/utils/ui/anchored-flyout.js';
import { AVATAR_BOX, AVATAR_INK } from '@/utils/ui/avatar-size.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { keyboardReorder } from '@/utils/ui/keyboard-reorder.js';
import { PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import {
  controlSurface,
  type RowInkRole,
  rowInk,
  rowSurface,
  rowSurfaceState,
} from '@/utils/ui/row-surface.js';
import type {
  ListSelectionState,
  SelectionActionId,
  SelectionApi,
} from '@/utils/ui/selection-api.js';
import { publishSelectionSurface } from '@/utils/ui/selection-registry.js';
import { focusedRowId, moveRowCursor } from '@/utils/ui/selection-row-cursor.js';
import LoginHealthScorecard from './LoginHealthScorecard.svelte';
import {
  healthChipClass,
  LOGIN_HEALTH_KIND_ICON,
  LOGIN_HEALTH_KIND_LABEL_KEY,
  LOGIN_HEALTH_SEVERITY_TONE,
  type LoginHealthSummary,
} from './login-health-ui.js';

let {
  context = 'popup',
  onBack = () => {},
  savedLogins = [],
  allAddresses = [] as Address[],
  onDelete = () => {},
  showToast = (_msg: string) => {},
  identities = [] as Identity[],
  onReorder = (_sourceId: string, _targetId: string) => {},
  /** Pre-applied email filter (e.g. from message detail) */
  initialEmailFilter = '',
  filterIdentityId = $bindable<string | null>(null),
  initialWebsiteFilter = '',
  websiteFilterSignal = 0,
  /** Bump to focus the search field (ghost FAB) */
  focusSearchSignal = 0,
  /** Bumped when the background locks the vault → re-read lock state */
  vaultLockSignal = 0,
}: {
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  savedLogins?: CredentialsHistoryItem[];
  /** All mailboxes (incl. archived/deleted/expired) - powers the health auditor. */
  allAddresses?: Address[];
  onDelete?: (id: string) => void;
  showToast?: (message: string) => void;
  identities?: Identity[];
  /** Reorder by stable login id (not filtered list index) */
  onReorder?: (
    sourceId: string,
    targetId: string,
    contextLogins?: CredentialsHistoryItem[]
  ) => void;
  initialEmailFilter?: string;
  filterIdentityId?: string | null;
  initialWebsiteFilter?: string;
  websiteFilterSignal?: number;
  focusSearchSignal?: number;
  vaultLockSignal?: number;
} = $props();

let isLocked = $state(false);
let vaultMode = $state<'standard' | 'password' | 'biometrics'>('standard');
let unlockPassword = $state('');
let unlockError = $state('');
let unlocking = $state(false);
let searchRootEl = $state<HTMLElement | null>(null);
/** Local checklist: which policy URLs the user marked as reviewed */
let policyReviewed = $state<Record<string, boolean>>({});
let pendingPolicyReviews = $state(new Set<string>());

async function savePolicyReview(key: string, reviewed: boolean) {
  if (pendingPolicyReviews.has(key)) return;
  const previous = policyReviewed[key] ?? false;
  pendingPolicyReviews = new Set([...pendingPolicyReviews, key]);
  policyReviewed = { ...policyReviewed, [key]: reviewed };
  try {
    await setPolicyReviewed(key, reviewed);
  } catch (error) {
    // Roll back only this checkbox, preserving other changes still in flight.
    policyReviewed = { ...policyReviewed, [key]: previous };
    logError('Failed to persist policy review state', error);
    showToast($t('toasts.operationFailed'));
  } finally {
    pendingPolicyReviews = new Set([...pendingPolicyReviews].filter((pending) => pending !== key));
  }
}
let selectionMode = $state(false);
let selectedLoginIds = $state<Set<string>>(new Set());
let detailsLoginId = $state<string | null>(null);
let relatedLogin = $state<Pick<CredentialsHistoryItem, 'id' | 'domain' | 'email'> | null>(null);
$effect(() => {
  if (
    isLocked ||
    (relatedLogin &&
      !savedLogins.some(
        (login: CredentialsHistoryItem) =>
          login.id === relatedLogin?.id &&
          login.domain === relatedLogin?.domain &&
          login.email === relatedLogin?.email
      ))
  )
    relatedLogin = null;
});

function toggleLoginDetails(id: string) {
  detailsLoginId = id;
}

$effect(() => {
  if (isLocked || (detailsLoginId && !savedLogins.some((login) => login.id === detailsLoginId)))
    detailsLoginId = null;
});

function exitSelectionMode() {
  selectionMode = false;
  selectedLoginIds = new Set();
}

// Escape tier: an active multi-select is a transient surface - Escape drops it
// rather than navigating away from the logins the user just ticked.
$effect(() => {
  if (!selectionMode || selectedLoginIds.size === 0) return;
  return registerEscapeTier('logins.selection', exitSelectionMode);
});

/** Remove every ticked login, under the same storage lock the list already uses. */
async function deleteSelectedLogins(): Promise<void> {
  const ids = new Set(selectedLoginIds);
  if (ids.size === 0) return;
  exitSelectionMode();
  await withLock('login_info_lock', async () => {
    const res = (await browser.storage.local.get(['loginInfo'])) as {
      loginInfo?: CredentialsHistoryItem[];
    };
    const loginInfo = res.loginInfo || [];
    const updated = loginInfo.filter((l) => !ids.has(l.id || ''));
    await writeWithRetry({ loginInfo: updated });
  });
}

// Published to the SHELL's one strip (`ListSelectionBar`): this view keeps its
// selection, the shell renders the button that acts on it.
const selectionState = $derived.by<ListSelectionState>(() => ({
  active: selectionMode && selectedLoginIds.size > 0,
  count: selectedLoginIds.size,
  actions: loginsSelectionActions,
  allMatched: filteredLogins.length > 0 && selectedLoginIds.size >= filteredLogins.length,
  matchingTotal: filteredLogins.length,
  universeCounted: true,
}));

/** Deleting is the only bulk action a saved login has. */
const loginsSelectionActions: SelectionActionId[] = ['delete'];

/**
 * Tick or untick ONE login. The row's disc button and the keyboard's `X` both
 * come through here, so the two cannot disagree about what a tick means - the
 * disc used to carry this inline.
 */
function setLoginSelected(id: string | null | undefined, selected: boolean): void {
  if (!id || selected === selectedLoginIds.has(id)) return;
  if (selected) selectionMode = true;
  const next = new Set(selectedLoginIds);
  if (selected) next.add(id);
  else next.delete(id);
  selectedLoginIds = next;
  // Un-ticking the last row leaves nothing to act on: drop the mode with it, so
  // the strip goes away rather than reporting a selection of zero.
  if (selectedLoginIds.size === 0) selectionMode = false;
}

const selectionApi: SelectionApi = {
  cancel: () => exitSelectionMode(),
  selectAll: () => {
    selectionMode = true;
    selectedLoginIds = new Set(
      filteredLogins.map((l: CredentialsHistoryItem) => l.id).filter(Boolean) as string[]
    );
  },
  deselectAll: () => exitSelectionMode(),
  run: (action) => (action === 'delete' ? deleteSelectedLogins() : undefined),
  // Keyboard: the cursor is DOM focus on the row (`data-selectable-row`).
  moveFocus: (delta) => void moveRowCursor(credentialsScrollEl, delta),
  hasFocusedRow: () => focusedRowId(credentialsScrollEl) !== null,
  focusedIsSelected: () => {
    const id = focusedRowId(credentialsScrollEl);
    return id !== null && selectedLoginIds.has(id);
  },
  setFocusedSelected: (selected) => setLoginSelected(focusedRowId(credentialsScrollEl), selected),
};

$effect(() =>
  publishSelectionSurface({ surface: 'logins', state: selectionState, api: selectionApi })
);
/** Health-issue kind filter toggled from the scorecard rows / per-login chips. */
let healthIssueKind = $state<LoginHealthIssueKind | null>(null);
/** Empty-array sentinel so `{@const}` lookups never allocate per row. */
const NO_ISSUES: LoginHealthIssue[] = [];

$effect(() => {
  if (!focusSearchSignal) return;
  // Focus search input when ghost FAB is pressed
  queueMicrotask(() => {
    if (!searchRootEl?.isConnected) return;
    const input = searchRootEl.querySelector<HTMLInputElement>('input');
    input?.focus();
  });
});

async function checkLockStatus() {
  const config = await getVaultConfig();
  vaultMode = config.mode;
  isLocked = await isVaultLocked();
}

$effect(() => {
  // The background broadcasts 'vaultLocked' when auto-lock/rotation wipes the
  // session key; re-read lock state so this view exits its unlocked render.
  if (!vaultLockSignal) return;
  void checkLockStatus();
});

onMount(() => {
  void checkLockStatus();
  void (async () => {
    try {
      const res = (await browser.storage.local.get([
        'policyReviewedMap',
        'dragHintSeen_savedLoginInfo',
      ])) as {
        policyReviewedMap?: Record<string, boolean>;
        dragHintSeen_savedLoginInfo?: boolean;
      };
      if (res.policyReviewedMap) policyReviewed = res.policyReviewedMap;
      if (res.dragHintSeen_savedLoginInfo) dragHintDismissed = true;
    } catch {
      /* ignore */
    }
  })();
});

async function handleUnlockPassword() {
  unlockError = '';
  if (!unlockPassword) return;
  unlocking = true;
  const result = await unlockVaultWithPassword(unlockPassword);
  unlocking = false;
  if (result.success) {
    isLocked = false;
    unlockPassword = '';
    showToast($t('savedLoginInfo.vaultUnlocked'));
  } else if (result.lockedOutUntil) {
    // Shared localized countdown - the s/m/h tokens live in the time locale keys.
    const remainStr = formatCompactDuration(result.lockedOutUntil - Date.now());
    unlockError = $t('savedLoginInfo.vaultLockedOut', { values: { time: remainStr } });
  } else {
    unlockError = $t('savedLoginInfo.incorrectPassword');
  }
}

async function handleUnlockBiometrics() {
  unlockError = '';
  unlocking = true;
  const success = await unlockVaultWithBiometrics();
  unlocking = false;
  if (success) {
    isLocked = false;
    showToast($t('savedLoginInfo.vaultUnlocked'));
  } else {
    unlockError = $t('savedLoginInfo.biometricVerificationFailed');
  }
}

// Built once per locale instead of once per row per render: the saved-login rows
// call formatTimestamp twice each, and constructing an `Intl.RelativeTimeFormat`
// (not formatting with it) is the expensive half of that call.
let relativeTimeFormat = $derived(
  new Intl.RelativeTimeFormat($locale || 'en', { numeric: 'auto', style: 'short' })
);

function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60000);
  const rtf = relativeTimeFormat;
  if (mins < 1) return rtf.format(0, 'minute');
  if (mins < 60) return rtf.format(-mins, 'minute');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 7) return rtf.format(-days, 'day');
  return new Date(ts).toLocaleDateString($locale || 'en');
}

function getDomain(login: CredentialsHistoryItem): string {
  try {
    const site = (login.website as string | undefined) || login.domain || '';
    return site.startsWith('http') ? new URL(site).hostname : site;
  } catch {
    /* ignore */
    return login.domain || '';
  }
}

let csvExportConfirmOpen = $state(false);

function handleExportCSV() {
  if (savedLogins.length === 0) {
    showToast($t('savedLoginInfo.noSavedLogin'));
    return;
  }
  csvExportConfirmOpen = true;
}

function confirmExportCSV() {
  csvExportConfirmOpen = false;
  const csv = exportLoginsToBitwardenCSV(savedLogins);
  downloadCSV(csv, `1click-logins-${localDateStamp()}.csv`);
  showToast($t('toasts.dataExportedSuccessfully'));
}

let searchQuery = $state('');
let debouncedQuery = $state('');
let searchTimeout: ReturnType<typeof setTimeout>;

$effect(() => {
  const query = searchQuery;
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    debouncedQuery = query;
  }, 150);
});

// A pending debounce must not write filtered state into an unmounted view.
onDestroy(() => {
  if (searchTimeout) clearTimeout(searchTimeout);
});

let filterEmail = $state('');
let filterDropdownOpen = $state(false);
let filterEmailDropdownOpen = $state(false);
let searchFocused = $state(false);

$effect(() => {
  if (initialEmailFilter) filterEmail = initialEmailFilter;
});

let lastWebsiteFilterSignal = 0;
$effect(() => {
  if (websiteFilterSignal > 0 && websiteFilterSignal !== lastWebsiteFilterSignal) {
    lastWebsiteFilterSignal = websiteFilterSignal;
    searchQuery = initialWebsiteFilter;
    filterIdentityId = null;
    if (!initialEmailFilter) filterEmail = '';
  }
});

let draggedLoginId = $state<string | null>(null);
let dropTargetLoginId = $state<string | null>(null);

function handleLoginDragStart(e: DragEvent, loginId: string) {
  if (searchQuery.trim() || filterIdentityId || filterEmail || healthIssueKind) {
    e.preventDefault();
    return;
  }
  draggedLoginId = loginId;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', loginId);
  }
}

let dragHintDismissed = $state(false);
function handleLoginDragHintDismiss(): void {
  dragHintDismissed = true;
  void writeWithRetry({ dragHintSeen_savedLoginInfo: true });
}

function handleLoginDragOver(e: DragEvent, loginId: string) {
  if (!draggedLoginId || draggedLoginId === loginId) return;
  e.preventDefault();
  dropTargetLoginId = loginId;
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

function handleLoginDragLeave(loginId: string) {
  if (dropTargetLoginId === loginId) {
    dropTargetLoginId = null;
  }
}

function handleLoginDrop(e: DragEvent, targetId: string, groupLogins?: CredentialsHistoryItem[]) {
  e.preventDefault();
  const sourceId = draggedLoginId;
  draggedLoginId = null;
  dropTargetLoginId = null;
  if (!sourceId || sourceId === targetId) return;
  // Parent resolves ids against full loginInfo storage (not filteredLogins indices)
  onReorder(sourceId, targetId, groupLogins);
}

function handleLoginDragEnd() {
  draggedLoginId = null;
  dropTargetLoginId = null;
}

/** Per-login health reports (id → report) from auditLoginHealth(). */
const loginReports = $derived.by(() => {
  const map = new Map<string, { score: number; issues: LoginHealthIssue[] }>();
  for (const login of savedLogins) {
    const id = login.id || '';
    if (!id) continue;
    map.set(id, auditLoginHealth(login, savedLogins, allAddresses));
  }
  return map;
});

/** Whole-vault aggregate consumed by the health scorecard. */
const healthSummary = $derived.by((): LoginHealthSummary => {
  if (savedLogins.length === 0) {
    return { score: 100, total: 0, atRisk: 0, kinds: [] };
  }
  let scoreSum = 0;
  let atRisk = 0;
  const counts = new Map<LoginHealthIssueKind, { severity: LoginHealthSeverity; count: number }>();
  for (const login of savedLogins) {
    const report = loginReports.get(login.id || '');
    if (!report) continue;
    scoreSum += report.score;
    if (report.issues.length > 0) atRisk += 1;
    const kindsSeen = new Set<LoginHealthIssueKind>();
    for (const issue of report.issues) {
      if (kindsSeen.has(issue.kind)) continue;
      kindsSeen.add(issue.kind);
      const prev = counts.get(issue.kind);
      counts.set(issue.kind, {
        severity: issue.severity,
        count: (prev?.count ?? 0) + 1,
      });
    }
  }
  const SEVERITY_RANK: Record<LoginHealthSeverity, number> = { high: 0, medium: 1, low: 2 };
  const kinds = Array.from(counts.entries())
    .map(([kind, { severity, count }]) => ({ kind, severity, count }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return {
    score: Math.round(scoreSum / savedLogins.length),
    total: savedLogins.length,
    atRisk,
    kinds,
  };
});

function toggleHealthKind(kind: LoginHealthIssueKind): void {
  healthIssueKind = healthIssueKind === kind ? null : kind;
}

let filteredLogins = $derived.by(() => {
  let result = savedLogins;
  if (healthIssueKind) {
    result = result.filter((l: CredentialsHistoryItem) =>
      (loginReports.get(l.id || '')?.issues ?? NO_ISSUES).some(
        (issue) => issue.kind === healthIssueKind
      )
    );
  }
  if (filterIdentityId) {
    result = result.filter((l: CredentialsHistoryItem) => l.identityId === filterIdentityId);
  }
  if (filterEmail) {
    const fe = filterEmail.toLowerCase();
    result = result.filter((l: CredentialsHistoryItem) => (l.email || '').toLowerCase() === fe);
  }
  if (debouncedQuery.trim()) {
    const q = debouncedQuery.trim().toLowerCase();
    // If search matches the active identity filter name, keep identity-only results
    const activeIdentityName = filterIdentityId
      ? (identities.find((i: Identity) => i.id === filterIdentityId)?.name || '').toLowerCase()
      : '';
    if (!(filterIdentityId && activeIdentityName && activeIdentityName === q)) {
      result = result.filter((l: CredentialsHistoryItem) => {
        const domain = getDomain(l).toLowerCase();
        const name = (l.name || '').toLowerCase();
        const email = (l.email || '').toLowerCase();
        const idName = (
          identities.find((i: Identity) => i.id === l.identityId)?.name || ''
        ).toLowerCase();
        return domain.includes(q) || name.includes(q) || email.includes(q) || idName.includes(q);
      });
    }
  }
  return result;
});

/** Group filtered logins into domain collections (preserve list order within each). */
let loginsByDomain = $derived.by(() => {
  const map = new Map<string, CredentialsHistoryItem[]>();
  for (const login of filteredLogins) {
    const d = getDomain(login) || 'unknown';
    const list = map.get(d) || [];
    list.push(login);
    map.set(d, list);
  }
  return Array.from(map.entries()).map(([domain, logins]) => ({ domain, logins }));
});

/**
 * Every login of a domain that HAS an id is ticked - the state the domain
 * header's select-all disc shows. One predicate for both the disc's cue and its
 * click, so the two cannot disagree about whether the domain is fully selected.
 */
function isDomainFullySelected(logins: CredentialsHistoryItem[]): boolean {
  return logins.filter((l) => l.id).every((l) => selectedLoginIds.has(l.id as string));
}

const identitiesWithLogins = $derived(
  identities.filter(
    (i: Identity) =>
      i.id === filterIdentityId ||
      savedLogins.some((l: CredentialsHistoryItem) => l.identityId === i.id)
  )
);

const emailsWithLogins = $derived.by(() => {
  const set = new Set<string>();
  for (const l of savedLogins) {
    if (l.email?.trim()) set.add(l.email.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
});

// Detect OS for keyboard shortcut hint
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform);
const shortcutLabel = isMac ? '⌘ K' : 'Ctrl K';

/** Scrollspy for domain section chips */
let credentialsScrollEl = $state<HTMLElement | null>(null);
let activeDomainSpy = $state('');

// Set initial spy domain once - do not re-read activeDomainSpy after writing
let domainSpyInitialized = false;
$effect(() => {
  const domains = loginsByDomain.map((g) => g.domain);
  if (!domains.length) return;
  if (!domainSpyInitialized) {
    domainSpyInitialized = true;
    activeDomainSpy = domains[0];
  }
});

function scrollToDomain(domain: string) {
  activeDomainSpy = domain;
  const el = credentialsScrollEl?.querySelector(`[data-domain-section="${CSS.escape(domain)}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function onCredentialsScroll() {
  const root = credentialsScrollEl;
  if (!root) return;
  const sections = root.querySelectorAll<HTMLElement>('[data-domain-section]');
  let current = activeDomainSpy;
  const top = root.scrollTop + 48;
  for (const sec of sections) {
    if (sec.offsetTop <= top) current = sec.dataset.domainSection || current;
  }
  if (current) activeDomainSpy = current;
}
</script>

<div class="scroll-frame flex flex-col h-full">
{#if isLocked}
  <div class="flex-1 flex flex-col items-center justify-center py-6 text-center space-y-4">
    <div class="w-16 h-16 rounded-full bg-md-primary/10 border border-md-primary/20 flex items-center justify-center text-md-primary {ELEVATION.level3}">
      <Icon name="shield" class="w-8 h-8" />
    </div>

    <div class="max-w-xs space-y-1">
      <h3 class="text-base font-bold text-md-on-surface">{$t('savedLoginInfo.vaultLockedTitle')}</h3>
      <p class="text-xs text-md-on-surface/60">
        {#if vaultMode === 'password'}
          {$t('savedLoginInfo.vaultLockedPasswordBody')}
        {:else}
          {$t('savedLoginInfo.vaultLockedBiometricsBody')}
        {/if}
      </p>
    </div>

    {#if unlockError}
      <div class="p-2.5 rounded-xl bg-md-error-container/40 border border-md-error/30 text-xs text-md-error flex items-center gap-2 max-w-xs">
        <Icon name="info" class="w-4 h-4 shrink-0" />
        <span>{unlockError}</span>
      </div>
    {/if}

    {#if vaultMode === 'password'}
      <form class="w-full max-w-xs space-y-3" onsubmit={(e) => { e.preventDefault(); handleUnlockPassword(); }}>
        <input
          type="password"
          class="w-full bg-md-surface-variant/40 border border-md-outline-variant rounded-xl px-3.5 py-2.5 text-xs text-md-on-surface outline-none focus:border-md-primary transition-colors text-center"
          placeholder={$t('savedLoginInfo.masterPasswordPlaceholder')}
          bind:value={unlockPassword}
        />
        <button
          type="submit"
          disabled={unlocking}
          class="w-full py-2.5 px-4 rounded-xl bg-md-primary text-md-on-primary font-semibold text-xs hover:bg-md-primary/90 active:brightness-95 transition-colors {ELEVATION.level2} disabled:opacity-50"
        >
          {unlocking ? $t('savedLoginInfo.unlocking') : $t('savedLoginInfo.unlockVault')}
        </button>
      </form>
    {:else}
      <button
        onclick={handleUnlockBiometrics}
        disabled={unlocking}
        class="py-2.5 px-6 rounded-xl bg-md-primary text-md-on-primary font-semibold text-xs hover:bg-md-primary/90 active:brightness-95 transition-colors {ELEVATION.level2} flex items-center gap-2 disabled:opacity-50"
      >
        <Icon name="person" class="w-4 h-4" />
        <span>{unlocking ? $t('savedLoginInfo.verifying') : $t('savedLoginInfo.unlockBiometrics')}</span>
      </button>
    {/if}
  </div>
{:else}
<!-- Domain scrollspy chips -->
{#if loginsByDomain.length > 1}
  <div class="scroll-edge shrink-0 pt-2 pb-1 flex gap-1.5 overflow-x-auto border-b border-md-outline-variant/15" role="tablist" aria-label={$t('savedLoginInfo.domainSections')}>
    {#each loginsByDomain as group (group.domain)}
      <button
        type="button"
        role="tab"
        aria-selected={activeDomainSpy === group.domain}
        class="shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold {rowSurface({ active: activeDomainSpy === group.domain })}
          {activeDomainSpy === group.domain
            ? ''
            : 'bg-md-surface-container-high text-md-on-surface/60'}"
        onclick={() => scrollToDomain(group.domain)}
      >
        <span class="inline-flex items-center gap-1.5">
          <FaviconImage
            domain={group.domain}
            size="xs"
            class="shrink-0"
            fallbackLetter={group.domain.charAt(0).toUpperCase()}
          />
          {group.domain === 'unknown' ? $t('common.unknown') : group.domain}
        </span>
      </button>
    {/each}
  </div>
{/if}
<!-- Search + Filter bar (SearchFilterHeader). Chrome layer, so its dropdowns
     (PORTAL_Z.menu) sit above the list and the nav island sits below them. -->
<div class="scroll-edge relative {PORTAL_Z_CLASS.chrome}" bind:this={searchRootEl}>
  <div class="relative">
    <SearchFilterHeader
      scope="saved-logins"
      bind:value={searchQuery}
      placeholder={$t('savedLoginInfo.searchPlaceholder')}
      animatedPlaceholders={[
        $t('searchPlaceholder.domains'),
        $t('searchPlaceholder.loginNames'),
        $t('searchPlaceholder.emailAddresses'),
        $t('searchPlaceholder.identityNames'),
      ]}
      ariaLabel={$t('savedLoginInfo.searchAria')}
      settingsStyle={true}
      showSlashButton={false}
    >
      {#snippet filterControl()}
        <button
          id="button-savedlogin-export"
          type="button"
          class="w-8 h-8 flex items-center justify-center rounded-full border border-md-outline-variant text-md-on-surface/60 hover:bg-md-surface-variant active:brightness-95 transition-colors"
          aria-label={$t('savedLoginInfo.exportCsv')}
          title={$t('savedLoginInfo.exportCsv')}
          onclick={(e) => {
            e.stopPropagation();
            handleExportCSV();
          }}
        >
          <Icon name="download" class="w-4 h-4" />
        </button>
        <button
          id="button-savedlogin-filter"
          type="button"
          class="w-8 h-8 flex items-center justify-center rounded-full border border-md-outline-variant text-md-on-surface/60 transition-colors relative active:brightness-95 {controlSurface(
            filterDropdownOpen || filterIdentityId || filterEmail || healthIssueKind
          )}
            {!!draggedLoginId ? 'opacity-50 pointer-events-none' : ''}"
          aria-label={$t('common.filter')}
          title={$t('common.filter')}
          aria-haspopup="dialog"
          aria-expanded={filterDropdownOpen}
          disabled={!!draggedLoginId}
          onclick={(e) => {
            e.stopPropagation();
            if (draggedLoginId) return;
            filterDropdownOpen = !filterDropdownOpen;
            filterEmailDropdownOpen = false;
          }}
        >
          <Icon name="filter" class="w-4 h-4" />
          {#if filterIdentityId || filterEmail || healthIssueKind}
            <span class="absolute top-1 end-1 w-1.5 h-1.5 rounded-full bg-md-primary"></span>
          {/if}
        </button>
      {/snippet}
    </SearchFilterHeader>

        <!-- Unified filter menu: Identity + Mailbox -->
        {#if filterDropdownOpen}
          <button
            class="fixed inset-0 {PORTAL_Z_CLASS.navMenu} bg-transparent cursor-default"
            aria-label={$t('common.close')}
            onclick={() => filterDropdownOpen = false}
          ></button>

          <div use:anchoredFlyout={{ anchor: () => document.getElementById('button-savedlogin-filter'), placement: 'bottom-end', onClose: () => { filterDropdownOpen = false; } }} class="absolute top-full end-0 mt-2 bg-md-surface border border-md-outline-variant rounded-2xl {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} overflow-hidden min-w-[220px] max-h-80 overflow-y-auto">
            <div class="flex items-center justify-between px-4 py-3 border-b border-md-outline-variant/30">
              <span class="text-sm font-semibold text-md-on-surface">{$t('common.filter')}</span>
              <button
                class="w-5 h-5 flex items-center justify-center text-md-on-surface/60 hover:text-md-on-surface transition-colors rounded-lg"
                aria-label={$t('common.close')}
                onclick={() => filterDropdownOpen = false}
              >
                <Icon name="close" class="w-3.5 h-3.5" />
              </button>
            </div>

            <!-- Identity section -->
            <div class="px-3 pt-2 pb-1 text-label-sm font-bold text-md-on-surface/45">
              {$t('savedLoginInfo.filterByIdentity')}
            </div>
            <button
              class="w-full flex items-center gap-3 px-4 py-2 text-sm text-start hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 transition-colors
                {!filterIdentityId ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
              onclick={() => { filterIdentityId = null; }}
            >
              <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
                {!filterIdentityId ? 'border-md-primary' : 'border-md-outline-variant'}">
                {#if !filterIdentityId}
                  <span class="w-2 h-2 rounded-full bg-md-primary"></span>
                {/if}
              </span>
              {$t('savedLoginInfo.allIdentities')}
            </button>
            {#each identitiesWithLogins as identity (identity.id)}
              <button
                class="w-full flex items-center gap-3 px-4 py-2 text-sm text-start hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 transition-colors
                  {filterIdentityId === identity.id ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
                onclick={() => { filterIdentityId = identity.id; }}
              >
                <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
                  {filterIdentityId === identity.id ? 'border-md-primary' : 'border-md-outline-variant'}">
                  {#if filterIdentityId === identity.id}
                    <span class="w-2 h-2 rounded-full bg-md-primary"></span>
                  {/if}
                </span>
                <span class="truncate">{identity.name}</span>
              </button>
            {/each}

            <div class="h-px bg-md-outline-variant/30 my-1 mx-2"></div>

            <!-- Mailbox section (moved from standalone mail icon) -->
            <div class="px-3 pt-1 pb-1 text-label-sm font-bold text-md-on-surface/45 flex items-center gap-1.5">
              <Icon name="mail" class="w-3 h-3 opacity-70" />
              {$t('savedLoginInfo.filterMailbox')}
            </div>
            <button
              class="w-full flex items-center gap-3 px-4 py-2 text-sm text-start hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 transition-colors
                {!filterEmail ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
              onclick={() => { filterEmail = ''; }}
            >
              <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
                {!filterEmail ? 'border-md-primary' : 'border-md-outline-variant'}">
                {#if !filterEmail}
                  <span class="w-2 h-2 rounded-full bg-md-primary"></span>
                {/if}
              </span>
              {$t('savedLoginInfo.allEmails')}
            </button>
            {#each emailsWithLogins as addr (addr)}
              <button
                class="w-full flex items-center gap-3 px-4 py-2 text-sm text-start hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 transition-colors
                  {filterEmail === addr ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
                onclick={() => { filterEmail = addr; }}
              >
                <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
                  {filterEmail === addr ? 'border-md-primary' : 'border-md-outline-variant'}">
                  {#if filterEmail === addr}
                    <span class="w-2 h-2 rounded-full bg-md-primary"></span>
                  {/if}
                </span>
                <span class="truncate">{addr}</span>
              </button>
            {/each}
          </div>
        {/if}
  </div>

  {#if filterIdentityId}
    <div class="flex items-center mt-1.5">
      <Badge
        variant="primary"
        size="sm"
        icon="person"
        label={identities.find((identity: Identity) => identity.id === filterIdentityId)?.name || $t('savedLoginInfo.identity')}
        onRemove={() => { filterIdentityId = null; }}
      />
    </div>
  {/if}

  <!-- Result count / active filter info -->
  {#if filteredLogins.length !== savedLogins.length}
    {#if healthIssueKind}
      {@const activeKindItem = healthSummary.kinds.find((k) => k.kind === healthIssueKind)}
      <div class="flex items-center gap-1.5 mt-1.5">
        <span
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label-sm font-semibold {healthChipClass(
            LOGIN_HEALTH_SEVERITY_TONE[activeKindItem?.severity ?? 'medium'],
            true
          )}"
        >
          <Icon name={LOGIN_HEALTH_KIND_ICON[healthIssueKind]} class="w-3 h-3 shrink-0" />
          {$t(LOGIN_HEALTH_KIND_LABEL_KEY[healthIssueKind])}
        </span>
        <button
          type="button"
          class="w-5 h-5 flex items-center justify-center rounded-full text-md-on-surface/50 hover:bg-md-surface-variant active:brightness-95 hover:text-md-on-surface transition-colors"
          aria-label={$t('savedLoginInfo.clearFilters')}
          onclick={() => {
            healthIssueKind = null;
          }}
        >
          <Icon name="close" class="w-3 h-3" />
        </button>
      </div>
    {/if}
    <div class="flex items-center justify-between mt-1.5">
      <div class="text-xs text-md-on-surface/40">{$t('savedLoginInfo.shown', { values: { filtered: filteredLogins.length, total: savedLogins.length } })}</div>
      {#if filterIdentityId || filterEmail || searchQuery || healthIssueKind}
        <button
          class="text-xs text-md-primary hover:underline flex items-center gap-0.5"
          onclick={() => { filterIdentityId = null; filterEmail = ''; searchQuery = ''; healthIssueKind = null; }}
        >
          <Icon name="close" class="w-2.5 h-2.5" />
          {$t('savedLoginInfo.clearFilters')}
        </button>
      {/if}
    </div>
  {/if}
</div>

<div
  class="scroll-body scroll-body-framed relative z-0 flex-1 {savedLogins.length > 0 ? 'overflow-y-auto' : 'overflow-hidden'} border-t border-md-outline-variant/30"
  bind:this={credentialsScrollEl}
  onscroll={onCredentialsScroll}
>
  {#if savedLogins.length === 0}
      <EmptyState
        icon="lock"
        title={$t('savedLoginInfo.noSavedLogin')}
        fillParent
      />
  {:else if filteredLogins.length === 0}
      <EmptyState
        icon="search"
        title={$t('savedLoginInfo.noResultsMatchSearch')}
        actionLabel={$t('savedLoginInfo.clearFilters')}
        onAction={() => { filterIdentityId = null; filterEmail = ''; searchQuery = ''; healthIssueKind = null; }}
        fillParent
      />
  {:else}
    <LoginHealthScorecard
      summary={healthSummary}
      activeKind={healthIssueKind}
      onToggleKind={toggleHealthKind}
    />
    {#each loginsByDomain as group, groupIdx (group.domain)}
      <div class="scroll-mt-2" data-domain-section={group.domain}>
        <!-- Domain collection header - favicon clickable to select all in domain -->
        <div class="flex items-center gap-2 px-2.5 py-2 border-b border-md-outline-variant/30">
          <button
            type="button"
            class="{AVATAR_BOX.md} rounded-lg bg-md-surface-container-high flex items-center justify-center shrink-0 overflow-hidden cursor-pointer p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30 border-2 border-transparent {controlSurface(
              isDomainFullySelected(group.logins),
              'border'
            )}"
            aria-label={$t('common.selectAll')}
            onclick={(e) => {
              e.stopPropagation();
              const ids = group.logins.map((l) => l.id).filter(Boolean) as string[];
              const allSelected = isDomainFullySelected(group.logins);
              // One write per login, through the same entry point the disc and
              // the keyboard use, so a domain tick cannot mean something the row
              // tick does not.
              for (const id of ids) setLoginSelected(id, !allSelected);
            }}
          >
            <FaviconImage
              domain={group.domain}
              size="sm"
              class="object-contain pointer-events-none"
              fallbackLetter={group.domain.charAt(0).toUpperCase()}
            />
          </button>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-bold text-md-on-surface truncate">{group.domain === 'unknown' ? $t('common.unknown') : group.domain}</div>
            <div class="text-xs text-md-on-surface/45">{$t('savedLoginInfo.domainLoginCount', { values: { n: group.logins.length } })}</div>
          </div>
        </div>

    {#each group.logins as login, loginIdx (login.id)}
      {@const domain = group.domain}
      {@const isDragging = draggedLoginId === login.id}
      {@const isDropTarget = dropTargetLoginId === login.id}
      {@const signupStatus = login.signupStatus || (login.verified ? 'verified' : 'pending_submit')}
      {@const isLoginSelected = !!login.id && selectedLoginIds.has(login.id)}
      {@const issues = loginReports.get(login.id || '')?.issues ?? NO_ISSUES}
      {@const loginSurface = rowSurfaceState({ selected: isLoginSelected })}
      {@const loginInk = (role: RowInkRole) => rowInk(role, loginSurface)}
      {@const loginKey = login.id || `${domain}:${loginIdx}`}
      {@const detailsOpen = detailsLoginId === loginKey && !isLocked}
      <div
        class="relative border-b border-md-outline-variant/50 transition-colors duration-150 {isLoginSelected ? 'rounded-lg' : 'rounded-none'} {rowSurface({ selected: isLoginSelected })} {searchQuery.trim() || filterIdentityId || healthIssueKind ? '' : 'cursor-move'} {isDragging ? 'opacity-50' : ''} {isDropTarget ? 'ring-2 ring-inset ring-md-primary drop-target-pulse' : ''}"
        draggable={!searchQuery.trim() && !filterIdentityId && !healthIssueKind}
        role="listitem"
        data-login-row={login.id}
        use:keyboardReorder={{ id: login.id || '', ids: () => group.logins.map(l => l.id || ''), disabled: !!searchQuery.trim() || !!filterIdentityId || !!filterEmail || !!healthIssueKind || selectionMode, hint: $t('keyboardShortcuts.fixedReorderRow'), moveBefore: (sourceId, targetId) => onReorder(sourceId, targetId, group.logins) }}
        data-selectable-row={login.id}
        tabindex="-1"
        ondragstart={(e) => { handleLoginDragStart(e, login.id || ''); dragHintDismissed = true; }}
        ondragover={(e) => handleLoginDragOver(e, login.id || '')}
        ondragleave={() => handleLoginDragLeave(login.id || '')}
        ondrop={(e) => handleLoginDrop(e, login.id || '', group.logins)}
        ondragend={handleLoginDragEnd}
        aria-label={$t('savedLoginInfo.dragToReorder', { values: { domain } })}
      >
        {#if groupIdx === 0 && loginIdx === 0 && !dragHintDismissed}
          <DragHint
            hintKey="dragHintSeen_savedLoginInfo"
            text={$t('savedLoginInfo.dragHint')}
            visible={true}
            onDismiss={handleLoginDragHintDismiss}
          />
        {/if}
        <!-- Header: email/identity + timestamp + delete (domain is section title) -->
        <div class="flex items-center gap-2 min-h-[60px] density-row px-2.5 py-2">
          <button
            type="button"
            class="{AVATAR_BOX.row} rounded-full shrink-0 cursor-pointer [perspective:600px] bg-transparent border-0 p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30"
            aria-label={$t('selection.select')}
            aria-pressed={selectionMode && isLoginSelected}
            onclick={(e) => {
              e.stopPropagation();
              setLoginSelected(login.id, !isLoginSelected);
            }}
          >
            <span class="flip-card block w-full h-full relative transition-transform duration-300 [transform-style:preserve-3d] {isLoginSelected ? '[transform:rotateY(180deg)]' : ''}">
              <span class="absolute inset-0 [backface-visibility:hidden] rounded-full overflow-hidden bg-md-primary-container">
                <FaviconImage domain={domain} size="row" class="object-contain pointer-events-none" fallbackLetter={domain.charAt(0).toUpperCase()} />
              </span>
              <span class="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-full bg-md-secondary text-md-on-secondary flex items-center justify-center">
                <Icon name="check" class="{AVATAR_INK.row} text-md-on-secondary" />
              </span>
            </span>
          </button>
          <div class="flex-1 min-w-0 py-0.5">
            <button data-row-primary type="button" class="block w-full text-start bg-transparent border-0 p-0 font-bold text-sm leading-tight mb-0.5 truncate {loginInk('primary')} focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30"
              aria-haspopup={selectionMode ? undefined : 'dialog'}
              aria-pressed={selectionMode ? isLoginSelected : undefined}
              title={login.email || login.username || domain}
              onclick={(e) => { e.stopPropagation(); if (selectionMode) setLoginSelected(login.id, !isLoginSelected); else toggleLoginDetails(loginKey); }}
            >{login.email || login.username || domain}</button>
              {#if login.timestamp}
                {@const autofilledAt = formatTimestamp(login.timestamp)}
                <div class="text-xs leading-tight truncate {loginInk('meta')}" title={$t('savedLoginInfo.autofilledAt', { values: { time: autofilledAt } })}>{$t('savedLoginInfo.autofilledAt', { values: { time: autofilledAt } })}</div>
              {/if}
            <div class="flex items-center gap-1 flex-wrap mt-1 min-w-0">
              <span
                class="inline-flex px-1.5 py-0.5 rounded-full text-xs font-semibold
                  {signupStatus === 'verified'
                    ? 'bg-md-primary/15 text-md-primary'
                    : signupStatus === 'failed'
                      ? 'bg-md-error/15 text-md-error'
                      : signupStatus === 'undetected'
                        ? 'bg-md-surface-variant text-md-on-surface/55'
                        : signupStatus === 'submitted'
                          ? 'bg-md-tertiary/15 text-md-tertiary'
                          : 'bg-md-surface-variant text-md-on-surface/50'}"
              >
                {#if signupStatus === 'verified'}
                  {$t('savedLoginInfo.signupVerified')}
                {:else if signupStatus === 'failed'}
                  {$t('savedLoginInfo.signupFailed')}
                {:else if signupStatus === 'undetected'}
                  {$t('savedLoginInfo.signupUndetected')}
                {:else if signupStatus === 'submitted'}
                  {$t('savedLoginInfo.signupSubmitted')}
                {:else}
                  {$t('savedLoginInfo.signupPending')}
                {/if}
              </span>
              {#if login.emailVerificationStatus === 'confirmed'}
                <Badge size="sm" variant="success" label={$t('savedLoginInfo.emailConfirmed')} />
              {:else if login.emailVerificationStatus === 'pending'}
                <Badge size="sm" variant="warning" label={$t('savedLoginInfo.emailVerificationPending')} />
              {/if}
              {#if login.identityId}
                {@const identityId = String(login.identityId)}
                {@const identity = identities.find((i: Identity) => i.id === identityId)}
                {#if identity}
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-md-primary text-md-on-primary font-semibold {controlSurface(false)} transition-colors cursor-pointer min-w-0 max-w-full"
                    title={$t('savedLoginInfo.filterByIdentityName', { values: { name: identity.name } })}
                    onclick={(e) => {
                      e.stopPropagation();
                      filterIdentityId = identityId;
                      searchQuery = identity.name;
                      filterDropdownOpen = false;
                    }}
                  >
                    <Icon name="person" class="w-3 h-3 shrink-0" /><span class="truncate">{identity.name}</span>
                  </button>
                {:else}
                  <div class="text-xs px-2 py-0.5 rounded-full bg-md-secondary-container text-md-on-secondary-container/50 font-medium">{$t('savedLoginInfo.identity')}</div>
                {/if}
              {/if}
            </div>
          </div>
          <button type="button" class="flex items-center justify-center p-0.5 rounded-full border-0 bg-transparent hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 transition-colors shrink-0 {loginInk('icon')} focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30"
            aria-label={$t('savedLoginInfo.filledFields')}
            aria-haspopup="dialog"
            onclick={(e) => { e.stopPropagation(); toggleLoginDetails(loginKey); }}
          ><Icon name="info" class="w-5 h-5" /></button>
          <button
            type="button"
            class="flex items-center justify-center p-0.5 rounded-full border-0 bg-transparent hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 text-md-error transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30"
            aria-label={$t('savedLoginInfo.deleteLogin')}
            disabled={!login.id}
            onclick={(e) => { e.stopPropagation(); if (login.id) onDelete(login.id); }}
          >
            <Icon name="delete" class="w-5 h-5" />
          </button>
        </div>

        {#if issues.length > 0}
          <!-- Health issue badges (tap to filter the list to this issue kind) -->
          <div class="ps-[54px] pe-2.5 pb-2 flex flex-wrap gap-1" aria-label={$t('savedLoginInfo.healthScore')}>
            {#each issues as issue (issue.kind)}
              {@const isActive = healthIssueKind === issue.kind}
              <button
                type="button"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-label-sm font-semibold transition-colors {healthChipClass(
                  LOGIN_HEALTH_SEVERITY_TONE[issue.severity],
                  isActive
                )}"
                aria-pressed={isActive}
                onclick={(e) => {
                  e.stopPropagation();
                  toggleHealthKind(issue.kind);
                }}
              >
                <Icon name={LOGIN_HEALTH_KIND_ICON[issue.kind]} class="w-3 h-3 shrink-0" />
                {$t(LOGIN_HEALTH_KIND_LABEL_KEY[issue.kind])}
              </button>
            {/each}
          </div>
        {/if}

        {#if detailsOpen}
        <ModalDialog open title={domain} subtitle={login.email || login.username || undefined} onClose={() => { detailsLoginId = null; }}>
        <div class="space-y-2">
          {#if login.email}
            <button type="button" class="md-action inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-md-primary" onclick={(e) => { e.stopPropagation(); detailsLoginId = null; relatedLogin = { id: login.id, domain: login.domain, email: login.email }; }}>
              <Icon name="mail" class="w-4 h-4" />{$t('relatedMessages.title')}
            </button>
          {/if}
          {#if login.filledFields && login.filledFields.length}
            <div class="flex items-start gap-2 mb-1">
              <span class="text-xs text-md-on-surface/40 w-16 shrink-0 pt-0.5">{$t('savedLoginInfo.filledFields')}</span>
              <div class="flex flex-wrap gap-1 flex-1 min-w-0">
                {#each login.filledFields as field (field)}
                  <span class="inline-flex px-1.5 py-0.5 rounded-md text-label-sm font-semibold bg-md-primary/12 text-md-primary">
                    {$t(`savedLoginInfo.field_${field}`)}
                  </span>
                {/each}
              </div>
            </div>
          {/if}
          {#if login.name}
            <div class="flex items-center gap-2">
              <span class="text-xs text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.name')}</span>
              <span class="text-xs text-md-on-surface flex-1 truncate">{login.name}</span>
              <CopyButton text={String(login.name)} size="sm" tooltip={$t('savedLoginInfo.copyName')} />
            </div>
          {/if}
          {#if login.email}
            <div class="flex items-center gap-2">
              <span class="text-xs text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.email')}</span>
              <span class="text-xs text-md-on-surface flex-1 truncate">{login.email}</span>
              <CopyButton text={String(login.email)} size="sm" tooltip={$t('savedLoginInfo.copyEmail')} />
            </div>
          {/if}
          {#if login.phone}
            <div class="flex items-center gap-2">
              <span class="text-xs text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.phone')}</span>
              <span class="text-xs text-md-on-surface flex-1 truncate">{login.phone}</span>
              <CopyButton text={String(login.phone)} size="sm" tooltip={$t('savedLoginInfo.copyPhone')} />
            </div>
          {/if}
          {#if login.password}
            <div class="flex items-center gap-2">
              <span class="text-xs text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.password')}</span>
              <span class="text-xs text-md-on-surface flex-1 truncate font-mono">{login.password}</span>
              <CopyButton text={String(login.password)} sensitive size="sm" tooltip={$t('savedLoginInfo.copyPassword')} />
            </div>
          {:else if login.passwordNeedsReentry}
            <!-- Stored password no longer decrypts (key rotation / vault reset):
                 the row is dropped on purpose, but the user must see why. -->
            <div class="flex items-center gap-2">
              <span class="text-xs text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.password')}</span>
              <span class="text-xs text-md-warning flex-1">{$t('savedLoginInfo.passwordNeedsReentry')}</span>
            </div>
          {/if}
          {#if login.totpSecret || login.otp}
            <div class="flex items-center gap-2">
              <span class="text-xs text-md-primary/60 w-16 shrink-0">{$t('savedLoginInfo.otp')}</span>
              <div class="flex-1 min-w-0">
                <TotpBadge secret={login.totpSecret || ''} staticOtp={typeof login.otp === 'string' ? login.otp : (typeof login.totp === 'string' ? login.totp : '')} />
              </div>
            </div>
          {/if}
          {#if true}
            {@const linkedIdentity = login.identityId
              ? identities.find((i: Identity) => i.id === login.identityId)
              : undefined}
            {@const countryVal = (login.country as string | null | undefined) || linkedIdentity?.country}
            {@const genderVal = (login.gender as string | null | undefined) || linkedIdentity?.gender}
            {@const dobVal = (login.dateOfBirth as string | null | undefined) || linkedIdentity?.dateOfBirth}
            {@const pinVal = (login.pin as string | null | undefined) || linkedIdentity?.pin}
            {#if countryVal}
              <div class="flex items-center gap-2">
                <span class="text-xs text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.country')}</span>
                <span class="text-xs text-md-on-surface flex-1 truncate">{countryVal}</span>
                <CopyButton text={String(countryVal)} size="sm" tooltip={$t('savedLoginInfo.copyCountry')} />
              </div>
            {/if}
            {#if genderVal}
              <div class="flex items-center gap-2">
                <span class="text-xs text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.gender')}</span>
                <span class="text-xs text-md-on-surface flex-1 truncate">{genderVal}</span>
                <CopyButton text={String(genderVal)} size="sm" tooltip={$t('savedLoginInfo.copyGender')} />
              </div>
            {/if}
            {#if dobVal}
              <div class="flex items-center gap-2">
                <span class="text-xs text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.dateOfBirth')}</span>
                <span class="text-xs text-md-on-surface flex-1 truncate">{dobVal}</span>
                <CopyButton text={String(dobVal)} size="sm" tooltip={$t('savedLoginInfo.copyDob')} />
              </div>
            {/if}
            {#if pinVal}
              <div class="flex items-center gap-2">
                <span class="text-xs text-md-on-surface/40 w-16 shrink-0">{$t('savedLoginInfo.pinZip')}</span>
                <span class="text-xs text-md-on-surface flex-1 truncate font-mono">{pinVal}</span>
                <CopyButton text={String(pinVal)} size="sm" tooltip={$t('savedLoginInfo.copyPin')} />
              </div>
            {/if}
          {/if}
          {#if login.policyUrls?.length}
            <div class="pt-1 space-y-1.5">
              <div class="text-xs text-md-on-surface/40">{$t('savedLoginInfo.policyUrls')}</div>
              <p class="ui-support text-md-on-surface-variant">{$t('savedLoginInfo.policyAcceptChecklist')}</p>
              {#each login.policyUrls as policyUrl, pIdx (policyUrl + String(pIdx))}
                {@const reviewedKey = `${login.id || login.email || ''}|${policyUrl}`}
                {@const isReviewed = policyReviewed[reviewedKey]}
                <div class="rounded-lg border border-md-outline-variant/30 bg-md-surface-container-low/50 px-2 py-1.5 space-y-1">
                  <div class="flex items-center gap-2">
                    <a
                      href={policyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-label-sm text-md-primary underline truncate flex-1 min-w-0"
                      style="direction: ltr; unicode-bidi: isolate;"
                      title={policyUrl}
                    >{policyUrl}</a>
                    <button
                      type="button"
                      class="w-6 h-6 flex items-center justify-center rounded-full hover:bg-md-primary-container active:bg-md-primary-container-pressed transition-colors shrink-0"
                      aria-label={$t('savedLoginInfo.openPolicyUrl')}
                      title={$t('savedLoginInfo.openPolicyUrl')}
                      onclick={async () => {
                        try {
                          await browser.tabs.create({ url: policyUrl });
                        } catch (error) {
                          logError('Failed to open saved policy URL', error);
                          showToast($t('toasts.operationFailed'));
                        }
                      }}
                    >
                      <Icon name="expand" class="w-3.5 h-3.5 text-md-on-surface/50" />
                    </button>
                    <CopyButton
                      text={policyUrl}
                      size="sm"
                      variant="ghost"
                      tooltip={$t('savedLoginInfo.copyPolicyUrl')}
                      onCopied={() => showToast($t('savedLoginInfo.policyUrlCopied'))}
                      class="w-6 h-6 p-0"
                    />
                  </div>
                  <label class="flex items-center gap-2 cursor-pointer select-none">
                    <Checkbox
                      checked={!!isReviewed}
                      disabled={pendingPolicyReviews.has(reviewedKey)}
                      onchange={(e) => { void savePolicyReview(reviewedKey, e.currentTarget.checked); }}
                    />
                    <span class="text-label-sm text-md-on-surface/70">
                      {isReviewed ? $t('savedLoginInfo.policyAccepted') : $t('savedLoginInfo.policyAcceptedMark')}
                    </span>
                  </label>
                </div>
              {/each}
            </div>
          {/if}
        </div>
        </ModalDialog>
        {/if}
      </div>
    {/each}
      </div>
    {/each}
  {/if}
  <!-- Dynamic End-of-List Spacer: allows content to flow behind floating nav & strips while ensuring the final item can scroll cleanly above controls -->
  <div
    class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
    style="height: calc(var(--bottom-safe-area, 0px) + var(--selection-bar-offset, 0px) + 16px);"
    aria-hidden="true"
  ></div>
</div>
{/if}
</div>
<ConfirmDialog
  confirmDialog={csvExportConfirmOpen
    ? {
        title: $t('savedLoginInfo.exportCsvConfirmTitle'),
        message: $t('savedLoginInfo.exportCsvConfirmBody'),
        confirmLabel: $t('savedLoginInfo.exportCsv'),
        onConfirm: confirmExportCSV,
        destructive: true,
      }
    : null}
  onClose={() => { csvExportConfirmOpen = false; }}
/>
{#if relatedLogin && !isLocked}
  <RelatedMessagesDialog login={relatedLogin} onClose={() => { relatedLogin = null; }} />
{/if}
