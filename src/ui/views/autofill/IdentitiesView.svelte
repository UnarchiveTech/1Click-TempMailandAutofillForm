
<script lang="ts">
import { onDestroy, tick } from 'svelte';
import { get } from 'svelte/store';
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import {
  deleteIdentities,
  deleteIdentity,
  loadIdentities,
  reorderIdentities,
  saveIdentity,
  selectIdentity,
} from '@/features/identities/identity-actions.js';
import { registerEscapeTier, topEscapeTierId } from '@/features/keyboard-shortcuts/escape-stack.js';
import ButtonGroup from '@/ui/components/composites/ButtonGroup.svelte';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import SearchBar from '@/ui/components/composites/SearchBar.svelte';
import SearchFilterHeader from '@/ui/components/composites/SearchFilterHeader.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn, Checkbox, Dropdown, InputField, Toggle } from '@/ui/components/primitives';
import Badge from '@/ui/components/primitives/Badge.svelte';
import { getRandomUserAgentConfig, USER_AGENT_PRESETS } from '@/utils/content/user-agent.js';
import { downloadCSV, exportIdentitiesToCSV } from '@/utils/email/csv-export.js';
import { localizedErrorMessageOrFallback } from '@/utils/errors.js';
import {
  detectCountryLocally,
  maxAdultDobDate,
  randomAdultDob,
  randomCity,
  randomDobInYearRange,
  randomPostalCode,
} from '@/utils/i18n/locale-profile.js';
import {
  isProfilePictureTooLarge,
  MAX_PROFILE_PICTURE_FILE_BYTES,
} from '@/utils/identity/profile-picture.js';
import { logError } from '@/utils/logger.js';
import {
  isRandomActivePreferredEmail,
  PREFERRED_EMAIL_RANDOM_ACTIVE,
} from '@/utils/provider/blocked-temp-mail-sites.js';
import { decrypt, encrypt, VaultLockedError } from '@/utils/security/crypto.js';
import { getEmailMaps } from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { generateDefaultAvatarDataUrl } from '@/utils/theme/default-avatar.js';
import { formatLocalDateTime } from '@/utils/time/time.js';
import { localDateStamp } from '@/utils/time/time-format.js';
import type { AddressStatus, CredentialsHistoryItem, Identity } from '@/utils/types.js';
import { AVATAR_BOX, AVATAR_INK } from '@/utils/ui/avatar-size.js';
import { observeDialogDensity } from '@/utils/ui/dialog-density.js';
import { beginDialogLifecycle } from '@/utils/ui/dialog-lifecycle.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { createHoldController } from '@/utils/ui/gesture-selection.js';
import { keyboardReorder } from '@/utils/ui/keyboard-reorder.js';
import { NAV_FLOAT_CONTENT_WIDTH_CSS } from '@/utils/ui/nav-layout.js';
import { PORTAL_Z, PORTAL_Z_CLASS, portalDialogAction } from '@/utils/ui/portal-layers.js';
import { observeResizeOnFrame } from '@/utils/ui/resize-observer.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
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
import { toastStore } from '@/utils/ui/toastStore.js';
import {
  validateOTP,
  validatePassword,
  validatePhoneNumber,
  validateTextInput,
} from '@/utils/validation.js';

/**
 * Svelte actions run ONCE - when only the parameter changes, the action is not
 * re-invoked and the node is not remounted. A portal decided purely at init
 * time would therefore leave the editor stranded in the wrong tree while its
 * reactively-flipped attributes (fixed↔absolute, dialog role, portal layer)
 * claim otherwise. The `update` hook moves the node between document.body and
 * its original (split-host) parent on every `useSplitEditor` change. The
 * original parent is captured at init because `portalToBody`'s destroy only
 * REMOVES the node - it never restores it.
 */
function identityEditorFocus(node: HTMLElement, isSplit: boolean) {
  let lifecycle: ReturnType<typeof beginDialogLifecycle> | null = null;
  let stopDensity: (() => void) | null = null;
  function update(split: boolean) {
    lifecycle?.cleanup();
    stopDensity?.();
    stopDensity = split ? observeDialogDensity(node) : null;
    lifecycle = split ? null : beginDialogLifecycle();
    lifecycle?.attach(
      node,
      node.querySelector<HTMLElement>('button:not([disabled]):not(.absolute)')
    );
  }
  update(isSplit);
  return {
    update,
    destroy: () => {
      lifecycle?.cleanup();
      stopDensity?.();
    },
  };
}

function onEditorKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || topEscapeTierId() !== 'identities.editor') return;
  event.preventDefault();
  event.stopPropagation();
  attemptCloseEditor();
}

function portalIfNotSplit(node: HTMLElement, isSplit: boolean) {
  const originalParent = node.parentElement;
  let portaled = !isSplit;

  if (portaled) document.body.appendChild(node);

  return {
    update(nextIsSplit: boolean) {
      const nextPortaled = !nextIsSplit;
      if (nextPortaled === portaled) return;
      portaled = nextPortaled;
      if (portaled) {
        if (node.parentElement !== document.body) document.body.appendChild(node);
      } else if (originalParent && node.parentElement !== originalParent) {
        originalParent.appendChild(node);
      }
    },
    destroy() {
      // Mirror portalToBody: only unhook from body; when inline, Svelte removes
      // the node itself as part of block teardown.
      if (node.parentElement === document.body) node.remove();
    },
  };
}

/** Localized sample names for suggestions (fields start empty; user can pick/apply) */
const LOCALIZED_NAME_SUGGESTIONS: Record<
  string,
  { first: string[]; last: string[]; country: string }
> = {
  en: {
    first: ['James', 'Emma', 'Michael', 'Olivia', 'William', 'Sophia'],
    last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller'],
    country: 'US',
  },
  de: {
    first: ['Lukas', 'Anna', 'Maximilian', 'Sophie', 'Felix', 'Marie'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer'],
    country: 'DE',
  },
  fr: {
    first: ['Lucas', 'Camille', 'Hugo', 'Léa', 'Louis', 'Chloé'],
    last: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard'],
    country: 'FR',
  },
  es: {
    first: ['Santiago', 'Sofía', 'Mateo', 'Valentina', 'Sebastián', 'Isabella'],
    last: ['García', 'Rodríguez', 'Martínez', 'López', 'Hernández', 'González'],
    country: 'ES',
  },
  ar: {
    first: ['محمد', 'فاطمة', 'أحمد', 'نور', 'علي', 'مريم'],
    last: ['أحمد', 'حسن', 'علي', 'إبراهيم', 'خالد', 'محمود'],
    country: 'AE',
  },
  ja: {
    first: ['太郎', '花子', '翔', '美咲', '蓮', '結衣'],
    last: ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺'],
    country: 'JP',
  },
  zh: {
    first: ['伟', '芳', '娜', '敏', '静', '强'],
    last: ['王', '李', '张', '刘', '陈', '杨'],
    country: 'CN',
  },
};

function currentLangCode(): string {
  try {
    const loc = get(locale) || 'en';
    return String(loc).split('-')[0].toLowerCase();
  } catch {
    /* ignore */
    return 'en';
  }
}

function nameSuggestionsForLocale() {
  const code = currentLangCode();
  return LOCALIZED_NAME_SUGGESTIONS[code] || LOCALIZED_NAME_SUGGESTIONS.en;
}

function nextIdentityName(existing: Identity[]): string {
  const used = new Set(existing.map((i) => i.name.toLowerCase().replace(/\s+/g, '')));
  let n = 1;
  while (used.has(`identity${n}`)) n++;
  return `Identity${n}`;
}

function formatIdentityTime(ts: number): string {
  if (!ts || Number.isNaN(Number(ts))) return '';
  return formatLocalDateTime(
    ts,
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
    ts,
    $locale || 'en'
  );
}

let {
  context = 'popup',
  onBack = () => {},
  savedLogins = [] as CredentialsHistoryItem[],
  mailboxAddresses = [] as string[],
  activeMailboxAddress = '' as string,
  onOpenSavedLogins,
  showConfirm = (
    _message: string,
    _onConfirm: () => void,
    _options?: import('@/utils/ui/shared-ui.js').ConfirmDialogOptions
  ) => {},
  /** Pre-applied preferred-email filter (e.g. from message detail) */
  initialEmailFilter = '',
  /** Footer FAB: increment to open create dialog */
  createSignal = 0,
  /** Content-script handoff: identity id to open in editor */
  editIdSignal = '',
  /**
   * ≥1280 layoutSplit: mount create/edit into AppLayout's data-splitview host
   * (third column) - never merge editor into the list mainview.
   */
  useSplitEditor = false,
  splitHostId = 'autofill-split-host',
  splitHostRef = null as HTMLElement | null,
}: {
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  savedLogins?: CredentialsHistoryItem[];
  /** Existing inbox addresses for preferred-email picker */
  mailboxAddresses?: string[];
  /** Currently selected mailbox address (default option) */
  activeMailboxAddress?: string;
  onOpenSavedLogins?: (identityId: string) => void;
  /** Shared confirm dialog (no browser confirm()) */
  showConfirm?: (
    message: string,
    onConfirm: () => void,
    options?: import('@/utils/ui/shared-ui.js').ConfirmDialogOptions
  ) => void;
  initialEmailFilter?: string;
  createSignal?: number;
  editIdSignal?: string;
  useSplitEditor?: boolean;
  splitHostId?: string;
  splitHostRef?: HTMLElement | null;
} = $props();

let loginCountFormatter = $derived(
  new Intl.NumberFormat($locale || 'en', { notation: 'compact', maximumFractionDigits: 1 })
);

// React to createSignal increments. Also honor a non-zero value on first mount
// (content-script handoff sets the signal before IdentitiesView mounts).
let lastIdentityCreateSignal = -1;
let honoredInitialCreate = false;
$effect(() => {
  const n = createSignal;
  if (lastIdentityCreateSignal < 0) {
    lastIdentityCreateSignal = n;
    if (n > 0 && !honoredInitialCreate) {
      honoredInitialCreate = true;
      // Defer so form state is ready
      queueMicrotask(() => openCreateDialog());
    }
    return;
  }
  if (n > 0 && n !== lastIdentityCreateSignal) {
    lastIdentityCreateSignal = n;
    openCreateDialog();
  }
});

let lastIdentityEditId = '';
$effect(() => {
  const id = editIdSignal;
  const list = identities;
  // Parent clears signal to '' between handoffs; allow same id again after clear
  if (!id) {
    lastIdentityEditId = '';
    return;
  }
  if (id === lastIdentityEditId) return;
  // Wait for identities list to load, then open editor
  if (list.length === 0) return;
  const found = list.find((i) => i.id === id);
  if (found) {
    lastIdentityEditId = id;
    void openIdentityEditor(found);
  }
});

function handleExportCSV() {
  if (identities.length === 0) {
    toastStore.warning(get(t)('identities.noIdentities'));
    return;
  }
  const csv = exportIdentitiesToCSV(identities);
  downloadCSV(csv, `1click-identities-${localDateStamp()}.csv`);
  toastStore.success(get(t)('toasts.dataExportedSuccessfully'));
}

function restoreSplitPlaceholder() {
  try {
    const host = splitHostRef || (splitHostId ? document.getElementById(splitHostId) : null);
    const ph = host?.querySelector('[data-autofill-split-placeholder]') as HTMLElement | null;
    if (ph) {
      ph.style.display = '';
      ph.classList.remove('hidden');
    }
    // Remove any orphaned identity overlays left in the split host
    host?.querySelectorAll('.identity-overlay').forEach((n: Element) => {
      try {
        n.remove();
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}

function hideSplitPlaceholder() {
  try {
    const host = splitHostRef || (splitHostId ? document.getElementById(splitHostId) : null);
    const ph = host?.querySelector('[data-autofill-split-placeholder]') as HTMLElement | null;
    if (ph) ph.style.display = 'none';
  } catch {
    /* ignore */
  }
}

// Overlay portal state handled directly in template using Svelte 5 state

onDestroy(() => {
  restoreSplitPlaceholder();
});

let identities = $state<Identity[]>([]);
let selectedIdentityId = $state<string | null>(null);
let editingIdentity = $state<Identity | null>(null);
let isDirty = $state(false);
let savedIdentityFormSignature = $state('');
let createIdentityFormSignature = $state('');
let showCreateDialog = $state(false);
let identityStripEl = $state<HTMLElement | null>(null);
let identityStripHeightPx = $state(0);

$effect(() => {
  const el = identityStripEl;
  if (!el || typeof ResizeObserver === 'undefined') {
    identityStripHeightPx = 0;
    return;
  }
  return observeResizeOnFrame(el, (entries) => {
    for (const entry of entries) {
      identityStripHeightPx = Math.ceil(entry.target.getBoundingClientRect().height);
    }
  });
});
/**
 * Preferred email select value:
 * - PREFERRED_EMAIL_RANDOM_ACTIVE = random any live mailbox at fill time (default for new user-created identities)
 * - '' = currently selected mailbox at fill time (built-in default behavior)
 * - address string = pin that mailbox
 */
let newIdentityPreferredEmail = $state<string>(PREFERRED_EMAIL_RANDOM_ACTIVE);
let localMailboxAddresses = $state<string[]>([]);
/** address → status for preferred-email health warnings */
let addressStatusByAddress = $state<
  Record<string, { status?: string; accountStatus?: AddressStatus; expiresAt?: number }>
>({});

const emailOptions = $derived.by(() => {
  const fromProp = mailboxAddresses.filter(Boolean);
  const merged = [...new Set([...fromProp, ...localMailboxAddresses].filter(Boolean))];
  return merged.sort((a, b) => a.localeCompare(b));
});

type PrefEmailIssue = 'expired' | 'archived' | 'deleted' | 'missing' | null;

function preferredEmailIssue(pref: string | null | undefined): PrefEmailIssue {
  if (!pref?.trim() || isRandomActivePreferredEmail(pref)) return null;
  const addr = pref.trim().toLowerCase();
  const meta = addressStatusByAddress[addr];
  if (!meta) {
    // Not in live list - may be archived/deleted or never existed
    const listed = emailOptions.some((a) => a.toLowerCase() === addr);
    if (!listed) return 'missing';
    return null;
  }
  const st = (meta?.accountStatus || meta?.status || '').toLowerCase();
  if (st === 'deleted') return 'deleted';
  if (st === 'archived') return 'archived';
  if (st === 'expired') return 'expired';
  if (meta.expiresAt && meta.expiresAt > 0 && meta.expiresAt <= Date.now()) return 'expired';
  return null;
}

async function refreshAddressStatusMap() {
  try {
    const { addresses = [] } = (await browser.storage.local.get(['addresses'])) as {
      addresses?: Array<{
        address?: string;
        status?: string;
        accountStatus?: AddressStatus;
        expiresAt?: number;
      }>;
    };
    const { archivedEmails } = await getEmailMaps();
    const map: Record<
      string,
      { status?: string; accountStatus?: AddressStatus; expiresAt?: number }
    > = {};
    for (const i of addresses) {
      if (!i.address) continue;
      map[i.address.toLowerCase()] = {
        status: i.status,
        accountStatus: i.accountStatus,
        expiresAt: i.expiresAt,
      };
    }
    // Addresses only in archived bag
    for (const addr of Object.keys(archivedEmails || {})) {
      const key = addr.toLowerCase();
      if (!map[key]) map[key] = { status: 'archived', accountStatus: 'archived' };
    }
    addressStatusByAddress = map;
  } catch {
    /* ignore */
  }
}

// Search + filter state
let searchQuery = $state('');
let filterCountry = $state('');
let filterDobFrom = $state('');
let filterDobTo = $state('');
let filterEmail = $state('');
let showIdentityFilters = $state(false);

$effect(() => {
  const initial = initialEmailFilter || '';
  if (initial) {
    filterEmail = initial;
    showIdentityFilters = true;
  }
});

const identityCountries = $derived.by(() => {
  const set = new Set<string>();
  for (const i of identities) {
    if (i.country?.trim()) set.add(i.country.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
});

const identityEmails = $derived.by(() => {
  const set = new Set<string>();
  for (const i of identities) {
    if (i.preferredEmail?.trim()) set.add(i.preferredEmail.trim());
  }
  for (const addr of emailOptions) {
    if (addr?.trim()) set.add(addr.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
});

const hasActiveIdentityFilters = $derived(
  !!filterCountry || !!filterDobFrom || !!filterDobTo || !!filterEmail
);

// Multi-select state
let selectionMode = $state(false);
/** The identity list, for the keyboard's row cursor (`data-selectable-row`). */
let identityListEl = $state<HTMLElement | null>(null);
let selectedIds = $state<Set<string>>(new Set());
// Long-press rows to multi-select: the shared controller owns the per-row
// hold timers and the click-suppression window after a completed hold.
const holdCtrl = createHoldController({ holdMs: 500, suppressClickMs: 400 });
let identityFabHidden = $state(false);
let identityLastScrollTop = 0;

const filteredIdentities = $derived.by(() => {
  const query = searchQuery.toLowerCase().trim();
  const emailQ = filterEmail.toLowerCase().trim();
  return identities.filter((i: Identity) => {
    if (query) {
      const hay = [i.name, i.firstNames, i.lastNames, i.phone, i.country, i.preferredEmail]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(query)) return false;
    }
    if (filterCountry && (i.country || '') !== filterCountry) return false;
    if (emailQ) {
      const pref = (i.preferredEmail || '').toLowerCase();
      // Match preferred email, or identities that use "active mailbox" when filter is active address
      if (pref) {
        if (!pref.includes(emailQ) && emailQ !== pref) return false;
      } else {
        // No preferred pin - match only when filter equals active mailbox (would use it at fill)
        const active = (activeMailboxAddress || '').toLowerCase();
        if (!active || (!active.includes(emailQ) && emailQ !== active)) return false;
      }
    }
    const dob = (i.dateOfBirth || '').trim();
    if (filterDobFrom && (!dob || dob < filterDobFrom)) return false;
    if (filterDobTo && (!dob || dob > filterDobTo)) return false;
    return true;
  });
});

const reorderBlocked = $derived(!!searchQuery.trim() || hasActiveIdentityFilters || selectionMode);

// Drag-and-drop state
let draggedIdentityId = $state<string | null>(null);
let dropTargetIdentityId = $state<string | null>(null);

function handleIdentityDragStart(e: DragEvent, identityId: string) {
  if (reorderBlocked) {
    e.preventDefault();
    return;
  }
  draggedIdentityId = identityId;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', identityId);
  }
}

function handleIdentityDragOver(e: DragEvent, identityId: string) {
  if (reorderBlocked) return;
  if (!draggedIdentityId || draggedIdentityId === identityId) return;
  e.preventDefault();
  dropTargetIdentityId = identityId;
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

function handleIdentityDragLeave(identityId: string) {
  if (dropTargetIdentityId === identityId) {
    dropTargetIdentityId = null;
  }
}

async function handleIdentityDrop(e: DragEvent, targetId: string) {
  if (reorderBlocked) return;
  e.preventDefault();
  const sourceId = draggedIdentityId;
  draggedIdentityId = null;
  dropTargetIdentityId = null;
  if (!sourceId || sourceId === targetId) return;
  await reorderIdentities(browser, identitySetters, sourceId, targetId);
}

function clearIdentityFilters() {
  filterCountry = '';
  filterDobFrom = '';
  filterDobTo = '';
  filterEmail = '';
}

function handleIdentityDragEnd() {
  draggedIdentityId = null;
  dropTargetIdentityId = null;
}

let newIdentityFirstNames = $state('');
let newIdentityLastNames = $state('');
let newIdentityName = $state('');
let newIdentityUsername = $state('');
let newIdentityUseRandomPassword = $state(true);
let newIdentityCustomPassword = $state('');
/**
 * Why the password field may hold no usable plaintext (edit path only):
 * - `locked`: decrypt threw VaultLockedError - the stored blob is intact but
 *   unreadable until unlock. Saving the (empty) field would wipe it, so save
 *   is blocked with an unlock prompt unless the user typed a new password.
 * - `undecryptable`: decrypt failed for any other reason (rotated/imported
 *   key) - the field shows empty and save preserves the original stored blob
 *   instead of re-encrypting garbage over it (no double-encryption).
 */
let customPasswordFieldState = $state<'ok' | 'locked' | 'undecryptable'>('ok');
let newIdentityPhone = $state('');
let newIdentityPin = $state('');
let newIdentityDomainHints = $state<string[]>([]);
let newDomainHintInput = $state('');
let newIdentityGender = $state<'' | 'male' | 'female' | 'other' | 'prefer_not'>('');
let newIdentityDob = $state('');
let newIdentityCountry = $state('');
let newIdentityCity = $state('');
let newIdentityState = $state('');
let newIdentityAddress = $state('');
let newIdentityProfilePicture = $state<string | null>(null);
let newIdentityUserAgent = $state<string | null>(null);
let userAgentPresetMode = $state<string>('default');

// Per-domain field overrides
type DomainFieldOverride = {
  domain: string;
  firstNames: string;
  lastNames: string;
  username: string;
  phone: string;
  preferredEmail: string;
};
let newIdentityDomainFieldOverrides = $state<DomainFieldOverride[]>([]);
let newDomainOverrideInput = $state<Partial<DomainFieldOverride>>({});
let addingDomainOverride = $state(false);

function onUAPresetChange() {
  if (userAgentPresetMode === 'default') {
    newIdentityUserAgent = null;
  } else if (userAgentPresetMode in USER_AGENT_PRESETS) {
    newIdentityUserAgent = USER_AGENT_PRESETS[userAgentPresetMode].userAgent;
  }
}

function generateRandomUA() {
  const config = getRandomUserAgentConfig();
  newIdentityUserAgent = config.userAgent;
  userAgentPresetMode = 'custom';
}

function onCustomUAInput() {
  userAgentPresetMode = 'custom';
}
/** User must opt in - new identities are never default by default */
let newIdentitySetAsDefault = $state(false);
/** DOB helper: fixed date vs random within year range (always adult ≥18) */
let dobHelperMode = $state<'date' | 'range'>('date');
let dobRangeFromYear = $state(1970);
let dobRangeToYear = $state(Math.max(1970, new Date().getFullYear() - 18));
let validationError = $state('');

const adultDobMax = maxAdultDobDate(18);

/** Common country list for signup forms (ISO code + English name) */
const COUNTRY_OPTIONS: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'IE', name: 'Ireland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'PL', name: 'Poland' },
  { code: 'IN', name: 'India' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'CN', name: 'China' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'AR', name: 'Argentina' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'SG', name: 'Singapore' },
  { code: 'AE', name: 'United Arab Emirates' },
];

$effect(() => {
  return () => {
    holdCtrl.cancelAll();
  };
});

const identitySetters = {
  setIdentities: (ids: Identity[]) => {
    identities = ids;
  },
  setSelectedIdentityId: (id: string | null) => {
    selectedIdentityId = id;
  },
};

async function loadIdentitiesData() {
  void refreshAddressStatusMap();
  await loadIdentities(browser, identitySetters);
  honoredInitialCreate = false;
  try {
    const res = (await browser.storage.local.get(['addresses'])) as {
      addresses?: Array<{ address?: string }>;
    };
    localMailboxAddresses = (res.addresses || []).map((i) => i.address || '').filter(Boolean);
  } catch {
    /* ignore */
    localMailboxAddresses = [];
  }
}

async function tryDecryptPassword(value: string | undefined): Promise<string> {
  if (!value) {
    customPasswordFieldState = 'ok';
    return '';
  }
  try {
    const plaintext = await decrypt(value);
    customPasswordFieldState = 'ok';
    return plaintext;
  } catch (error) {
    // NEVER return the raw value here: it is the base64 ciphertext blob, and
    // the save path would encrypt it again (double-encryption) - destroying
    // the original password and filling garbage on autofill.
    if (error instanceof VaultLockedError) {
      customPasswordFieldState = 'locked';
    } else {
      customPasswordFieldState = 'undecryptable';
    }
    return '';
  }
}

async function encryptOptionalPassword(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  return encrypt(value);
}

/**
 * Keep the dirty state tied to the editor values, not only to bubbling DOM
 * events. InputField/Dropdown are reusable components, and relying on a form
 * listener alone made the footer action state unreliable after rerenders.
 */
function identityFormSnapshot() {
  return {
    newIdentitySetAsDefault,
    newIdentityName,
    newIdentityFirstNames,
    newIdentityLastNames,
    newIdentityUsername,
    newIdentityUseRandomPassword,
    newIdentityCustomPassword,
    newIdentityPhone,
    newIdentityPin,
    newIdentityDomainHints,
    newDomainHintInput,
    newIdentityPreferredEmail,
    newIdentityGender,
    newIdentityDob,
    newIdentityCountry,
    newIdentityCity,
    newIdentityState,
    newIdentityAddress,
    newIdentityProfilePicture,
    newIdentityUserAgent,
    userAgentPresetMode,
    newIdentityDomainFieldOverrides,
    newDomainOverrideInput,
    addingDomainOverride,
    dobHelperMode,
    dobRangeFromYear,
    dobRangeToYear,
  };
}

function identityFormSignature(): string {
  return JSON.stringify(identityFormSnapshot());
}

function restoreIdentityFormSnapshot(signature: string) {
  try {
    const snapshot = JSON.parse(signature) as ReturnType<typeof identityFormSnapshot>;
    newIdentitySetAsDefault = snapshot.newIdentitySetAsDefault;
    newIdentityName = snapshot.newIdentityName;
    newIdentityFirstNames = snapshot.newIdentityFirstNames;
    newIdentityLastNames = snapshot.newIdentityLastNames;
    newIdentityUsername = snapshot.newIdentityUsername;
    newIdentityUseRandomPassword = snapshot.newIdentityUseRandomPassword;
    newIdentityCustomPassword = snapshot.newIdentityCustomPassword;
    newIdentityPhone = snapshot.newIdentityPhone;
    newIdentityPin = snapshot.newIdentityPin;
    newIdentityDomainHints = [...snapshot.newIdentityDomainHints];
    newDomainHintInput = snapshot.newDomainHintInput;
    newIdentityPreferredEmail = snapshot.newIdentityPreferredEmail;
    newIdentityGender = snapshot.newIdentityGender;
    newIdentityDob = snapshot.newIdentityDob;
    newIdentityCountry = snapshot.newIdentityCountry;
    newIdentityCity = snapshot.newIdentityCity;
    newIdentityState = snapshot.newIdentityState;
    newIdentityAddress = snapshot.newIdentityAddress;
    newIdentityProfilePicture = snapshot.newIdentityProfilePicture;
    newIdentityUserAgent = snapshot.newIdentityUserAgent;
    newIdentityDomainFieldOverrides = snapshot.newIdentityDomainFieldOverrides.map((override) => ({
      ...override,
    }));
    newDomainOverrideInput = { ...snapshot.newDomainOverrideInput };
    addingDomainOverride = snapshot.addingDomainOverride ?? false;
    validationError = '';
    isDirty = false;
  } catch {
    // A missing/invalid baseline should never prevent closing the editor.
  }
}

const identityFormHasChanges = $derived.by(() => {
  const baseline = editingIdentity
    ? savedIdentityFormSignature
    : showCreateDialog
      ? createIdentityFormSignature
      : '';
  return !!baseline && identityFormSignature() !== baseline;
});

const formHasChanges = $derived(isDirty || identityFormHasChanges);

$effect(() => {
  if (editingIdentity && savedIdentityFormSignature) {
    isDirty = identityFormHasChanges;
  }
});

/** Populate every dialog field from an identity (shared by open + reset). */
async function applyIdentityToFields(identity: Identity) {
  customPasswordFieldState = 'ok';
  newIdentitySetAsDefault = !!identity.isDefault;
  newIdentityName = identity.name;
  newIdentityFirstNames = identity.firstNames || '';
  newIdentityLastNames = identity.lastNames || '';
  newIdentityUsername = identity.username || '';
  newIdentityUseRandomPassword = identity.useRandomPassword;
  newIdentityCustomPassword = await tryDecryptPassword(identity.customPassword);
  newIdentityPhone = identity.phone || '';
  newIdentityPin = identity.pin || '';
  newIdentityDomainHints = identity.domainHints ? [...identity.domainHints] : [];
  newIdentityPreferredEmail = identity.preferredEmail || '';
  newIdentityGender = (identity.gender as typeof newIdentityGender) || '';
  newIdentityDob = identity.dateOfBirth || '';
  newIdentityCountry = identity.country || '';
  newIdentityCity = identity.city || '';
  newIdentityState = identity.state || '';
  newIdentityAddress = identity.address || '';
  newIdentityProfilePicture = identity.profilePicture || null;
  newIdentityUserAgent = identity.userAgent || null;
  newIdentityDomainFieldOverrides = identity.domainFieldOverrides
    ? Object.entries(identity.domainFieldOverrides).map(([domain, fields]) => ({
        domain,
        firstNames: fields.firstNames || '',
        lastNames: fields.lastNames || '',
        username: fields.username || '',
        phone: fields.phone || '',
        preferredEmail: fields.preferredEmail || '',
      }))
    : [];
  if (!identity.userAgent) {
    userAgentPresetMode = 'default';
  } else {
    const presetKey = Object.keys(USER_AGENT_PRESETS).find(
      (k) => USER_AGENT_PRESETS[k].userAgent === identity.userAgent
    );
    userAgentPresetMode = presetKey || 'custom';
  }
  newDomainHintInput = '';
  newDomainOverrideInput = {};
  addingDomainOverride = false;
  validationError = '';
  await tick();
  savedIdentityFormSignature = identityFormSignature();
  isDirty = false;
}

async function openIdentityEditor(identity: Identity) {
  editingIdentity = identity;
  await applyIdentityToFields(identity);
}

/** Revert every field to the last saved values without closing the dialog. */
async function resetIdentityChanges() {
  if (!editingIdentity) return;
  await applyIdentityToFields(editingIdentity);
}

function resetCreateIdentityChanges() {
  if (!showCreateDialog || !createIdentityFormSignature) return;
  restoreIdentityFormSnapshot(createIdentityFormSignature);
}

function closeIdentityEditor() {
  editingIdentity = null;
  newIdentityName = '';
  newIdentityFirstNames = '';
  newIdentityLastNames = '';
  newIdentityUsername = '';
  newIdentityUseRandomPassword = true;
  newIdentityCustomPassword = '';
  customPasswordFieldState = 'ok';
  newIdentityPhone = '';
  newIdentityPin = '';
  newIdentityDomainHints = [];
  newIdentityPreferredEmail = '';
  newIdentityGender = '';
  newIdentityDob = '';
  newIdentityCountry = '';
  newIdentityCity = '';
  newIdentityState = '';
  newIdentityAddress = '';
  newIdentityProfilePicture = null;
  newIdentityUserAgent = null;
  userAgentPresetMode = 'default';
  newIdentityDomainFieldOverrides = [];
  newDomainOverrideInput = {};
  addingDomainOverride = false;
  newDomainHintInput = '';
  validationError = '';
  isDirty = false;
  savedIdentityFormSignature = '';
}

function closeCreateDialog() {
  showCreateDialog = false;
  newIdentityName = '';
  newIdentityFirstNames = '';
  newIdentityLastNames = '';
  newIdentityUsername = '';
  newIdentityUseRandomPassword = true;
  newIdentityCustomPassword = '';
  customPasswordFieldState = 'ok';
  newIdentityPhone = '';
  newIdentityPin = '';
  newIdentityDomainHints = [];
  newIdentityPreferredEmail = '';
  newIdentityGender = '';
  newIdentityDob = '';
  newIdentityCountry = '';
  newIdentityCity = '';
  newIdentityState = '';
  newIdentityAddress = '';
  newIdentityProfilePicture = null;
  newIdentityUserAgent = null;
  userAgentPresetMode = 'default';
  newIdentityDomainFieldOverrides = [];
  newDomainOverrideInput = {};
  addingDomainOverride = false;
  newDomainHintInput = '';
  validationError = '';
  isDirty = false;
  createIdentityFormSignature = '';
}

function attemptCloseEditor() {
  if (isDirty || identityFormHasChanges) {
    showConfirm($t('identities.discardChangesPrompt'), () => {
      isDirty = false;
      closeIdentityEditor();
      closeCreateDialog();
    });
  } else {
    closeIdentityEditor();
    closeCreateDialog();
  }
}

function onProfilePictureSelected(e: Event) {
  const input = e.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    validationError = $t('identities.profilePictureInvalid');
    return;
  }
  // Cap ~500KB for storage safety
  if (file.size > MAX_PROFILE_PICTURE_FILE_BYTES) {
    validationError = $t('identities.profilePictureTooLarge');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string' && isProfilePictureTooLarge(reader.result)) {
      validationError = $t('identities.profilePictureTooLarge');
      return;
    }
    newIdentityProfilePicture = typeof reader.result === 'string' ? reader.result : null;
    validationError = '';
  };
  reader.onerror = () => {
    validationError = $t('identities.profilePictureInvalid');
  };
  reader.readAsDataURL(file);
}

function clearProfilePicture() {
  newIdentityProfilePicture = null;
}

async function saveIdentityChanges() {
  if (!editingIdentity) return;

  try {
    const trimmedName = validateTextInput(newIdentityName, 'Identity name', 64);

    // Check for duplicate name (excluding the identity being edited)
    const editingId = editingIdentity?.id;
    const isDuplicateName = identities.some(
      (i) => i.id !== editingId && i.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (isDuplicateName) {
      validationError = $t('identities.duplicateName', { values: { name: trimmedName } });
      return;
    }

    const now = Date.now();
    const prevHistory = editingIdentity.updateHistory || [];
    const nextHistory = [...prevHistory, { at: now, summary: 'edit' }].slice(-20);

    // Resolve the stored customPassword without ever re-encrypting ciphertext:
    // a typed value is fresh plaintext (encrypt it); an untouched field keeps
    // the original blob when undecryptable, and blocks save with an unlock
    // prompt when the vault is locked (saving '' would wipe the password).
    let customPasswordValue: string | undefined;
    if (newIdentityUseRandomPassword) {
      customPasswordValue = undefined;
    } else if (newIdentityCustomPassword) {
      customPasswordValue = await encryptOptionalPassword(
        validateOptionalPassword(newIdentityCustomPassword)
      );
    } else if (customPasswordFieldState === 'locked') {
      validationError = $t('contentAutofill.vaultLocked');
      return;
    } else if (customPasswordFieldState === 'undecryptable') {
      customPasswordValue = editingIdentity.customPassword;
    } else {
      customPasswordValue = undefined;
    }

    const updatedIdentity: Identity = {
      ...editingIdentity,
      name: trimmedName,
      firstNames: newIdentityFirstNames.trim()
        ? validateTextInput(newIdentityFirstNames, 'First names', 500)
        : '',
      lastNames: newIdentityLastNames.trim()
        ? validateTextInput(newIdentityLastNames, 'Last names', 500)
        : '',
      username: newIdentityUsername.trim() || null,
      useRandomPassword: newIdentityUseRandomPassword,
      customPassword: customPasswordValue,
      phone: validateOptionalPhone(newIdentityPhone),
      pin: validateOptionalPin(newIdentityPin),
      domainHints: newIdentityDomainHints.filter((h) => h.trim()),
      preferredEmail: newIdentityPreferredEmail.trim() || null,
      gender: newIdentityGender || null,
      dateOfBirth: newIdentityDob.trim() || null,
      country: newIdentityCountry.trim() || null,
      city: newIdentityCity.trim() || null,
      state: newIdentityState.trim() || null,
      address: newIdentityAddress.trim() || null,
      profilePicture: newIdentityProfilePicture || null,
      userAgent: newIdentityUserAgent || null,
      domainFieldOverrides: newIdentityDomainFieldOverrides.length
        ? Object.fromEntries(
            newIdentityDomainFieldOverrides.map((ov) => [
              ov.domain,
              {
                ...(ov.firstNames ? { firstNames: ov.firstNames } : {}),
                ...(ov.lastNames ? { lastNames: ov.lastNames } : {}),
                ...(ov.username ? { username: ov.username } : {}),
                ...(ov.phone ? { phone: ov.phone } : {}),
                ...(ov.preferredEmail ? { preferredEmail: ov.preferredEmail } : {}),
              },
            ])
          )
        : undefined,
      isDefault: !!newIdentitySetAsDefault,
      updatedAt: now,
      updateHistory: nextHistory,
    };

    const saved = await saveIdentity(browser, updatedIdentity, identitySetters);
    if (!saved) {
      validationError = $t('identities.saveFailed');
      return;
    }
    if (newIdentitySetAsDefault) {
      try {
        const list = identities.map((i) => ({
          ...i,
          isDefault: i.id === updatedIdentity.id,
        }));
        await writeWithRetry({
          identities: list,
          selectedIdentityId: updatedIdentity.id,
        });
        identities = list;
      } catch {
        /* ignore */
      }
    }
    closeIdentityEditor();
  } catch (error) {
    // A field-rule failure carries its own errors.* key; a storage/vault throw
    // has no keyable message, so the dialog names the save failure instead.
    validationError = localizedErrorMessageOrFallback(error, $t, 'identities.saveFailed');
  }
}

/** Number of saved logins that reference this identity (would orphan on delete). */
function usedLoginCount(identityId: string): number {
  return (savedLogins || []).filter((l: CredentialsHistoryItem) => l.identityId === identityId)
    .length;
}

async function deleteIdentityHandler(identityId: string) {
  const used = usedLoginCount(identityId);
  showConfirm(
    used > 0
      ? $t('identities.deleteUsedConfirm', { values: { n: used } })
      : $t('identities.deleteConfirm'),
    () => {
      void (async () => {
        const deleted = await deleteIdentity(browser, identityId, identitySetters);
        if (!deleted) toastStore.error($t('identities.deleteFailed'));
      })();
    },
    { destructive: true, title: $t('identities.delete'), confirmLabel: $t('common.delete') }
  );
}

function startHold(id: string) {
  if (selectionMode || searchQuery) return;
  holdCtrl.start(id, () => {
    selectionMode = true;
    selectedIds = new Set([id]);
  });
}

function cancelHold(id: string) {
  holdCtrl.cancel(id);
}

function handleIdentityContextMenu(e: MouseEvent, id: string) {
  e.preventDefault();
  e.stopPropagation();
  cancelHold(id);
  if (!selectionMode) {
    selectionMode = true;
    selectedIds = new Set([id]);
    return;
  }
  toggleSelect(id);
}

function toggleSelect(id: string) {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds = next;
  if (selectedIds.size === 0) selectionMode = false;
}

function exitSelectionMode() {
  selectionMode = false;
  selectedIds = new Set();
}

// Escape tiers: both the multi-select and the editor are transient surfaces, so
// Escape drops them instead of closing the editor *and* navigating the view
// away (the editor's own element-level handler and this one share the key).
$effect(() => {
  if (!selectionMode || selectedIds.size === 0) return;
  return registerEscapeTier('identities.selection', exitSelectionMode);
});

// Published to the SHELL's one strip (`ListSelectionBar`), which is why this view
// renders no selection card of its own any more - the actions below are the same
// functions its in-view buttons called.
const selectionState = $derived.by<ListSelectionState>(() => ({
  active: selectionMode && selectedIds.size > 0,
  count: selectedIds.size,
  actions: identitiesSelectionActions,
  allMatched: filteredIdentities.length > 0 && selectedIds.size >= filteredIdentities.length,
  matchingTotal: filteredIdentities.length,
  universeCounted: true,
}));

/** Duplicate first, then the destructive action - the order the card used. */
const identitiesSelectionActions: SelectionActionId[] = ['duplicate', 'delete'];

const selectionApi: SelectionApi = {
  cancel: () => exitSelectionMode(),
  selectAll: () => selectAllVisibleIdentities(),
  deselectAll: () => exitSelectionMode(),
  run: (action) => {
    switch (action) {
      case 'duplicate':
        return bulkDuplicateSelected();
      case 'delete':
        return deleteSelected();
      default:
        return;
    }
  },
  // Keyboard: the cursor is DOM focus on the row (`data-selectable-row`).
  moveFocus: (delta) => void moveRowCursor(identityListEl, delta),
  hasFocusedRow: () => focusedRowId(identityListEl) !== null,
  focusedIsSelected: () => {
    const id = focusedRowId(identityListEl);
    return id !== null && selectedIds.has(id);
  },
  setFocusedSelected: (selected) => {
    const id = focusedRowId(identityListEl);
    if (id === null || selected === selectedIds.has(id)) return;
    if (selected) selectionMode = true;
    toggleSelect(id);
  },
};

$effect(() =>
  publishSelectionSurface({ surface: 'identities', state: selectionState, api: selectionApi })
);

$effect(() => {
  if (!editingIdentity && !showCreateDialog) return;
  return registerEscapeTier('identities.editor', attemptCloseEditor);
});

async function deleteSelected() {
  const ids = [...selectedIds];
  const usedCount = ids.filter((id) => usedLoginCount(id) > 0).length;
  showConfirm(
    usedCount > 0
      ? $t('identities.deleteSelectedUsedConfirm', { values: { n: usedCount } })
      : $t('identities.deleteSelectedConfirm', { values: { n: ids.length } }),
    () => {
      void (async () => {
        const deleted = await deleteIdentities(browser, ids, identitySetters);
        if (!deleted) toastStore.error($t('identities.deleteFailed'));
        exitSelectionMode();
      })();
    },
    { destructive: true }
  );
}

async function selectIdentityHandler(identityId: string) {
  await selectIdentity(browser, identityId, identitySetters);
}

/** Select every visible identity (selection mode; mirrors AddressesView). */
function selectAllVisibleIdentities() {
  const next = new Set<string>();
  for (const identity of filteredIdentities) next.add(identity.id);
  selectedIds = next;
  if (next.size > 0) selectionMode = true;
}

/**
 * Duplicate every selected identity with a fresh id and a "Copy of" name.
 * Duplicates are never default and never auto-selected - the user just
 * cloned a batch and can edit each copy afterwards.
 */
async function bulkDuplicateSelected() {
  const ids = [...selectedIds];
  if (ids.length === 0) return;
  const byId = new Map(identities.map((i) => [i.id, i]));
  const source = ids.map((id) => byId.get(id)).filter((i): i is Identity => !!i);
  if (source.length === 0) return;
  const existingNames = new Set(identities.map((i) => i.name.toLowerCase()));
  const now = Date.now();
  let failed = 0;
  for (const [index, identity] of source.entries()) {
    const copyOf = (n: string) => $t('common.copyOf', { values: { name: n } }) as string;
    let name = copyOf(identity.name);
    let suffix = 2;
    while (existingNames.has(name.toLowerCase())) {
      name = `${copyOf(identity.name)} ${suffix++}`;
    }
    existingNames.add(name.toLowerCase());
    const copy: Identity = {
      ...identity,
      id: `identity_${now}_${index}`,
      name,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      updateHistory: [...(identity.updateHistory ?? []), { at: now, summary: 'duplicate' }],
    };
    const savedCopy = await saveIdentity(browser, copy, identitySetters);
    if (!savedCopy) failed += 1;
  }
  if (failed > 0) toastStore.error($t('identities.saveFailed'));
  exitSelectionMode();
}

function openCreateDialog() {
  showCreateDialog = true;
  const suggest = nameSuggestionsForLocale();
  // Name: Identity1 / Identity2… - first/last left empty; country from locale
  newIdentityName = nextIdentityName(identities);
  newIdentityFirstNames = '';
  newIdentityLastNames = '';
  newIdentityUsername = '';
  newIdentityUseRandomPassword = true;
  newIdentityCustomPassword = '';
  customPasswordFieldState = 'ok';
  newIdentityPhone = '';
  newIdentityPin = '';
  newIdentityDomainHints = [];
  newIdentityPreferredEmail = PREFERRED_EMAIL_RANDOM_ACTIVE;
  newIdentityGender = '';
  newIdentityDob = '';
  newIdentityState = '';
  newIdentityAddress = '';
  // Default fake avatar so profile-picture form fields can be filled immediately
  newIdentityProfilePicture = generateDefaultAvatarDataUrl(newIdentityName, 'I');
  newIdentityUserAgent = null;
  newIdentityDomainFieldOverrides = [];
  newDomainOverrideInput = {};
  addingDomainOverride = false;
  newDomainHintInput = '';
  newIdentitySetAsDefault = false;
  // Local-only country (locale + timezone); sample city/ZIP for convenience
  const localCountry = detectCountryLocally() || suggest.country;
  newIdentityCountry = localCountry;
  newIdentityCity = randomCity(localCountry);
  newIdentityPin = randomPostalCode(localCountry);
  dobHelperMode = 'date';
  dobRangeToYear = Math.max(1970, new Date().getFullYear() - 18);
  validationError = '';
  createIdentityFormSignature = identityFormSignature();
  isDirty = false;
  void loadIdentitiesData();
}

function applyRandomAdultDob() {
  newIdentityDob = randomAdultDob(18, 65);
  dobHelperMode = 'date';
}

function applyDobFromRange() {
  newIdentityDob = randomDobInYearRange(dobRangeFromYear, dobRangeToYear, 18);
}

function applySuggestedNames() {
  const suggest = nameSuggestionsForLocale();
  newIdentityFirstNames = suggest.first.slice(0, 4).join(', ');
  newIdentityLastNames = suggest.last.slice(0, 4).join(', ');
}

async function createNewIdentity() {
  try {
    const trimmedName = validateTextInput(newIdentityName, 'Identity name', 64);

    // Check for duplicate name
    const isDuplicateName = identities.some(
      (i) => i.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (isDuplicateName) {
      validationError = $t('identities.duplicateName', { values: { name: trimmedName } });
      return;
    }

    const now = Date.now();
    const newIdentity: Identity = {
      id: `identity_${Date.now()}`,
      name: trimmedName,
      firstNames: newIdentityFirstNames.trim()
        ? validateTextInput(newIdentityFirstNames, 'First names', 500)
        : '',
      lastNames: newIdentityLastNames.trim()
        ? validateTextInput(newIdentityLastNames, 'Last names', 500)
        : '',
      username: newIdentityUsername.trim() || null,
      useRandomPassword: newIdentityUseRandomPassword,
      customPassword: newIdentityUseRandomPassword
        ? undefined
        : await encryptOptionalPassword(validateOptionalPassword(newIdentityCustomPassword)),
      phone: validateOptionalPhone(newIdentityPhone),
      pin: validateOptionalPin(newIdentityPin),
      preferredEmail: newIdentityPreferredEmail.trim() || null,
      gender: newIdentityGender || null,
      dateOfBirth: newIdentityDob.trim() || null,
      country: newIdentityCountry.trim() || null,
      city: newIdentityCity.trim() || null,
      state: newIdentityState.trim() || null,
      address: newIdentityAddress.trim() || null,
      profilePicture: newIdentityProfilePicture || null,
      userAgent: newIdentityUserAgent || null,
      domainFieldOverrides: newIdentityDomainFieldOverrides.length
        ? Object.fromEntries(
            newIdentityDomainFieldOverrides.map((ov) => [
              ov.domain,
              {
                ...(ov.firstNames ? { firstNames: ov.firstNames } : {}),
                ...(ov.lastNames ? { lastNames: ov.lastNames } : {}),
                ...(ov.username ? { username: ov.username } : {}),
                ...(ov.phone ? { phone: ov.phone } : {}),
                ...(ov.preferredEmail ? { preferredEmail: ov.preferredEmail } : {}),
              },
            ])
          )
        : undefined,
      isDefault: !!newIdentitySetAsDefault,
      createdAt: now,
      updatedAt: now,
      updateHistory: [{ at: now, summary: 'create' }],
    };

    const created = await saveIdentity(browser, newIdentity, identitySetters);
    if (!created) {
      validationError = $t('identities.saveFailed');
      return;
    }
    // Only promote to default identity when user checked the box
    if (newIdentitySetAsDefault) {
      try {
        const next = identities.map((i) => ({
          ...i,
          isDefault: i.id === newIdentity.id,
        }));
        // Ensure the new one is default
        const idx = next.findIndex((i) => i.id === newIdentity.id);
        if (idx < 0) next.push({ ...newIdentity, isDefault: true });
        else next[idx] = { ...newIdentity, isDefault: true };
        await writeWithRetry({
          identities: next.map((i) =>
            i.id === newIdentity.id ? { ...i, isDefault: true } : { ...i, isDefault: false }
          ),
          selectedIdentityId: newIdentity.id,
        });
        identities = next.map((i) =>
          i.id === newIdentity.id ? { ...i, isDefault: true } : { ...i, isDefault: false }
        );
      } catch {
        /* ignore */
      }
    }
    // Do not auto-select as the autofill default unless set as default
    closeCreateDialog();
  } catch (error) {
    validationError = localizedErrorMessageOrFallback(error, $t, 'identities.saveFailed');
  }
}

function validateOptionalPassword(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  validatePassword(trimmed);
  return trimmed;
}

function validateOptionalPhone(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  validatePhoneNumber(trimmed);
  return trimmed;
}

function validateOptionalPin(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  validateOTP(trimmed);
  return trimmed;
}

loadIdentitiesData();
</script>

<div class="flex flex-col h-full relative min-h-0">
  <!-- Mainview list only - editor never shares this column when layoutSplit -->
  <div
    class="scroll-body flex-1 {identities.length > 0 || showIdentityFilters ? 'overflow-y-auto' : 'overflow-hidden'} min-h-0 min-w-0"
    bind:this={identityListEl}
    onscroll={(e) => {
      const el = e.currentTarget as HTMLElement;
      const top = el.scrollTop;
      const delta = top - identityLastScrollTop;
      if (Math.abs(delta) > 8) {
        identityFabHidden = delta > 0 && top > 24;
        identityLastScrollTop = top;
      }
    }}
  >
    <!-- Search + filters -->
      <div class="pt-3 pb-1 space-y-2">
        <SearchFilterHeader
          scope="identities"
          bind:value={searchQuery}
          placeholder={$t('identities.searchPlaceholder')}
          animatedPlaceholders={[
            $t('searchPlaceholder.identities'),
            $t('searchPlaceholder.names'),
            $t('searchPlaceholder.countries'),
            $t('searchPlaceholder.phoneNumbers'),
          ]}
          ariaLabel={$t('identities.searchPlaceholder')}
          settingsStyle={true}
          showSlashButton={false}
          borderBottom={false}
          paddingClass="p-0"
        >
          {#snippet filterControl()}
            <button
              type="button"
              class="h-9 w-9 flex items-center justify-center rounded-full border border-md-outline-variant text-md-on-surface/60 hover:bg-md-surface-variant active:brightness-95 transition-colors"
              aria-label={$t('identities.exportCsv')}
              title={$t('identities.exportCsv')}
              onclick={handleExportCSV}
            >
              <Icon name="download" class="w-4 h-4" />
            </button>
            <button
              type="button"
              id="button-identities-filter"
              class="h-9 w-9 flex items-center justify-center rounded-full border border-md-outline-variant text-md-on-surface/60 transition-colors active:brightness-95 {controlSurface(
                showIdentityFilters || hasActiveIdentityFilters
              )}"
              aria-label={$t('identities.filtersToggle')}
              title={$t('identities.filtersToggle')}
              aria-pressed={showIdentityFilters}
              onclick={() => (showIdentityFilters = !showIdentityFilters)}
            >
              <Icon name="filter" class="w-4 h-4" />
            </button>
          {/snippet}
        </SearchFilterHeader>
        {#if showIdentityFilters}
          <div class="rounded-xl border border-md-outline-variant/40 bg-md-surface-container/40 p-2.5 space-y-2">
            <div>
              <label class="text-xs font-semibold text-md-on-surface/50 mb-1 block" for="id-filter-email">{$t('identities.filterEmail')}</label>
              <Dropdown
                id="id-filter-email"
                size="xs"
                variant="outlined"
                ariaLabel={$t('identities.filterEmail')}
                bind:value={filterEmail}
                options={[
                  { value: '', label: $t('identities.filterEmailAll') },
                  ...identityEmails.map((addr) => ({ value: addr, label: addr })),
                ]}
              />
            </div>
            <div>
              <label class="text-xs font-semibold text-md-on-surface/50 mb-1 block" for="id-filter-country">{$t('identities.filterCountry')}</label>
              <Dropdown
                id="id-filter-country"
                size="xs"
                variant="outlined"
                ariaLabel={$t('identities.filterCountry')}
                bind:value={filterCountry}
                options={[
                  { value: '', label: $t('identities.filterCountryAll') },
                  ...identityCountries.map((code) => ({
                    value: code,
                    label: COUNTRY_OPTIONS.find((c) => c.code === code)?.name || code,
                  })),
                ]}
              />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-xs font-semibold text-md-on-surface/50 mb-1 block" for="id-filter-dob-from">{$t('identities.filterDobFrom')}</label>
                <InputField
                  id="id-filter-dob-from"
                  type="date"
                  size="xs"
                  bind:value={filterDobFrom}
                />
              </div>
              <div>
                <label class="text-xs font-semibold text-md-on-surface/50 mb-1 block" for="id-filter-dob-to">{$t('identities.filterDobTo')}</label>
                <InputField
                  id="id-filter-dob-to"
                  type="date"
                  size="xs"
                  bind:value={filterDobTo}
                />
              </div>
            </div>
            {#if hasActiveIdentityFilters}
              <button
                type="button"
                class="text-label-sm font-semibold text-md-primary hover:underline"
                onclick={clearIdentityFilters}
              >
                {$t('identities.filterClear')}
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Identity List -->
      <div class="border-t border-md-outline-variant/30 divide-y divide-md-outline-variant/50">
        {#if identities.length === 0}
          <EmptyState
            icon="person"
            title={$t('identities.noIdentities')}
            description={$t('identities.noIdentitiesHint')}
            actionLabel={$t('identities.create')}
            onAction={openCreateDialog}
            fillParent
          />
        {:else if filteredIdentities.length === 0 && identities.length > 0}
          <EmptyState
            icon="search"
            title={$t('identities.noFilterMatches')}
            compact
          />
        {/if}
        {#each filteredIdentities as identity (identity.id)}
          {@const isChecked = selectedIds.has(identity.id)}
          {@const isDragging = draggedIdentityId === identity.id}
          {@const isDropTarget = dropTargetIdentityId === identity.id}
          {@const prefIssue = preferredEmailIssue(identity.preferredEmail)}
          {@const usedCount = usedLoginCount(identity.id)}
          {@const usedLabel = usedCount === 1
            ? $t('identities.usedLoginCount', { values: { n: usedCount } })
            : $t('identities.usedLoginCount_other', { values: { n: usedCount } })}
          {@const identitySurface = rowSurfaceState({
            selected: selectionMode && isChecked,
            active: selectedIdentityId === identity.id && !selectionMode,
          })}
          {@const ink = (role: RowInkRole) => rowInk(role, identitySurface)}
          <div
            class="density-row relative min-h-[60px] px-2.5 py-2 flex flex-col justify-center transition-colors duration-150 {selectionMode && isChecked ? 'rounded-lg' : 'rounded-none'} {rowSurface({ selected: selectionMode && isChecked, active: selectedIdentityId === identity.id && !selectionMode })} {isDragging ? 'opacity-50' : ''} {isDropTarget ? 'ring-2 ring-inset ring-md-primary drop-target-pulse' : ''}"
            role="listitem"
            data-selectable-row={identity.id}
            tabindex="-1"
            draggable={!reorderBlocked}
            use:keyboardReorder={{ id: identity.id, ids: () => identities.map(i => i.id), disabled: reorderBlocked, hint: `${$t('identities.dragHandle')} · ${$t('keyboardShortcuts.fixedReorderRow')}`, moveBefore: async (sourceId, targetId) => {
              await reorderIdentities(browser, identitySetters, sourceId, targetId);
            } }}
            ondragstart={(e) => handleIdentityDragStart(e, identity.id)}
            ondragover={(e) => handleIdentityDragOver(e, identity.id)}
            ondragleave={() => handleIdentityDragLeave(identity.id)}
            oncontextmenu={(e) => handleIdentityContextMenu(e, identity.id)}
            ondrop={(e) => handleIdentityDrop(e, identity.id)}
            ondragend={handleIdentityDragEnd}
            aria-label={identity.name}
          >
            <div class="flex items-center gap-2 w-full">
            <div
              class="flex items-center gap-2 flex-1 min-w-0"
              onclick={() => {
                if (holdCtrl.isSuppressingClick()) return;
                if (selectionMode) { toggleSelect(identity.id); }
                else { void openIdentityEditor(identity); }
              }}
              onpointerdown={() => { if (!selectionMode) startHold(identity.id); }}
              onpointerup={() => cancelHold(identity.id)}
              onpointerleave={() => cancelHold(identity.id)}
              onkeydown={(e: KeyboardEvent) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (selectionMode) toggleSelect(identity.id);
                  else void openIdentityEditor(identity);
                }
              }}
              role="button"
              data-row-primary
              tabindex="0"
            >
            <div class="flex items-center gap-2 flex-1 min-w-0 py-0.5">
              <!-- Avatar - clickable to select (AddressesView-style 3D flip) -->
              <button
                type="button"
                class="relative {AVATAR_BOX.row} rounded-full shrink-0 [perspective:600px] bg-transparent border-0 p-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-md-primary/30"
                aria-label={$t('selection.select')}
                aria-pressed={selectionMode && isChecked}
                onclick={(e) => {
                  e.stopPropagation();
                  if (!selectionMode) {
                    selectionMode = true;
                    selectedIds = new Set([identity.id]);
                  } else {
                    toggleSelect(identity.id);
                  }
                }}
              >
                <div
                  class="flip-card w-full h-full relative transition-transform duration-300 [transform-style:preserve-3d] {selectionMode && isChecked
                    ? '[transform:rotateY(180deg)]'
                    : ''}"
                >
                  <!-- Front Face: identity avatar -->
                  <div
                    class="absolute inset-0 [backface-visibility:hidden] rounded-full flex items-center justify-center overflow-hidden {prefIssue
                        ? 'bg-md-error/15'
                        : 'bg-md-primary/10'}"
                  >
                    {#if prefIssue}
                      <Icon name="warning" class="{AVATAR_INK.row} text-md-error" />
                    {:else if identity.profilePicture}
                      <img
                        src={identity.profilePicture}
                        alt={identity.name}
                        class="w-full h-full rounded-full object-cover pointer-events-none"
                      />
                    {:else}
                      <Icon name="person" class="{AVATAR_INK.row} text-md-primary" />
                    {/if}
                  </div>
                  <!-- Back Face: tick checkmark -->
                  <div
                    class="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-full bg-md-secondary text-md-on-secondary flex items-center justify-center"
                  >
                    <Icon name="check" class="{AVATAR_INK.row} text-md-on-secondary" />
                  </div>
                </div>
                {#if selectedIdentityId === identity.id && !selectionMode}
                  <span class="absolute -bottom-0.5 -right-0.5 flex pointer-events-none" aria-hidden="true">
                    <Badge
                      variant="success"
                      size="sm"
                      class="{AVATAR_BOX.xs} p-0! justify-center border-0! bg-md-success! text-md-on-success!"
                    >
                      <Icon name="check" class={AVATAR_INK.sm} />
                    </Badge>
                  </span>
                {/if}
              </button>
              <div class="min-w-0 flex-1">
                <div class="font-bold text-sm leading-tight mb-0.5 truncate {ink('primary')}">{identity.name}</div>
                {#if isRandomActivePreferredEmail(identity.preferredEmail)}
                  <div class="text-xs {ink('meta')} leading-tight truncate">{$t('identities.useRandomActiveMailbox')}</div>
                {:else if identity.preferredEmail}
                  <div class="text-xs leading-tight truncate {prefIssue ? 'text-md-error' : ink('meta')}">{identity.preferredEmail}</div>
                {:else}
                  <div class="text-xs {ink('meta')} leading-tight truncate">{$t('identities.usesActiveMailbox')}</div>
                {/if}
                {#if selectedIdentityId === identity.id && !selectionMode}
                  <span class="sr-only">{$t('identities.defaultBadge')}</span>
                {/if}
              </div>
            </div>
            </div>
            <div class="flex items-center shrink-0 gap-1">
              {#if !selectionMode}
                <button
                  type="button"
                  class="rounded-full border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30"
                  title={usedLabel}
                  aria-label={`${$t('savedLoginInfo.filterByIdentityName', { values: { name: identity.name } })}. ${usedLabel}`}
                  disabled={!onOpenSavedLogins}
                  onclick={(e) => {
                    e.stopPropagation();
                    onOpenSavedLogins?.(identity.id);
                  }}
                >
                  <Badge variant="neutral" size="sm" class="w-7 h-7 p-0! justify-center tabular-nums {controlSurface(false)}">
                    <span aria-hidden="true">{loginCountFormatter.format(usedCount)}</span>
                    <span class="sr-only">{usedLabel}</span>
                  </Badge>
                </button>
                <button
                  type="button"
                  class="flex items-center justify-center p-0.5 rounded-full bg-transparent border-0 {ink('icon')} hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30"
                  onclick={(e) => {
                    e.stopPropagation();
                    void openIdentityEditor(identity);
                  }}
                  aria-label={$t('identities.edit')}
                  title={$t('identities.edit')}
                >
                  <Icon name="edit" class="w-5 h-5" />
                </button>
                <button
                  type="button"
                  class="flex items-center justify-center p-0.5 rounded-full bg-transparent border-0 text-md-error hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/30"
                  onclick={(e) => {
                    e.stopPropagation();
                    deleteIdentityHandler(identity.id);
                  }}
                  aria-label={$t('identities.delete')}
                  title={$t('identities.delete')}
                >
                  <Icon name="delete" class="w-5 h-5" />
                </button>
              {/if}
            </div>
            </div>
            {#if prefIssue && !selectionMode}
              <div class="px-1 pb-2 pt-0.5 w-full">
                <p class="text-xs text-md-error leading-snug">
                  {#if prefIssue === 'expired'}
                    {$t('identities.preferredEmailExpired')}
                  {:else if prefIssue === 'archived'}
                    {$t('identities.preferredEmailArchived')}
                  {:else if prefIssue === 'deleted'}
                    {$t('identities.preferredEmailDeleted')}
                  {:else}
                    {$t('identities.preferredEmailMissing')}
                  {/if}
                </p>
                <p class="ui-support text-md-on-surface-variant mt-0.5">
                  {$t('identities.preferredEmailFixHint')}
                </p>
                <div class="flex flex-nowrap gap-3 mt-1.5" use:responsiveButtonLayout data-action-tier="S">
                  <button
                    type="button"
                    class="h-10 px-4 rounded-lg bg-md-primary/15 text-md-primary hover:bg-md-primary/25 active:bg-md-primary/45"
                    onclick={(e) => {
                      e.stopPropagation();
                      void openIdentityEditor(identity);
                    }}
                  >
                    <span class="btn-label">{$t('identities.editPreferredEmail')}</span>
                  </button>
                  <button
                    type="button"
                    class="h-10 px-4 rounded-lg bg-md-surface-variant text-md-on-surface/70 hover:bg-md-surface-variant/80 active:bg-md-surface-variant/100"
                    onclick={(e) => {
                      e.stopPropagation();
                      openCreateDialog();
                    }}
                  >
                    <span class="btn-label">{$t('identities.createNewInstead')}</span>
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <!-- Dynamic End-of-List Spacer: allows content to flow behind floating nav & strips while ensuring the final item can scroll cleanly above controls -->
      <div
        class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
        style="height: calc(var(--bottom-safe-area, 0px) + var(--selection-bar-offset, 0px) + {selectionState.active ? 0 : identityStripHeightPx}px + 12px);"
        aria-hidden="true"
      ></div>
  </div>

  <!-- Create identity is triggered from footer contextual FAB -->

  <!-- The selection actions use the shell's shared strip. Hide the default-identity
       picker while that strip is active so the two controls do not compete. -->
  {#if !selectionState.active}
  <div bind:this={identityStripEl} class="absolute inset-x-0 z-10 flex justify-center transition-all duration-200" style="bottom: calc(var(--bottom-safe-area, 0px) + var(--selection-bar-offset, 0px) + 4px);">
    <!-- MD3 surface bar. No MD3 component is a "floating strip", so this is the
         spec's plain elevated surface: 48dp tall (the MD3 minimum touch
         target), large (16dp) shape, surface-container, elevation level 2 -
         the same level the MD3 menu it opens uses. The control inside is an
         MD3 Small menu button, inset 4dp so the radii stay concentric
         (16 - 4 = 12dp, the MD3 medium shape). -->
    <div class="h-12 min-w-0 max-w-full flex items-center box-border p-1 bg-md-surface-container {ELEVATION.level2} rounded-xl" style:width={NAV_FLOAT_CONTENT_WIDTH_CSS}>
      <Dropdown
        class="flex-1 min-w-0"
        size="button"
        variant="elevated"
        placeholder={$t('identities.select')}
        value={selectedIdentityId ?? ''}
        disabled={identities.length === 0}
        options={identities.map((identity) => ({ value: identity.id, label: identity.name }))}
        onchange={(value) => {
          const id = String(value);
          selectedIdentityId = id;
          selectIdentity(browser, id, identitySetters);
        }}
      >
        {#snippet leading()}
          <!-- MD3 avatar: 24dp circle on the secondary-container role. -->
          <span
            class="flex items-center justify-center w-6 h-6 rounded-full bg-md-secondary-container text-md-on-secondary-container shrink-0"
            aria-hidden="true"
          >
            <Icon name="person" class="w-4 h-4" />
          </span>
        {/snippet}
      </Dropdown>
    </div>
  </div>
  {/if}

  <!-- Edit identity: full dialog, or mounted into AppLayout splitview host -->
  {#if editingIdentity}
    <div
      use:portalIfNotSplit={useSplitEditor}
      use:identityEditorFocus={useSplitEditor}
      data-portal-layer={useSplitEditor ? undefined : 'dialog'}
      class={useSplitEditor
        ? `identity-overlay absolute inset-0 ${PORTAL_Z_CLASS.splitOverlay} flex flex-col bg-md-surface min-w-0 min-h-0`
        : `identity-overlay fixed inset-0 ${PORTAL_Z_CLASS.dialog} flex items-stretch justify-stretch`}
      role={useSplitEditor ? 'presentation' : 'dialog'}
      aria-modal={useSplitEditor ? undefined : 'true'}
      aria-labelledby="edit-identity-title"
      onclick={(e) => {
        if (!useSplitEditor && e.target === e.currentTarget) attemptCloseEditor();
      }}
      onkeydown={onEditorKeydown}
    >
      {#if !useSplitEditor}
        <button
          type="button"
          tabindex="-1"
          class="absolute inset-0 z-0 cursor-default border-0 bg-md-scrim-modal backdrop-blur-sm"
          aria-label={$t('common.close')}
          onclick={attemptCloseEditor}
        ></button>
      {/if}
      <div
        class="relative z-10 flex flex-col w-full h-full min-h-0 {useSplitEditor ? 'p-2' : 'dialog-viewport-inset'}"
        style={useSplitEditor ? undefined : 'padding-block: 25px;'}
      >
      <div class="flex justify-end shrink-0 mb-2">
        <button
          type="button"
          class="w-9 h-9 rounded-full bg-md-surface hover:bg-md-surface-variant active:bg-md-surface-variant/80 flex items-center justify-center {ELEVATION.level2} transition-colors border border-md-outline-variant/30"
          onclick={attemptCloseEditor}
          aria-label={$t('common.close')}
          title={$t('common.close')}
        >
          <Icon name="close" class="w-4 h-4 text-md-on-surface/70" />
        </button>
      </div>
      <form
        class="dialog-surface scroll-frame dialog-enter bg-md-surface rounded-2xl w-full flex-1 min-h-0 flex flex-col overflow-hidden {useSplitEditor
          ? 'border border-md-outline-variant/30 {ELEVATION.level1}'
          : '{ELEVATION.level3} border border-md-outline-variant/30'}"
        onsubmit={(e) => { e.preventDefault(); void saveIdentityChanges(); }}
        oninput={() => { isDirty = true; }}
        onchange={() => { isDirty = true; }}
      >
        <div class="dialog-inset dialog-editor-header scroll-edge shrink-0 flex items-center gap-3 border-b border-md-outline-variant/15">
          <div class="w-9 h-9 rounded-xl bg-md-primary/10 flex items-center justify-center shrink-0">
            <Icon name="person" class="w-6 h-6 text-md-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 id="edit-identity-title" class="dialog-heading break-words">{$t('identities.edit')}</h2>
          </div>
        </div>
        <p class="dialog-description dialog-inset scroll-edge shrink-0 py-2 break-words">{$t('identities.editSubtitle')}</p>
        <div class="dialog-inset scroll-body scroll-body-framed flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-2">
        <div class="mb-3 space-y-0.5 text-xs text-md-on-surface/60">
          <p>{$t('identities.createdAt', { values: { time: formatIdentityTime(editingIdentity.createdAt) } })}</p>
          {#if editingIdentity.updatedAt}
            <p>{$t('identities.lastUpdated', { values: { time: formatIdentityTime(editingIdentity.updatedAt) } })}</p>
          {/if}
        </div>
        {#if editingIdentity.updateHistory?.length}
          <div class="mb-3 rounded-xl bg-md-surface-variant/40 px-3 py-2 max-h-24 overflow-y-auto">
            <div class="text-xs font-semibold uppercase text-md-on-surface/45 mb-1">{$t('identities.updateHistory')}</div>
            {#each [...editingIdentity.updateHistory].reverse().slice(0, 8) as entry (entry.at)}
              <p class="text-xs text-md-on-surface/55">{$t('identities.historyEntry', { values: { time: formatIdentityTime(entry.at) } })}</p>
            {/each}
          </div>
        {:else}
          <p class="mb-3 text-xs text-md-on-surface/40">{$t('identities.noUpdateHistory')}</p>
        {/if}
        <div class="space-y-3">
          <div class="flex items-center gap-2 mt-1">
            <div class="w-1 h-3.5 rounded-full bg-md-primary"></div>
            <span class="text-xs font-semibold uppercase tracking-wide text-md-on-surface/45">{$t('identities.sectionBasics')}</span>
            <div class="h-px flex-1 bg-md-outline-variant/25"></div>
          </div>
          <div>
            <label for="edit-identity-name" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.name')}</label>
            <InputField id="edit-identity-name" placeholder={$t('identities.namePlaceholder')} bind:value={newIdentityName} />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="edit-first-names" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.firstNames')}</label>
              <InputField id="edit-first-names" bind:value={newIdentityFirstNames} />
            </div>
            <div>
              <label for="edit-last-names" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.lastNames')}</label>
              <InputField id="edit-last-names" bind:value={newIdentityLastNames} />
            </div>
          </div>
          <div>
            <label for="edit-username" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.username')}</label>
            <p class="text-xs text-md-on-surface/40 mb-1">{$t('identities.usernameHint')}</p>
            <InputField id="edit-username" placeholder={$t('identities.usernamePlaceholder')} bind:value={newIdentityUsername} />
          </div>
          <div class="flex items-center gap-2 mt-5">
            <div class="w-1 h-3.5 rounded-full bg-md-primary"></div>
            <span class="text-xs font-semibold uppercase tracking-wide text-md-on-surface/45">{$t('identities.sectionLocation')}</span>
            <div class="h-px flex-1 bg-md-outline-variant/25"></div>
          </div>
          <div>
            <label for="edit-country-ov" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.country')}</label>
            <Dropdown
              id="edit-country-ov"
              variant="outlined"
              zIndex={PORTAL_Z.dialogMenu}
              ariaLabel={$t('identities.country')}
              bind:value={newIdentityCountry}
              options={[
                { value: '', label: $t('identities.optional') },
                ...COUNTRY_OPTIONS.map((c) => ({ value: c.code, label: c.name })),
              ]}
            />
          </div>
          <div>
            <label for="edit-gender-ov" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.gender')}</label>
            <Dropdown
              id="edit-gender-ov"
              variant="outlined"
              zIndex={PORTAL_Z.dialogMenu}
              ariaLabel={$t('identities.gender')}
              bind:value={newIdentityGender}
              options={[
                { value: '', label: $t('identities.optional') },
                { value: 'male', label: $t('identities.genderMale') },
                { value: 'female', label: $t('identities.genderFemale') },
                { value: 'other', label: $t('identities.genderOther') },
                { value: 'prefer_not', label: $t('identities.genderPreferNot') },
              ]}
            />
          </div>
          <div>
            <label for="edit-dob-ov" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.dateOfBirth')}</label>
            <InputField id="edit-dob-ov" type="date" bind:value={newIdentityDob} />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="edit-city-ov" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.city')}</label>
              <InputField id="edit-city-ov" bind:value={newIdentityCity} />
            </div>
            <div>
              <label for="edit-state-ov" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.state')}</label>
              <InputField id="edit-state-ov" placeholder={$t('identities.optional')} bind:value={newIdentityState} />
            </div>
          </div>
          <div>
            <label for="edit-address-ov" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.address')}</label>
            <InputField id="edit-address-ov" placeholder={$t('identities.optional')} bind:value={newIdentityAddress} />
          </div>
          <div class="flex items-center gap-2 mt-5">
            <div class="w-1 h-3.5 rounded-full bg-md-primary"></div>
            <span class="text-xs font-semibold uppercase tracking-wide text-md-on-surface/45">{$t('identities.sectionProfile')}</span>
            <div class="h-px flex-1 bg-md-outline-variant/25"></div>
          </div>
          <div>
            <label for="edit-avatar-ov" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.profilePicture')}</label>
            <p class="text-xs text-md-on-surface/40 mb-1">{$t('identities.profilePictureHint')}</p>
            <div class="flex flex-wrap items-center gap-3 min-w-0 max-w-full overflow-hidden">
              {#if newIdentityProfilePicture}
                <img src={newIdentityProfilePicture} alt={$t('identities.profilePicture')} class="w-12 h-12 rounded-full object-cover border border-md-outline-variant shrink-0" />
              {/if}
              <input id="edit-avatar-ov" type="file" accept="image/*" class="text-xs min-w-0 max-w-full flex-1 basis-0" onchange={onProfilePictureSelected} />
              {#if newIdentityProfilePicture}
                <button type="button" class="text-xs text-md-error hover:underline whitespace-nowrap shrink-0" onclick={clearProfilePicture}>{$t('identities.clearProfilePicture')}</button>
              {/if}
            </div>
          </div>
          <div>
            <label for="edit-ua-select" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.userAgentAnonymity')}</label>
            <div class="flex gap-2 mb-2">
              <Dropdown
                id="edit-ua-select"
                class="flex-1"
                variant="outlined"
                zIndex={PORTAL_Z.dialogMenu}
                ariaLabel={$t('identities.userAgentAnonymity')}
                bind:value={userAgentPresetMode}
                onchange={onUAPresetChange}
                options={[
                  { value: 'default', label: $t('identities.defaultBrowser') },
                  { value: 'chrome_windows', label: 'Chrome (Windows)' },
                  { value: 'chrome_mac', label: 'Chrome (macOS)' },
                  { value: 'chrome_linux', label: 'Chrome (Linux)' },
                  { value: 'chrome_android', label: 'Chrome (Android)' },
                  { value: 'custom', label: $t('identities.uaPresetCustom') },
                ]}
              />
              <button type="button" class="px-3 py-2 rounded-lg border border-md-outline text-xs text-md-primary hover:bg-md-primary/10 active:bg-md-primary/30 font-semibold" onclick={generateRandomUA}>
                {$t('identities.generateRandomUa')}
              </button>
            </div>
            {#if userAgentPresetMode === 'custom' || newIdentityUserAgent}
              <textarea
                id="edit-ua-input"
                class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                rows="2"
                placeholder="Mozilla/5.0 ..."
                bind:value={newIdentityUserAgent}
                oninput={onCustomUAInput}
              ></textarea>
            {/if}
          </div>
          <!-- Per-Domain Field Overrides -->
          <div class="pt-2">
            <span class="text-xs text-md-on-surface/50 mb-1 block font-semibold">{$t('identities.domainFieldOverrides')}</span>
            <p class="text-xs text-md-on-surface/40 mb-2">{$t('identities.domainFieldOverridesDescription')}</p>

            {#each newIdentityDomainFieldOverrides as override, i (override.domain)}
              <div class="mb-2 p-2 border border-md-outline-variant/30 rounded-lg bg-md-surface-variant/20">
                <div class="flex gap-1.5 mb-1.5">
                  <InputField
                    placeholder={$t('identities.domainPlaceholder')}
                    bind:value={override.domain}
                    class="flex-1"
                  />
                  <button
                    type="button"
                    class="w-7 h-7 rounded-full bg-md-error/10 text-md-error hover:bg-md-error/20 active:bg-md-error/40 flex items-center justify-center transition-colors"
                    onclick={(e) => {
                      e.stopPropagation();
                      newIdentityDomainFieldOverrides = newIdentityDomainFieldOverrides.filter((_, j) => j !== i);
                      if (newIdentityDomainFieldOverrides.length === 0) newDomainOverrideInput = {};
                      isDirty = true;
                    }}
                    aria-label={$t('common.remove')}
                  >
                    <Icon name="close" class="w-3.5 h-3.5" />
                  </button>
                </div>
                <div class="grid grid-cols-1 gap-1.5">
                  <InputField placeholder={$t('identities.firstNames')} bind:value={override.firstNames} />
                  <InputField placeholder={$t('identities.lastNames')} bind:value={override.lastNames} />
                  <InputField placeholder={$t('identities.username')} bind:value={override.username} />
                  <InputField placeholder={$t('identities.phoneNumber')} bind:value={override.phone} />
                  <InputField placeholder={$t('identities.preferredEmail')} bind:value={override.preferredEmail} />
                </div>
              </div>
            {/each}

            {#if addingDomainOverride}
              <div class="mb-2 p-2 border border-md-outline-variant/30 rounded-lg bg-md-surface-variant/20">
                <div class="grid grid-cols-1 gap-1.5">
                  <InputField placeholder={$t('identities.domainPlaceholder')} bind:value={newDomainOverrideInput.domain} />
                  <InputField placeholder={$t('identities.firstNames')} bind:value={newDomainOverrideInput.firstNames} />
                  <InputField placeholder={$t('identities.lastNames')} bind:value={newDomainOverrideInput.lastNames} />
                  <InputField placeholder={$t('identities.username')} bind:value={newDomainOverrideInput.username} />
                  <InputField placeholder={$t('identities.phoneNumber')} bind:value={newDomainOverrideInput.phone} />
                  <InputField placeholder={$t('identities.preferredEmail')} bind:value={newDomainOverrideInput.preferredEmail} />
                </div>
                <div class="flex flex-nowrap gap-3 mt-1.5" use:responsiveButtonLayout data-action-tier="S">
                  <button
                    type="button"
                    class="flex-1 h-10 px-4 rounded-lg border border-md-outline text-sm font-semibold text-md-primary hover:bg-md-primary/10 active:bg-md-primary/30"
                    onclick={(e) => {
                      e.stopPropagation();
                      newDomainOverrideInput = {};
                      addingDomainOverride = false;
                    }}
                  >
                    <span class="btn-label">{$t('common.cancel')}</span>
                  </button>
                  <button
                    type="button"
                    class="flex-1 h-10 px-4 rounded-lg bg-md-primary text-sm text-md-on-primary hover:bg-md-primary/90 active:brightness-95 font-semibold"
                    onclick={(e) => {
                      e.stopPropagation();
                      const d = (newDomainOverrideInput.domain || '').trim();
                      if (!d) return;
                      newIdentityDomainFieldOverrides = [...newIdentityDomainFieldOverrides, {
                        domain: d,
                        firstNames: newDomainOverrideInput.firstNames || '',
                        lastNames: newDomainOverrideInput.lastNames || '',
                        username: newDomainOverrideInput.username || '',
                        phone: newDomainOverrideInput.phone || '',
                        preferredEmail: newDomainOverrideInput.preferredEmail || '',
                      }];
                      newDomainOverrideInput = {};
                      addingDomainOverride = false;
                      isDirty = true;
                    }}
                  >
                    <span class="btn-label">{$t('common.add')}</span>
                  </button>
                </div>
              </div>
            {:else}
              <button
                type="button"
                class="w-full h-8 px-3 rounded-lg border border-md-outline-variant border-dashed text-xs text-md-on-surface/50 hover:text-md-on-surface hover:border-md-outline-variant/50"
                onclick={(e) => {
                  e.stopPropagation();
                  newDomainOverrideInput = { domain: '', firstNames: '', lastNames: '', username: '', phone: '', preferredEmail: '' };
                  addingDomainOverride = true;
                }}
              >
                {$t('identities.addDomainOverride')}
              </button>
            {/if}
          </div>
          {#if validationError}
            <p class="text-xs text-md-error">{validationError}</p>
          {/if}
        </div>
        </div>
        <!-- Sticky save at bottom of popup -->
        <div class="dialog-inset scroll-edge shrink-0 py-3 border-t border-md-outline-variant/30 bg-md-surface">
          <ButtonGroup>
            <Btn
              type="button"
              variant={isDirty || identityFormHasChanges ? 'warningOutline' : 'outline'}
              icon={isDirty || identityFormHasChanges ? 'refresh' : undefined}
              label={isDirty || identityFormHasChanges ? $t('identities.resetChanges') : $t('common.cancel')}
              onclick={isDirty || identityFormHasChanges ? (editingIdentity ? resetIdentityChanges : resetCreateIdentityChanges) : attemptCloseEditor}
              title={isDirty || identityFormHasChanges ? $t('identities.resetChangesHint') : undefined}
            />
            <Btn
              type="submit"
              variant="primary"
              label={$t('identities.save')}
            />
          </ButtonGroup>
        </div>
      </form>
      </div>
    </div>
  {/if}

  <!-- Create: full dialog, or mounted into AppLayout splitview host -->
  {#if showCreateDialog}
    <div
      use:portalIfNotSplit={useSplitEditor}
      use:identityEditorFocus={useSplitEditor}
      data-portal-layer={useSplitEditor ? undefined : 'dialog'}
      class={useSplitEditor
        ? `identity-overlay absolute inset-0 ${PORTAL_Z_CLASS.splitOverlay} flex flex-col bg-md-surface min-w-0 min-h-0`
        : `identity-overlay fixed inset-0 ${PORTAL_Z_CLASS.dialog} flex items-stretch justify-stretch`}
      role={useSplitEditor ? 'presentation' : 'dialog'}
      aria-modal={useSplitEditor ? undefined : 'true'}
      aria-labelledby="create-identity-title"
      onclick={(e) => {
        if (!useSplitEditor && e.target === e.currentTarget) attemptCloseEditor();
      }}
      onkeydown={onEditorKeydown}
    >
      {#if !useSplitEditor}
        <button
          type="button"
          tabindex="-1"
          class="absolute inset-0 z-0 cursor-default border-0 bg-md-scrim-modal backdrop-blur-sm"
          aria-label={$t('common.close')}
          onclick={attemptCloseEditor}
        ></button>
      {/if}
      <div
        class="relative z-10 flex flex-col w-full h-full min-h-0 {useSplitEditor ? 'p-2' : 'dialog-viewport-inset'}"
        style={useSplitEditor ? undefined : 'padding-block: 25px;'}
      >
      <div class="flex justify-end shrink-0 mb-2">
        <button
          type="button"
          class="w-9 h-9 rounded-full bg-md-surface hover:bg-md-surface-variant active:bg-md-surface-variant/80 flex items-center justify-center {ELEVATION.level2} transition-colors border border-md-outline-variant/30"
          onclick={attemptCloseEditor}
          aria-label={$t('common.close')}
          title={$t('common.close')}
        >
          <Icon name="close" class="w-4 h-4 text-md-on-surface/70" />
        </button>
      </div>
      <div
        class="dialog-surface scroll-frame dialog-enter bg-md-surface rounded-2xl w-full max-w-full flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden {ELEVATION.level3} border border-md-outline-variant/30 box-border"
        role="presentation"
        data-activity-dialog-key={editingIdentity ? 'dialog:identityEdit' : 'dialog:identityCreate'}
        tabindex="-1"
        oninput={() => { isDirty = true; }}
        onchange={() => { isDirty = true; }}
      >
        <div class="dialog-inset dialog-editor-header scroll-edge shrink-0 flex items-center gap-3 border-b border-md-outline-variant/15">
          <div class="w-9 h-9 rounded-xl bg-md-primary/10 flex items-center justify-center shrink-0">
            <Icon name="person" class="w-6 h-6 text-md-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 id="create-identity-title" class="dialog-heading break-words">{$t('identities.create')}</h2>
          </div>
        </div>
        <p class="dialog-description dialog-inset scroll-edge shrink-0 py-2 break-words">{$t('identities.noIdentitiesHint')}</p>

        <div class="dialog-inset scroll-body scroll-body-framed flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-2">
        <div class="dialog-content-stack min-w-0 max-w-full w-full">
          <div class="flex items-center gap-2 mt-1">
            <div class="w-1 h-3.5 rounded-full bg-md-primary"></div>
            <span class="text-xs font-semibold uppercase tracking-wide text-md-on-surface/45">{$t('identities.sectionBasics')}</span>
            <div class="h-px flex-1 bg-md-outline-variant/25"></div>
          </div>

          <!-- Identity Name -->
          <div>
            <label for="create-identity-name" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.name')}</label>
            <InputField
              id="create-identity-name"
              placeholder={$t('identities.namePlaceholder')}
              bind:value={newIdentityName}
            />
          </div>

          <!-- Name Selection (empty by default; suggest localized samples) -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <button type="button" class="text-xs text-md-primary hover:underline" onclick={applySuggestedNames}>
                {$t('identities.suggestedNamesHint')}
              </button>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <InputField
                id="create-first-names"
                label={$t('identities.firstNames')}
                placeholder={$t('identities.optional')}
                bind:value={newIdentityFirstNames}
              />
              <InputField
                id="create-last-names"
                label={$t('identities.lastNames')}
                placeholder={$t('identities.optional')}
                bind:value={newIdentityLastNames}
              />
            </div>
          </div>
          <div>
            <label for="create-username" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.username')}</label>
            <p class="text-xs text-md-on-surface/40 mb-1">{$t('identities.usernameHint')}</p>
            <InputField
              id="create-username"
              placeholder={$t('identities.usernamePlaceholder')}
              bind:value={newIdentityUsername}
            />
          </div>

          <!-- Preferred mailbox email -->
          <div>
            <label for="create-preferred-email" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.preferredEmail')}</label>
            <p class="text-xs text-md-on-surface/40 mb-1.5">{$t('identities.preferredEmailHint')}</p>
            <Dropdown
              id="create-preferred-email"
              variant="outlined"
              zIndex={PORTAL_Z.dialogMenu}
              ariaLabel={$t('identities.preferredEmail')}
              bind:value={newIdentityPreferredEmail}
              options={[
                {
                  value: PREFERRED_EMAIL_RANDOM_ACTIVE,
                  label: $t('identities.useRandomActiveMailbox'),
                },
                {
                  value: '',
                  label: activeMailboxAddress
                    ? `${$t('identities.useActiveMailbox')} (${activeMailboxAddress})`
                    : $t('identities.useActiveMailbox'),
                },
                ...emailOptions.map((addr) => ({ value: addr, label: addr })),
              ]}
            />
            {#if preferredEmailIssue(newIdentityPreferredEmail)}
              <p class="text-xs text-md-error mt-1">{$t('identities.preferredEmailBadSelected')}</p>
            {/if}
            {#if emailOptions.length === 0}
              <p class="text-xs text-md-on-surface/40 mt-1">{$t('identities.noMailboxesYet')}</p>
            {/if}
          </div>

          <!-- Password Settings -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label for="create-password" class="text-sm text-md-on-surface-variant">{$t('identities.password')}</label>
              <div class="flex items-center gap-2">
                <Toggle
                  checked={newIdentityUseRandomPassword}
                  ariaLabel={$t('identities.randomPassword')}
                  size="sm"
                  onChange={(v) => (newIdentityUseRandomPassword = v)}
                />
                <span class="text-xs text-md-on-surface/50">{$t('identities.randomPassword')}</span>
              </div>
            </div>
            {#if !newIdentityUseRandomPassword}
              <InputField
                id="create-password"
                type="password"
                showToggle
                placeholder={$t('identities.customPassword')}
                bind:value={newIdentityCustomPassword}
              />
            {/if}
          </div>

          <div class="flex items-center gap-2 mt-5">
            <div class="w-1 h-3.5 rounded-full bg-md-primary"></div>
            <span class="text-xs font-semibold uppercase tracking-wide text-md-on-surface/45">{$t('identities.sectionLocation')}</span>
            <div class="h-px flex-1 bg-md-outline-variant/25"></div>
          </div>

          <!-- Gender / DOB / Country -->
          <div class="space-y-2">
            <div>
              <label class="text-sm text-md-on-surface-variant mb-1 block" for="create-gender">{$t('identities.gender')} ({$t('identities.optional')})</label>
              <Dropdown
                id="create-gender"
                variant="outlined"
                zIndex={PORTAL_Z.dialogMenu}
                ariaLabel={$t('identities.gender')}
                bind:value={newIdentityGender}
                options={[
                  { value: '', label: $t('identities.optional') },
                  { value: 'male', label: $t('identities.genderMale') },
                  { value: 'female', label: $t('identities.genderFemale') },
                  { value: 'other', label: $t('identities.genderOther') },
                  { value: 'prefer_not', label: $t('identities.genderPreferNot') },
                ]}
              />
            </div>
            <div>
              <label class="text-sm text-md-on-surface-variant mb-1 block" for="create-dob">{$t('identities.dateOfBirth')} ({$t('identities.optional')})</label>
              <p class="text-xs text-md-on-surface/40 mb-1">{$t('identities.dobAdultHint')}</p>
              <div class="flex gap-1 mb-1.5">
                <button
                  type="button"
                  class="flex-1 px-2 py-1 text-xs font-semibold rounded-lg bg-md-surface-variant text-md-on-surface/60 {controlSurface(
                    dobHelperMode === 'date'
                  )}"
                  onclick={() => (dobHelperMode = 'date')}
                >{$t('identities.dobPickDate')}</button>
                <button
                  type="button"
                  class="flex-1 px-2 py-1 text-xs font-semibold rounded-lg bg-md-surface-variant text-md-on-surface/60 {controlSurface(
                    dobHelperMode === 'range'
                  )}"
                  onclick={() => (dobHelperMode = 'range')}
                >{$t('identities.dobFromRange')}</button>
              </div>
              {#if dobHelperMode === 'date'}
                <InputField
                  id="create-dob"
                  type="date"
                  bind:value={newIdentityDob}
                />
                <button
                  type="button"
                  class="mt-1 text-xs font-semibold text-md-primary hover:underline"
                  onclick={applyRandomAdultDob}
                >{$t('identities.dobRandomAdult')}</button>
              {:else}
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="text-sm text-md-on-surface-variant" for="dob-from-y">{$t('identities.dobFromYear')}</label>
                    <InputField
                      id="dob-from-y"
                      type="number"
                      size="xs"
                      min={1920}
                      max={new Date().getFullYear() - 18}
                      bind:value={dobRangeFromYear}
                    />
                  </div>
                  <div>
                    <label class="text-sm text-md-on-surface-variant" for="dob-to-y">{$t('identities.dobToYear')}</label>
                    <InputField
                      id="dob-to-y"
                      type="number"
                      size="xs"
                      min={1920}
                      max={new Date().getFullYear() - 18}
                      bind:value={dobRangeToYear}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  class="mt-1.5 w-full py-1.5 text-sm font-semibold rounded-lg bg-md-primary/15 text-md-primary hover:bg-md-primary/25 active:bg-md-primary/45"
                  onclick={applyDobFromRange}
                >{$t('identities.dobGenerateFromRange')}</button>
                {#if newIdentityDob}
                  <p class="text-xs text-md-on-surface/50 mt-1">{$t('identities.dobResult')}: {newIdentityDob}</p>
                {/if}
              {/if}
            </div>
            <div>
              <label class="text-sm text-md-on-surface-variant mb-1 block" for="create-country">{$t('identities.country')} ({$t('identities.optional')})</label>
              <Dropdown
                id="create-country"
                variant="outlined"
                zIndex={PORTAL_Z.dialogMenu}
                ariaLabel={$t('identities.country')}
                bind:value={newIdentityCountry}
                onchange={() => {
                  if (newIdentityCountry) {
                    newIdentityCity = randomCity(newIdentityCountry);
                    newIdentityPin = randomPostalCode(newIdentityCountry);
                  }
                }}
                options={[
                  { value: '', label: $t('identities.optional') },
                  ...COUNTRY_OPTIONS.map((c) => ({ value: c.code, label: c.name })),
                ]}
              />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-sm text-md-on-surface-variant mb-1 block" for="create-city">{$t('identities.city')} ({$t('identities.optional')})</label>
                <InputField id="create-city" bind:value={newIdentityCity} />
              </div>
              <div>
                <label class="text-sm text-md-on-surface-variant mb-1 block" for="create-state">{$t('identities.state')} ({$t('identities.optional')})</label>
                <InputField
                  id="create-state"
                  placeholder={$t('identities.optional')}
                  bind:value={newIdentityState}
                />
              </div>
            </div>
            <div>
              <label class="text-sm text-md-on-surface-variant mb-1 block" for="create-address">{$t('identities.address')} ({$t('identities.optional')})</label>
              <InputField
                id="create-address"
                placeholder={$t('identities.optional')}
                bind:value={newIdentityAddress}
              />
            </div>
            <div class="flex items-center gap-2 pt-2">
              <div class="w-1 h-3.5 rounded-full bg-md-primary"></div>
              <span class="text-xs font-semibold uppercase tracking-wide text-md-on-surface/45">{$t('identities.sectionProfile')}</span>
              <div class="h-px flex-1 bg-md-outline-variant/25"></div>
            </div>
            <div>
              <label class="text-sm text-md-on-surface-variant mb-1 block" for="create-avatar">{$t('identities.profilePicture')} ({$t('identities.optional')})</label>
              <p class="text-xs text-md-on-surface/40 mb-1">{$t('identities.profilePictureHint')}</p>
              <div class="flex flex-wrap items-center gap-3 min-w-0 max-w-full overflow-hidden">
                {#if newIdentityProfilePicture}
                  <img src={newIdentityProfilePicture} alt={$t('identities.profilePicture')} class="w-12 h-12 rounded-full object-cover border border-md-outline-variant shrink-0" />
                {/if}
                <input id="create-avatar" type="file" accept="image/*" class="text-xs min-w-0 max-w-full flex-1 basis-0" onchange={onProfilePictureSelected} />
                {#if newIdentityProfilePicture}
                  <button type="button" class="text-xs text-md-error hover:underline whitespace-nowrap shrink-0" onclick={clearProfilePicture}>{$t('identities.clearProfilePicture')}</button>
                {/if}
              </div>
            </div>
            <div>
              <label for="create-ua-select" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.userAgentAnonymity')}</label>
              <div class="flex gap-2 mb-2">
                <Dropdown
                  id="create-ua-select"
                  class="flex-1"
                  variant="outlined"
                  zIndex={PORTAL_Z.dialogMenu}
                  ariaLabel={$t('identities.userAgentAnonymity')}
                  bind:value={userAgentPresetMode}
                  onchange={onUAPresetChange}
                  options={[
                    { value: 'default', label: $t('identities.defaultBrowser') },
                    { value: 'chrome_windows', label: 'Chrome (Windows)' },
                    { value: 'chrome_mac', label: 'Chrome (macOS)' },
                    { value: 'chrome_linux', label: 'Chrome (Linux)' },
                    { value: 'chrome_android', label: 'Chrome (Android)' },
                    { value: 'custom', label: $t('identities.uaPresetCustom') },
                  ]}
                />
                <button type="button" class="px-3 py-2 rounded-lg border border-md-outline text-xs text-md-primary hover:bg-md-primary/10 active:bg-md-primary/30 font-semibold" onclick={generateRandomUA}>
                  {$t('identities.generateRandomUa')}
                </button>
              </div>
              {#if userAgentPresetMode === 'custom' || newIdentityUserAgent}
                <textarea
                  id="create-ua-input"
                  class="w-full px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-secondary-container outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
                  rows="2"
                  placeholder="Mozilla/5.0 ..."
                  bind:value={newIdentityUserAgent}
                  oninput={onCustomUAInput}
                ></textarea>
              {/if}
            </div>
          </div>

          <!-- Phone / PIN -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="create-phone" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.phoneNumber')} ({$t('identities.optional')})</label>
              <InputField
                id="create-phone"
                type="tel"
                placeholder={$t('identities.optional')}
                bind:value={newIdentityPhone}
              />
            </div>
            <div>
              <label for="create-pin" class="text-sm text-md-on-surface-variant mb-1 block">{$t('identities.pinCode')} ({$t('identities.optional')})</label>
              <InputField
                id="create-pin"
                placeholder={$t('identities.optional')}
                bind:value={newIdentityPin}
              />
            </div>
          </div>

          <label class="flex items-start gap-2.5 cursor-pointer rounded-xl border border-md-outline-variant/40 bg-md-surface-container-low px-3 py-2.5">
            <Checkbox class="mt-0.5" bind:checked={newIdentitySetAsDefault} />
            <span class="min-w-0">
              <span class="text-sm font-semibold text-md-on-surface block">{$t('identities.setAsDefault')}</span>
              <span class="text-xs text-md-on-surface/55">{$t('identities.setAsDefaultHint')}</span>
            </span>
          </label>

          {#if validationError}
            <p class="text-xs text-md-error">{validationError}</p>
          {/if}
        </div>
        </div>
        <!-- Sticky save pinned at bottom of popup -->
        <div class="dialog-inset scroll-edge shrink-0 py-3 border-t border-md-outline-variant/30 bg-md-surface">
          <ButtonGroup>
            <Btn
              type="button"
              variant={formHasChanges ? 'warningOutline' : 'outline'}
              icon={formHasChanges ? 'refresh' : undefined}
              label={formHasChanges ? $t('identities.resetChanges') : $t('common.cancel')}
              onclick={formHasChanges ? resetCreateIdentityChanges : attemptCloseEditor}
              title={formHasChanges ? $t('identities.resetChangesHint') : undefined}
            />
            <Btn
              type="button"
              variant="primary"
              label={$t('identities.save')}
              onclick={createNewIdentity}
            />
          </ButtonGroup>
        </div>
      </div>
      </div>
    </div>
  {/if}
</div>
