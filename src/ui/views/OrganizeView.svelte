<script lang="ts">
import { onMount } from 'svelte';
import { get } from 'svelte/store';
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { buildLabelUsage } from '@/features/address/label-usage.js';
import {
  deleteFilterFromStorage,
  renameFilterInStorage,
} from '@/features/address/use-email-filters.js';
import type { OrganizeTab } from '@/features/types/view-types.js';
import ConfirmDialog from '@/ui/blocks/dialogs/ConfirmDialog.svelte';
import ColorPicker from '@/ui/components/composites/ColorPicker.svelte';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import FloatingAction from '@/ui/components/composites/FloatingAction.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import SearchFilterHeader from '@/ui/components/composites/SearchFilterHeader.svelte';
import type { TabItem } from '@/ui/components/composites/Tabs.svelte';
import Tabs from '@/ui/components/composites/Tabs.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn, Checkbox, IconButton, InputField } from '@/ui/components/primitives';
import Badge from '@/ui/components/primitives/Badge.svelte';
import Skeleton from '@/ui/components/primitives/Skeleton.svelte';
import TagPill from '@/ui/components/primitives/TagPill.svelte';
import {
  addressTagsList,
  buildTagAddressUsage,
  buildTagColors,
  caseVariantTags,
  colorVariantTags,
  mergeTagSpellings,
  type TagColorUse,
  tagColorFor,
  tagUsageInfo,
  unifyTagColors,
} from '@/utils/address/address-tags.js';
import type { EmailLabelDef } from '@/utils/email/email-label-catalog.js';
import {
  getEmailLabelCatalog,
  labelColorFor,
  setEmailLabelCatalog,
} from '@/utils/email/email-label-catalog.js';
import { pluralMessage } from '@/utils/i18n/i18n-plural.js';
import { logError } from '@/utils/logger.js';
import { emailLabelsStore } from '@/utils/storage/email-labels-store.js';
import { updateStoredObject } from '@/utils/storage/rmw.js';
import {
  EMAIL_STORAGE_ADDRESS_INDEX_KEY,
  getAddresses,
  getEmailLabelsMap,
  getEmailMaps,
  isEmailStorageBagKey,
  setAddresses,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { getContrastColor } from '@/utils/theme/color-utils.js';
import { timeAgo } from '@/utils/time/time-format.js';
import type { Address, Email, SavedSearchFilter } from '@/utils/types.js';
import { portalDialogAction } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { controlSurface, rowSurface } from '@/utils/ui/row-surface.js';
import { toastStore } from '@/utils/ui/toastStore.js';

const tabsIdPrefix = $props.id();

type CatalogTag = { tag: string; color: string; createdAt?: number };

interface LabelEntry {
  name: string;
  count: number;
}

let {
  initialTab = 'tags' as OrganizeTab,
  allAddresses = [] as Address[],
  savedSearchFilters = [] as SavedSearchFilter[],
  onReloadAddresses = async () => {},
  onFiltersChange = async () => {},
  showConfirm = (
    _message: string,
    _onConfirm: () => void,
    _options?: import('@/utils/ui/shared-ui.js').ConfirmDialogOptions
  ) => {},
  tagCreateSignal = 0,
  labelCreateSignal = 0,
  tabSignal = 0,
  tabSignalValue = 'tags' as OrganizeTab,
  onTabChange = (_tab: OrganizeTab) => {},
  onOpenAddress = async (_address: Address) => {},
  onOpenMessage = (_email: Email) => {},
  onApplyFilter = async (_filter: SavedSearchFilter) => {},
}: {
  initialTab?: OrganizeTab;
  allAddresses?: Address[];
  savedSearchFilters?: SavedSearchFilter[];
  onReloadAddresses?: () => Promise<void>;
  onFiltersChange?: () => Promise<void>;
  showConfirm?: (
    message: string,
    onConfirm: () => void,
    options?: import('@/utils/ui/shared-ui.js').ConfirmDialogOptions
  ) => void;
  tagCreateSignal?: number;
  labelCreateSignal?: number;
  /** Increment to force tab switch from parent (FAB / deep links) */
  tabSignal?: number;
  tabSignalValue?: OrganizeTab;
  /** Keep parent FAB / sidebar in sync when user switches tabs */
  onTabChange?: (tab: OrganizeTab) => void;
  onOpenAddress?: (address: Address) => Promise<void>;
  onOpenMessage?: (email: Email) => void;
  onApplyFilter?: (filter: SavedSearchFilter) => Promise<void>;
} = $props();

let activeTab = $state<OrganizeTab>('tags');
let lastTabSignal = 0;
let lastInitial = '';
let emailLabelsById = $state<Record<string, string[]>>({});
let searches = $state<Record<OrganizeTab, string>>({ tags: '', labels: '', filters: '' });
let organizeSearchInput: HTMLInputElement | null = null;
let usageTarget = $state<{ kind: 'tag' | 'label'; name: string } | null>(null);
let usageBusy = $state(false);
let applyingFilterId = $state('');
let labelUsage = $state<Record<string, Email[]>>({});
let labelLoadFailed = $state(false);
let labelGeneration = 0;

const searchPlaceholder = $derived(
  activeTab === 'tags'
    ? $t('organize.searchTags')
    : activeTab === 'labels'
      ? $t('organize.searchLabels')
      : $t('organize.searchFilters')
);
const filteredSavedFilters = $derived(
  savedSearchFilters.filter((filter: SavedSearchFilter) =>
    [
      filter.name,
      getFilterSummary(filter),
      ...Object.values(filter).flatMap((value) =>
        Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
      ),
    ].some((value) => String(value).toLowerCase().includes(searches.filters.trim().toLowerCase()))
  )
);
const usageAddresses = $derived(
  usageTarget?.kind === 'tag'
    ? allAddresses.filter((address: Address) =>
        addressTagsList(address).some(
          (tag) => tag.name.toLowerCase() === usageTarget?.name.toLowerCase()
        )
      )
    : []
);
const usageEmails = $derived(
  usageTarget?.kind === 'label' ? labelUsage[usageTarget.name] || [] : []
);

async function openUsageAddress(address: Address) {
  if (usageBusy) return;
  usageBusy = true;
  try {
    await onOpenAddress(address);
    usageTarget = null;
  } catch (error) {
    logError('Failed to open tag address', error);
    toastStore.error($t('toasts.operationFailed'));
  } finally {
    usageBusy = false;
  }
}

async function applySavedFilter(filter: SavedSearchFilter) {
  if (applyingFilterId) return;
  applyingFilterId = filter.id;
  try {
    await onApplyFilter(filter);
  } catch (error) {
    logError('Failed to apply saved search', error);
    toastStore.error($t('toasts.operationFailed'));
  } finally {
    applyingFilterId = '';
  }
}

$effect(() => {
  return emailLabelsStore.subscribe((map) => {
    emailLabelsById = map;
  });
});

$effect(() => {
  // Sync when parent deep-links via initialTab / tabSignal
  if (tabSignal > 0 && tabSignal !== lastTabSignal) {
    lastTabSignal = tabSignal;
    activeTab = tabSignalValue;
    return;
  }
  if (initialTab && initialTab !== lastInitial) {
    lastInitial = initialTab;
    activeTab = initialTab;
  }
});

$effect(() => {
  onTabChange(activeTab);
});

let tagCount = $derived.by(() => {
  const set = new Set<string>();
  for (const account of allAddresses || []) {
    const tags = addressTagsList(account);
    if (tags.length > 0) {
      // Lower-cased: `Banking` and `banking` are one tag, and the hub shows one
      // card for them - a case-sensitive count advertised two.
      for (const tagName of tags) if (tagName.name) set.add(tagName.name.toLowerCase());
    } else if (account.tag) {
      set.add(account.tag);
    }
  }
  return set.size;
});

let labelCount = $derived.by(() => {
  const set = new Set<string>();
  for (const list of Object.values(emailLabelsById || {})) {
    if (!Array.isArray(list)) continue;
    for (const name of list) if (name) set.add(name);
  }
  return set.size;
});

let filterCount = $derived(savedSearchFilters.length);

const tabItems = $derived<TabItem[]>([
  { id: 'tags', label: $t('nav.tagManagement'), badge: tagCount, icon: 'tag' },
  { id: 'labels', label: $t('nav.labelManagement'), badge: labelCount, icon: 'mail' },
  {
    id: 'filters',
    label: $t('nav.savedSearches'),
    badge: filterCount,
    icon: 'filter',
  },
]);

const activeSubtitle = $derived(
  activeTab === 'tags'
    ? $t('organize.tagsHint')
    : activeTab === 'labels'
      ? $t('organize.labelsHint')
      : $t('organize.filtersHint')
);

// ── Tags ────────────────────────────────────────────────────────────────────

let tagCatalog = $state<CatalogTag[]>([]);

async function loadTagCatalog() {
  try {
    const res = (await browser.storage.local.get(['mailboxTagCatalog'])) as {
      mailboxTagCatalog?: CatalogTag[];
    };
    tagCatalog = (res.mailboxTagCatalog || []).map((c) => ({
      tag: c.tag,
      color: c.color || '#6750a4',
      createdAt: c.createdAt || Date.now(),
    }));
  } catch {
    /* ignore */
    tagCatalog = [];
  }
}

$effect(() => {
  void loadTagCatalog();
});

/**
 * Persist the tag catalog through the serialized RMW helper. `edit` runs
 * against the last landed write for the key - not this component's `tagCatalog`
 * snapshot - so a tag edit made in another surface survives instead of being
 * clobbered by a stale whole-array write. Resolves with the written array.
 */
async function persistTagCatalog(
  edit: (current: CatalogTag[]) => CatalogTag[]
): Promise<CatalogTag[]> {
  return updateStoredObject<CatalogTag[]>('mailboxTagCatalog', edit, (raw) =>
    ((Array.isArray(raw) ? raw : []) as Partial<CatalogTag>[])
      .filter(
        (c): c is Partial<CatalogTag> & { tag: string } =>
          typeof c?.tag === 'string' && c.tag.length > 0
      )
      .map((c) => ({
        tag: c.tag,
        color: c.color || '#6750a4',
        createdAt: c.createdAt || Date.now(),
      }))
  );
}

function tagsForAddress(account: Address): Array<{ name: string; color: string }> {
  const tags = addressTagsList(account);
  if (tags.length > 0) return tags;
  return account.tag ? [{ name: account.tag, color: account.tagColor || '#6750a4' }] : [];
}

function addressWithTags(account: Address, tags: Array<{ name: string; color: string }>): Address {
  const first = tags[0];
  return {
    ...account,
    tags,
    tag: first?.name,
    tagColor: first?.color,
  };
}

/**
 * Case-variant spellings in play, by lower-cased tag name - the tags that exist
 * as more than one spelling, and the spelling a merge would keep.
 */
// Which addresses carry each tag - the count on every tag chip and the addresses
// its hover names. One derivation for the whole view.
let tagAddressUsage = $derived(buildTagAddressUsage(allAddresses));

// One color per tag, keyed case-insensitively like the usage map - so a card's
// color is the same color the address rows and the tag dialog show for that tag,
// even when a case split is in play.
let tagColors = $derived(buildTagColors(allAddresses));

/**
 * The usage a tag chip shows. Read through `$t` inside the template's own render,
 * so a chip cannot render a stale count after a locale or address change.
 */
function tagUsageFor(tag: string) {
  return tagUsageInfo($t, tagAddressUsage, tag);
}

let tagVariantByKey = $derived.by(() => {
  const map = new Map<string, { canonical: string; spellings: string[] }>();
  for (const group of caseVariantTags(
    allAddresses,
    tagCatalog.map((c) => c.tag)
  )) {
    map.set(group.canonical.toLowerCase(), {
      canonical: group.canonical,
      spellings: group.spellings.map((spelling) => spelling.name),
    });
  }
  return map;
});

/**
 * The color counterpart of `tagVariantByKey`: each tag its addresses write in more
 * than one color, with the color a cleanup keeps.
 */
let tagColorVariantByKey = $derived.by(() => {
  const map = new Map<string, { colors: TagColorUse[] }>();
  for (const variant of colorVariantTags(allAddresses)) {
    map.set(variant.tag, { colors: variant.colors });
  }
  return map;
});

let tagGroups = $derived.by(() => {
  const map = new Map<
    string,
    { tag: string; color: string; accounts: Address[]; createdAt: number }
  >();
  for (const acc of allAddresses) {
    for (const assigned of tagsForAddress(acc)) {
      // Keyed by the LOWER-CASED name: a tag is one tag regardless of casing, so
      // `Banking` and `banking` are one card here instead of two identical ones.
      const key = assigned.name.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          tag: assigned.name,
          color: assigned.color || '#6750a4',
          accounts: [],
          createdAt: 0,
        });
      }
      const group = map.get(key);
      if (group) {
        group.accounts.push(acc);
        if (!group.color) group.color = assigned.color || '#6750a4';
      }
    }
  }
  for (const c of tagCatalog) {
    const key = c.tag.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        tag: c.tag,
        color: c.color || '#6750a4',
        accounts: [],
        createdAt: c.createdAt || Date.now(),
      });
    } else {
      const g = map.get(key);
      if (g) {
        g.createdAt = c.createdAt || g.createdAt;
        if (!g.color) g.color = c.color;
      }
    }
  }
  return [...map.entries()]
    .map(([key, group]) => {
      const variant = tagVariantByKey.get(key);
      // The card is named after the spelling the merge would KEEP, so the card
      // and the fix can never disagree about which one survives.
      const tag = variant?.canonical ?? group.tag;
      const colorVariant = tagColorVariantByKey.get(key);
      return {
        ...group,
        tag,
        // ...and colored by the ONE color the tag has: `buildTagColors` keys
        // case-insensitively, so a split cannot paint the card a color the rows
        // behind it disagree with. A tag no address carries (catalog only) keeps
        // the color stored for it.
        color: tagColorFor(tagColors, tag) ?? group.color,
        spellings: variant?.spellings ?? [group.tag],
        // The colors other than the one the card paints. A color split is INVISIBLE
        // on screen - every chip resolves the tag to one color - so storage holds a
        // disagreement the UI has already settled, which is what the offer fixes.
        // `colors[0]` is the kept color, so the rest are the ones it would drop.
        otherColors: (colorVariant?.colors ?? []).slice(1),
      };
    })
    .sort((a, b) => a.tag.localeCompare(b.tag));
});

type TagEditDraft = {
  oldTag: string;
  newTag: string;
  color: string;
  isNew?: boolean;
  assignIds: string[];
};
let editingTag = $state<TagEditDraft | null>(null);
let initialTagDraft = $state<TagEditDraft | null>(null);
function tagDraftSignature(draft: TagEditDraft): string {
  return JSON.stringify([draft.newTag, draft.color.toLowerCase(), [...draft.assignIds].sort()]);
}
let tagFormHasChanges = $derived(
  editingTag !== null &&
    initialTagDraft !== null &&
    tagDraftSignature(editingTag) !== tagDraftSignature(initialTagDraft)
);
let tagSaving = $state(false);
let tagErrorMsg = $state('');
/** After create - offer assign dialog if user skipped assignment */
let postCreateAssign = $state<{ tag: string; color: string } | null>(null);
let postAssignIds = $state<string[]>([]);

function tagOpenEditor(draft: TagEditDraft) {
  initialTagDraft = { ...draft, assignIds: [...draft.assignIds] };
  editingTag = draft;
  tagErrorMsg = '';
  postCreateAssign = null;
}

function tagStartCreate() {
  tagOpenEditor({ oldTag: '', newTag: '', color: '#6750a4', isNew: true, assignIds: [] });
}

let lastTagCreateSignal = 0;
$effect(() => {
  const n = tagCreateSignal;
  if (n > 0 && n !== lastTagCreateSignal) {
    lastTagCreateSignal = n;
    tagStartCreate();
  }
});

function tagStartEdit(tag: string, color: string, accounts: Address[]) {
  tagOpenEditor({
    oldTag: tag,
    newTag: tag,
    color,
    isNew: false,
    assignIds: accounts.map((a) => a.id),
  });
}

function tagCancelEdit() {
  if (tagSaving) return;
  if (tagFormHasChanges) {
    showConfirm($t('identities.discardChangesPrompt'), tagCloseEditor);
  } else {
    tagCloseEditor();
  }
}

function tagCloseEditor() {
  editingTag = null;
  initialTagDraft = null;
  tagErrorMsg = '';
}

function tagResetChanges() {
  if (tagSaving || !initialTagDraft) return;
  editingTag = { ...initialTagDraft, assignIds: [...initialTagDraft.assignIds] };
  tagErrorMsg = '';
}

function toggleAssignId(id: string) {
  if (!editingTag) return;
  const set = new Set(editingTag.assignIds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  editingTag = { ...editingTag, assignIds: [...set] };
}

async function applyTagToAddresses(
  tag: string,
  color: string,
  assignIds: string[],
  oldTag?: string
) {
  const addresses = await getAddresses();
  const assignSet = new Set(assignIds);
  const updated = addresses.map((a) => {
    let nextTags = tagsForAddress(a);
    if (oldTag) {
      nextTags = nextTags.filter((entry) => entry.name.toLowerCase() !== oldTag.toLowerCase());
    }
    if (assignSet.has(a.id)) {
      const existingIndex = nextTags.findIndex(
        (entry) => entry.name.toLowerCase() === tag.toLowerCase()
      );
      if (existingIndex >= 0) {
        nextTags = nextTags.map((entry, index) =>
          index === existingIndex ? { name: tag, color } : entry
        );
      } else {
        nextTags = [...nextTags, { name: tag, color }];
      }
    }
    if (
      nextTags.length === tagsForAddress(a).length &&
      nextTags.every((entry, index) => {
        const previous = tagsForAddress(a)[index];
        return previous?.name === entry.name && previous?.color === entry.color;
      })
    ) {
      return a;
    }
    return addressWithTags(a, nextTags);
  });
  await setAddresses(updated);
}

async function tagSaveEdit() {
  if (!editingTag) return;
  const { oldTag, newTag, color, isNew, assignIds } = editingTag;
  const trimmed = newTag.trim();
  if (!trimmed) {
    tagErrorMsg = get(t)('tagManagement.tagNameEmpty');
    return;
  }
  if (trimmed.includes(',')) {
    tagErrorMsg = get(t)('tagManagement.tagNameComma');
    return;
  }
  // Unique name (case-insensitive) among other tags
  const clash = tagGroups.some(
    (g) => g.tag.toLowerCase() === trimmed.toLowerCase() && g.tag !== oldTag
  );
  if (clash) {
    tagErrorMsg = get(t)('tagManagement.tagNameDuplicate');
    return;
  }
  tagSaving = true;
  try {
    if (isNew || !oldTag) {
      tagCatalog = await persistTagCatalog((current) => [
        ...current.filter((c) => c.tag.toLowerCase() !== trimmed.toLowerCase()),
        { tag: trimmed, color, createdAt: Date.now() },
      ]);
      if (assignIds.length > 0) {
        await applyTagToAddresses(trimmed, color, assignIds);
        await onReloadAddresses();
        tagCloseEditor();
      } else {
        tagCloseEditor();
        // Suggest assignment dialog (issue 14)
        postCreateAssign = { tag: trimmed, color };
        postAssignIds = [];
      }
      return;
    }
    await applyTagToAddresses(trimmed, color, assignIds, oldTag);
    tagCatalog = await persistTagCatalog((current) => {
      const nextCat = current.map((c) => (c.tag === oldTag ? { ...c, tag: trimmed, color } : c));
      // Ensure catalog entry exists
      if (!nextCat.some((c) => c.tag === trimmed)) {
        nextCat.push({ tag: trimmed, color, createdAt: Date.now() });
      }
      return nextCat;
    });
    await onReloadAddresses();
    tagCloseEditor();
  } catch (error) {
    logError(
      'Failed to save mailbox tag',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    tagErrorMsg = $t('toasts.operationFailed');
  } finally {
    tagSaving = false;
  }
}

async function deleteTag(tag: string) {
  showConfirm(
    get(t)('tagManagement.removeTagConfirm', { values: { name: tag } }),
    () => {
      void (async () => {
        tagSaving = true;
        try {
          const addresses = await getAddresses();
          const updated = addresses.map((a) => {
            const previous = tagsForAddress(a);
            const next = previous.filter((entry) => entry.name.toLowerCase() !== tag.toLowerCase());
            return next.length === previous.length ? a : addressWithTags(a, next);
          });
          await setAddresses(updated);
          // Also remove from catalog (tags with 0 addresses)
          tagCatalog = await persistTagCatalog((current) => current.filter((c) => c.tag !== tag));
          await onReloadAddresses();
        } finally {
          tagSaving = false;
        }
      })();
    },
    { destructive: true }
  );
}

/**
 * Collapse a tag's case-variant spellings into the one the card keeps.
 *
 * A rename cannot do this, which is why the split had no way out: `tagSaveEdit`
 * rejects a name another card already holds (compared case-insensitively), so
 * `banking` could never be renamed to `Banking` while both existed. The addresses
 * and the catalog are rewritten together, in one confirm.
 */
function mergeSpellingVariants(group: { tag: string; spellings: string[] }) {
  const others = group.spellings.filter((name) => name !== group.tag);
  if (others.length === 0) return;
  showConfirm(
    get(t)('tagManagement.mergeSpellingsConfirm', {
      values: { variants: others.join(', '), canonical: group.tag },
    }),
    () => {
      void (async () => {
        tagSaving = true;
        try {
          // The one color the tag has, written into every merged entry: the merge
          // exists so the stored data matches what the UI already shows, and the
          // card has been showing one color all along.
          const sharedColor = tagColorFor(tagColors, group.tag);
          const addresses = await getAddresses();
          const merged = mergeTagSpellings(addresses, group.tag, sharedColor);
          if (merged.some((account, index) => account !== addresses[index])) {
            await setAddresses(merged);
          }

          // The catalog holds the spellings too, so collapse it the same way:
          // only the canonical entry survives, keeping its creation time and its
          // position in the list - and taking the tag's one color.
          const lower = group.tag.toLowerCase();
          const mergedCatalog = await persistTagCatalog((current) => {
            // only the canonical entry survives, keeping its creation time and
            // its position in the list - and taking the tag's one color.
            const nextCatalog: CatalogTag[] = [];
            let kept = false;
            for (const entry of current) {
              if (entry.tag.toLowerCase() !== lower) {
                nextCatalog.push(entry);
                continue;
              }
              if (kept) continue; // a second spelling of the same tag collapses
              kept = true;
              const color = sharedColor ?? entry.color;
              nextCatalog.push(
                entry.tag === group.tag && entry.color === color
                  ? entry
                  : { ...entry, tag: group.tag, color }
              );
            }
            return nextCatalog;
          });
          tagCatalog = mergedCatalog;

          await onReloadAddresses();
          toastStore.success(
            get(t)('tagManagement.mergeSpellingsDone', {
              values: { n: group.spellings.length, canonical: group.tag },
            })
          );
        } catch (error) {
          logError('Failed to merge tag spellings', error);
          toastStore.error(get(t)('toasts.operationFailed'));
        } finally {
          tagSaving = false;
        }
      })();
    }
  );
}

/**
 * Settle a tag's color split onto the color the UI already paints everywhere.
 *
 * The counterpart of `mergeSpellingVariants`, and it cannot be the same button:
 * this rewrites ONLY the colors and leaves the spellings exactly as they are, while
 * that one writes the winning spelling. Both end with storage matching the screen.
 * The color being kept is the one the card itself paints
 * (`buildTagColors` - most-used wins, ties keep the first seen), so the card and
 * the fix cannot disagree about which color survives.
 */
function unifyColorVariants(group: { tag: string; color: string; otherColors: TagColorUse[] }) {
  if (group.otherColors.length === 0) return;
  const dropped = group.otherColors.map((use) => use.color);
  showConfirm(
    get(t)('tagManagement.unifyColorsConfirm', {
      values: { tag: group.tag, from: dropped.join(', '), to: group.color },
    }),
    () => {
      void (async () => {
        tagSaving = true;
        try {
          const addresses = await getAddresses();
          const unified = unifyTagColors(addresses, group.tag, group.color);
          if (unified.some((account, index) => account !== addresses[index])) {
            await setAddresses(unified);
          }

          // The catalog is where a later assignment copies a new tag's color from,
          // so it moves with the addresses - a stale entry would write the color
          // this cleanup just dropped straight back onto the next address.
          const lower = group.tag.toLowerCase();
          const nextCatalog = await persistTagCatalog((current) =>
            current.map((entry) => {
              if (entry.tag.toLowerCase() !== lower || entry.color === group.color) return entry;
              return { ...entry, color: group.color };
            })
          );
          tagCatalog = nextCatalog;

          await onReloadAddresses();
          toastStore.success(
            get(t)('tagManagement.unifyColorsDone', {
              values: { n: dropped.length + 1, tag: group.tag },
            })
          );
        } catch (error) {
          logError('Failed to unify tag colors', error);
          toastStore.error(get(t)('toasts.operationFailed'));
        } finally {
          tagSaving = false;
        }
      })();
    }
  );
}

function togglePostAssign(id: string) {
  const set = new Set(postAssignIds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  postAssignIds = [...set];
}

async function savePostAssign() {
  if (!postCreateAssign) return;
  tagSaving = true;
  try {
    if (postAssignIds.length > 0) {
      await applyTagToAddresses(postCreateAssign.tag, postCreateAssign.color, postAssignIds);
      await onReloadAddresses();
    }
    postCreateAssign = null;
    postAssignIds = [];
  } finally {
    tagSaving = false;
  }
}

function formatTagCreated(ts: number): string {
  if (!ts) return '';
  try {
    return timeAgo(ts > 1e12 ? Math.floor(ts / 1000) : ts);
  } catch {
    /* ignore */
    return new Date(ts).toLocaleDateString($locale || 'en');
  }
}

// ── Labels ──────────────────────────────────────────────────────────────────

let labels = $state<LabelEntry[]>([]);
let labelsLoading = $state(true);
let labelsListEl = $state<HTMLElement | null>(null);
let labelSkeletonCount = $state(3);
$effect(() => {
  const list = labelsListEl;
  if (activeTab !== 'labels' || !labelsLoading || !list) return;

  const updateSkeletonCount = () => {
    // A 56px label row and 12px vertical gap.
    labelSkeletonCount = Math.max(1, Math.ceil(list.clientHeight / 68));
  };
  updateSkeletonCount();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(updateSkeletonCount);
    observer.observe(list);
    return () => observer.disconnect();
  }
  window.addEventListener('resize', updateSkeletonCount);
  return () => window.removeEventListener('resize', updateSkeletonCount);
});
let renamingLabel = $state<string | null>(null);
let labelRenameValue = $state('');
let labelRenameColor = $state('#6750a4');
let deleteConfirmTarget = $state<string | null>(null);
let creatingLabel = $state(false);
let createLabelValue = $state('');
let createLabelColor = $state('#6750a4');
let labelCatalog = $state<EmailLabelDef[]>([]);

let lastLabelCreateSignal = 0;
$effect(() => {
  const n = labelCreateSignal;
  if (n > 0 && n !== lastLabelCreateSignal) {
    lastLabelCreateSignal = n;
    creatingLabel = true;
    createLabelValue = '';
    createLabelColor = '#6750a4';
  }
});

async function loadLabels() {
  const request = ++labelGeneration;
  labelsLoading = true;
  labelLoadFailed = false;
  try {
    const [emailLabels, catalog, maps] = await Promise.all([
      getEmailLabelsMap(),
      getEmailLabelCatalog(),
      getEmailMaps(),
    ]);
    if (request !== labelGeneration) return;
    labelCatalog = catalog;
    labelUsage = buildLabelUsage(emailLabels, maps);
    const countMap: Record<string, number> = Object.create(null);
    for (const [label, messages] of Object.entries(labelUsage)) countMap[label] = messages.length;
    for (const def of labelCatalog) {
      if (countMap[def.name] === undefined) countMap[def.name] = 0;
    }
    labels = Object.entries(countMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  } catch (error) {
    if (request !== labelGeneration) return;
    labelLoadFailed = true;
    logError('Failed to load label usage', error);
    toastStore.error($t('toasts.operationFailed'));
  } finally {
    if (request === labelGeneration) labelsLoading = false;
  }
}

async function saveNewLabel() {
  const trimmed = createLabelValue.trim();
  if (!trimmed) {
    creatingLabel = false;
    return;
  }
  if (labels.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) {
    toastStore.error($t('labelManagement.duplicateName'));
    return;
  }
  try {
    const next = [
      ...labelCatalog.filter((d) => d.name.toLowerCase() !== trimmed.toLowerCase()),
      { name: trimmed, color: createLabelColor },
    ];
    labelCatalog = next;
    await setEmailLabelCatalog(next);
    creatingLabel = false;
    createLabelValue = '';
    createLabelColor = '#6750a4';
    await loadLabels();
  } catch (error) {
    logError('Failed to create label', error instanceof Error ? error : new Error(String(error)));
    toastStore.error($t('toasts.operationFailed'));
  }
}

function deleteLabel(labelName: string) {
  deleteConfirmTarget = labelName;
}

async function handleConfirmDeleteLabel() {
  if (!deleteConfirmTarget) return;
  const labelName = deleteConfirmTarget;
  deleteConfirmTarget = null;
  const emailLabels = await getEmailLabelsMap();
  const updated: Record<string, string[]> = {};
  for (const [id, labels] of Object.entries(emailLabels)) {
    if (!Array.isArray(labels)) continue;
    const filtered = labels.filter((labelName2) => labelName2 !== labelName);
    if (filtered.length > 0) updated[id] = filtered;
  }
  try {
    await emailLabelsStore.replaceMap(updated);
    const nextCatalog = labelCatalog.filter((def) => def.name !== labelName);
    labelCatalog = nextCatalog;
    await setEmailLabelCatalog(nextCatalog);
    await loadLabels();
  } catch (error) {
    logError('Failed to delete label', error instanceof Error ? error : new Error(String(error)));
    toastStore.error($t('toasts.operationFailed'));
  }
}

async function renameLabel(oldName: string, newName: string, color: string) {
  const trimmed = newName.trim();
  if (!trimmed || (trimmed === oldName && color === labelColorFor(labelCatalog, oldName))) {
    renamingLabel = null;
    return;
  }
  if (
    labels.some(
      (label) => label.name !== oldName && label.name.toLowerCase() === trimmed.toLowerCase()
    )
  ) {
    toastStore.error($t('labelManagement.duplicateName'));
    return;
  }
  try {
    if (trimmed !== oldName) {
      const emailLabels = await getEmailLabelsMap();
      const updated: Record<string, string[]> = {};
      for (const [id, currentLabels] of Object.entries(emailLabels)) {
        if (!Array.isArray(currentLabels)) continue;
        const renamed = currentLabels.map((labelName) =>
          labelName === oldName ? trimmed : labelName
        );
        updated[id] = [...new Set(renamed)];
      }
      await emailLabelsStore.replaceMap(updated);
    }
    const nextCatalog = labelCatalog.map((def) =>
      def.name === oldName ? { name: trimmed, color } : def
    );
    await setEmailLabelCatalog(nextCatalog);
    labelCatalog = nextCatalog;
    renamingLabel = null;
    labelRenameValue = '';
    labelRenameColor = '#6750a4';
    await loadLabels();
  } catch (error) {
    logError('Failed to rename label', error instanceof Error ? error : new Error(String(error)));
    toastStore.error($t('toasts.operationFailed'));
  }
}

function labelStartRename(name: string) {
  renamingLabel = name;
  labelRenameValue = name;
  labelRenameColor = labelColorFor(labelCatalog, name);
}

function labelCancelCreate() {
  creatingLabel = false;
  createLabelValue = '';
  createLabelColor = '#6750a4';
}

function labelCancelRename() {
  renamingLabel = null;
  labelRenameValue = '';
  labelRenameColor = '#6750a4';
}

onMount(() => {
  loadLabels().catch((err) => {
    logError('Failed to load labels in onMount', undefined, err);
  });

  const handleStorageChange = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;
    if (
      changes.emailLabels ||
      changes.emailLabelCatalog ||
      Object.keys(changes).some(
        (key) => key === EMAIL_STORAGE_ADDRESS_INDEX_KEY || isEmailStorageBagKey(key)
      )
    ) {
      loadLabels().catch((err) => {
        logError('Failed to load labels on storage change', undefined, err);
      });
    }
  };

  browser.storage.onChanged.addListener(handleStorageChange);
  // Return the teardown from onMount - a nested onDestroy would be ignored by
  // Svelte 5 (lifecycle must be called during init), leaking the listener.
  return () => {
    labelGeneration += 1;
    browser.storage.onChanged.removeListener(handleStorageChange);
  };
});

// ── Filters ─────────────────────────────────────────────────────────────────

let filterRenamingId = $state<string | null>(null);
let filterRenameValue = $state('');
let filterSaving = $state(false);
/** Full edit of filter conditions (not just rename) */
let filterEditingId = $state<string | null>(null);
let filterEditDraft = $state({
  name: '',
  searchQuery: '',
  hasOTP: false,
  senderDomain: '',
  dateFrom: '',
  dateTo: '',
  sortBy: 'newest',
});

function filterStartRename(filter: SavedSearchFilter) {
  filterRenamingId = filter.id;
  filterRenameValue = filter.name;
  filterEditingId = null;
}

function filterCancelRename() {
  filterRenamingId = null;
  filterRenameValue = '';
}

async function filterSaveRename() {
  if (!filterRenamingId) return;
  const trimmed = filterRenameValue.trim();
  if (!trimmed) return;
  filterSaving = true;
  try {
    await renameFilterInStorage(browser.storage.local, filterRenamingId, trimmed);
    await onFiltersChange();
    filterRenamingId = null;
  } finally {
    filterSaving = false;
  }
}

function filterStartEdit(filter: SavedSearchFilter) {
  filterEditingId = filter.id;
  filterRenamingId = null;
  filterEditDraft = {
    name: filter.name,
    searchQuery: filter.searchQuery || '',
    hasOTP: !!filter.hasOTP,
    senderDomain: filter.senderDomain || '',
    dateFrom: filter.dateFrom || '',
    dateTo: filter.dateTo || '',
    sortBy: filter.sortBy || 'newest',
  };
}

function filterCancelEdit() {
  filterEditingId = null;
}

// Each editor uses ModalDialog, which owns its Escape tier and focus lifecycle.
// A second parent registration can sit above the modal and block its handler.

async function filterSaveEdit() {
  if (!filterEditingId) return;
  const name = filterEditDraft.name.trim();
  if (!name) return;
  filterSaving = true;
  try {
    const next = savedSearchFilters.map((f: SavedSearchFilter) =>
      f.id === filterEditingId
        ? {
            ...f,
            name,
            searchQuery: filterEditDraft.searchQuery.trim(),
            hasOTP: filterEditDraft.hasOTP,
            senderDomain: filterEditDraft.senderDomain.trim(),
            dateFrom: filterEditDraft.dateFrom,
            dateTo: filterEditDraft.dateTo,
            sortBy: filterEditDraft.sortBy,
          }
        : f
    );
    await writeWithRetry({ savedSearchFilters: next });
    await onFiltersChange();
    filterEditingId = null;
  } finally {
    filterSaving = false;
  }
}

async function deleteFilter(id: string, name: string) {
  showConfirm(
    get(t)('filtersManagement.deleteFilterConfirm', { values: { name } }),
    () => {
      void (async () => {
        filterSaving = true;
        try {
          await deleteFilterFromStorage(browser.storage.local, id);
          await onFiltersChange();
        } finally {
          filterSaving = false;
        }
      })();
    },
    { destructive: true }
  );
}

function formatFilterDate(ts: number): string {
  return new Date(ts).toLocaleDateString($locale || 'en');
}

const filteredTagGroups = $derived(
  tagGroups.filter((group) =>
    [group.tag, ...group.spellings, ...group.accounts.map((a) => a.address)].some((text) =>
      text.toLowerCase().includes(searches.tags.trim().toLowerCase())
    )
  )
);
const filteredLabels = $derived(
  labels.filter((label) => label.name.toLowerCase().includes(searches.labels.trim().toLowerCase()))
);

function getFilterSummary(f: SavedSearchFilter): string {
  const tr = $t;
  const parts: string[] = [];
  if (f.searchQuery) parts.push(`"${f.searchQuery}"`);
  if (f.hasOTP) parts.push(tr('filtersManagement.otpOnly'));
  if (f.unreadOnly) parts.push('is:unread');
  if (f.hasAttachment) parts.push('has:attachment');
  if (f.senderEmail) parts.push(`from:${f.senderEmail}`);
  if (f.recipient) parts.push(`to:${f.recipient}`);
  if (f.subject) parts.push(`subject:${f.subject}`);
  if (f.notSenderDomain) parts.push(`!from:${f.notSenderDomain}`);
  if (f.notSenderEmail) parts.push(`!from:${f.notSenderEmail}`);
  if (f.notRecipient) parts.push(`!to:${f.notRecipient}`);
  if (f.notSubject) parts.push(`!subject:${f.notSubject}`);
  if (f.selectedSenders?.length) parts.push(...f.selectedSenders.map((sender) => `from:${sender}`));
  if (f.senderDomain)
    parts.push(tr('filtersManagement.fromDomain', { values: { domain: f.senderDomain } }));
  if (f.dateFrom) parts.push(tr('filtersManagement.fromDate', { values: { date: f.dateFrom } }));
  if (f.dateTo) parts.push(tr('filtersManagement.toDate', { values: { date: f.dateTo } }));
  return parts.length > 0 ? parts.join(' · ') : tr('filtersManagement.noConditions');
}
</script>

<div class="scroll-frame relative flex flex-col h-full min-h-0">
  <div class="scroll-edge shrink-0 pt-2 pb-2 border-b border-md-outline-variant/30 space-y-2">
    <Tabs
      tabs={tabItems}
      bind:activeTab
      idPrefix={tabsIdPrefix}
      ariaLabel={$t('nav.organize')}
      showInSidebar={true}
      variant="pill"
      fullWidth={true}
      onchange={(id) => {
        activeTab = id as OrganizeTab;
        onTabChange(activeTab);
      }}
    />
    <FloatingAction
      kind={activeTab === 'labels' ? 'createLabel' : activeTab === 'filters' ? 'createFilter' : 'createTag'}
      onclick={() => {
        if (activeTab === 'tags') {
          tagStartCreate();
        } else if (activeTab === 'labels') {
          creatingLabel = true;
          createLabelValue = '';
          createLabelColor = '#6750a4';
        }
      }}
    />
    <p class="ui-support text-md-on-surface-variant">{activeSubtitle}</p>
    <SearchFilterHeader bind:value={searches[activeTab]} scope={`organize-${activeTab}`} placeholder={searchPlaceholder} ariaLabel={searchPlaceholder} totalCount={activeTab === 'tags' ? tagGroups.length : activeTab === 'labels' ? labels.length : savedSearchFilters.length} filteredCount={activeTab === 'tags' ? filteredTagGroups.length : activeTab === 'labels' ? filteredLabels.length : filteredSavedFilters.length} showSlashButton borderBottom={false} paddingClass="p-0" onInputRef={(input) => { organizeSearchInput = input; }} />
  </div>

  <div
    id="{tabsIdPrefix}-panel-{activeTab}"
    class="flex-1 min-h-0 overflow-hidden"
    role="tabpanel"
    aria-labelledby="{tabsIdPrefix}-tab-{activeTab}"
    tabindex="0"
  >
    {#if activeTab === 'tags'}
      <div class="relative flex flex-col h-full min-h-0">
        <div class="scroll-body scroll-body-framed flex-1 {tagGroups.length > 0 ? 'overflow-y-auto' : 'overflow-hidden'} py-3 min-h-0">
          {#if tagGroups.length === 0}
            <EmptyState
              icon="tag"
              title={$t('tagManagement.noTags')}
              description={$t('tagManagement.noTagsHint')}
              fillParent
            />
          {:else}
            <div
              class="grid gap-3"
              style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));"
            >
              {#if filteredTagGroups.length === 0}
                <EmptyState compact icon="search" title={$t('savedLoginInfo.noResultsMatchSearch')} description={$t('common.noMatchesHint')} actionLabel={$t('common.clearSearch')} onAction={() => { searches.tags = ''; organizeSearchInput?.focus(); }} />
              {/if}
              {#each filteredTagGroups as group (group.tag)}
                <div class="density-row-pad bg-md-surface-container-low rounded-xl border border-md-outline-variant/20 px-4 min-w-0">
                  <div class="flex items-center justify-between gap-2">
                    <!-- The chip edits the tag; its separate usage action opens
                         the same addresses named by the shared usage helper. -->
                    <TagPill
                      tag={group.tag}
                      tagColor={group.color}
                      showIcon={true}
                      usage={tagUsageFor(group.tag)}
                      showUsageCount={false}
                      onClick={() => tagStartEdit(group.tag, group.color, group.accounts)}
                    />
                    <button type="button" class="min-h-8 rounded-lg px-2 ui-label text-md-primary {controlSurface(false)}" onclick={() => { usageTarget = { kind: 'tag', name: group.tag }; }} aria-label={$t('organize.openTagUsage', { values: { name: group.tag } })}>
                      {pluralMessage($t, { oneKey: 'mailProvider.addressCount', otherKey: 'mailProvider.addressCountPlural' }, tagUsageFor(group.tag)?.count || 0)}
                    </button>
                    <div class="flex flex-nowrap gap-2" use:responsiveButtonLayout data-action-tier="XS">
                      <button
                        type="button"
                        class="md-action w-8 h-8 flex items-center justify-center rounded-full text-md-primary transition-colors"
                        onclick={() => tagStartEdit(group.tag, group.color, group.accounts)}
                        aria-label={$t('tagManagement.editTag', { values: { name: group.tag } })}
                        title={$t('tagManagement.editTag', { values: { name: group.tag } })}
                      >
                        <Icon name="editSquare" class="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        class="md-action w-8 h-8 flex items-center justify-center rounded-full text-md-error transition-colors"
                        onclick={() => deleteTag(group.tag)}
                        aria-label={$t('tagManagement.deleteTag', { values: { name: group.tag } })}
                        disabled={tagSaving}
                      >
                        <Icon name="delete" class="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  {#if group.createdAt || group.spellings.length > 1 || group.otherColors.length > 0}
                    <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {#if group.createdAt}
                        <p class="text-xs text-md-on-surface/45">
                          {$t('tagManagement.createdAt', {
                            values: { time: formatTagCreated(group.createdAt) },
                          })}
                        </p>
                      {/if}
                      {#if group.spellings.length > 1}
                        <!-- Shown only while a case split exists, on the single card
                             that now stands in for it: one click to make the
                             stored spellings match what the UI already shows. -->
                        <Btn
                          variant="warningTonal"
                          size="sm"
                          disabled={tagSaving}
                          onclick={(e) => {
                            e.stopPropagation();
                            mergeSpellingVariants(group);
                          }}
                          title={$t('tagManagement.mergeSpellingsFor', {
                            values: { name: group.tag },
                          })}
                          aria-label={$t('tagManagement.mergeSpellingsFor', {
                            values: { name: group.tag },
                          })}
                        >
                          {$t('tagManagement.mergeSpellings', {
                            values: { n: group.spellings.length },
                          })}
                        </Btn>
                      {:else if group.otherColors.length > 0}
                        <!--
                          Suppressed while the spelling merge is on the card: that
                          merge already writes the tag's ONE color, so offering this
                          too would be the same fix twice. One button per card, and
                          it is the disagreement storage actually holds.
                        -->
                        <Btn
                          variant="warningTonal"
                          size="sm"
                          disabled={tagSaving}
                          onclick={(e) => {
                            e.stopPropagation();
                            unifyColorVariants(group);
                          }}
                          title={$t('tagManagement.unifyColorsFor', {
                            values: { name: group.tag },
                          })}
                          aria-label={$t('tagManagement.unifyColorsFor', {
                            values: { name: group.tag },
                          })}
                        >
                          {$t('tagManagement.unifyColors', {
                            values: { n: group.otherColors.length + 1 },
                          })}
                        </Btn>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
          <div
            class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
            style="height: calc(var(--bottom-safe-area, 0px) + 16px);"
            aria-hidden="true"
          ></div>
        </div>

        {#if editingTag}
          <ModalDialog
            open={!!editingTag}
            title={editingTag.isNew
              ? $t('tagManagement.createTitle')
              : $t('tagManagement.editTag', { values: { name: editingTag.oldTag } })}
            subtitle={editingTag.isNew ? $t('tagManagement.createHint') : $t('tagManagement.editHint')}
            compact
            onClose={tagCancelEdit}
            maxWidth="sm"
            wrapTitle
            showCloseButton={false}
          >
            {#snippet headerActions()}
              <IconButton icon="close" size="sm" ariaLabel={$t('common.close')} disabled={tagSaving} onclick={tagCancelEdit} />
            {/snippet}
            <div class="dialog-form min-w-0">
              <div class="dialog-field">
                <label for="organize-tag-name" class="dialog-field-label">{$t('tagManagement.tagName')}</label>
                <InputField
                  id="organize-tag-name"
                  bind:value={editingTag.newTag}
                  disabled={tagSaving}
                  error={tagErrorMsg}
                  oninput={(e) => {
                    tagErrorMsg = e.currentTarget.value.includes(',') ? $t('tagManagement.tagNameComma') : '';
                  }}
                  onkeydown={(e) => {
                    if (e.key === ',') {
                      e.preventDefault();
                      tagErrorMsg = $t('tagManagement.tagNameComma');
                    }
                  }}
                  onpaste={(e) => {
                    if (e.clipboardData?.getData('text').includes(',')) {
                      e.preventDefault();
                      tagErrorMsg = $t('tagManagement.tagNameComma');
                    }
                  }}
                />
              </div>
              <div class="dialog-field">
                <p class="dialog-field-label">{$t('tagManagement.tagColor')}</p>
                <div class="flex items-center gap-2">
                <ColorPicker
                  bind:value={editingTag.color}
                  triggerSize="touch"
                  triggerIcon="edit"
                  allowClear={false}
                  disabled={tagSaving}
                  ariaLabel={$t('tagManagement.tagColor')}
                />
                <span class="text-xs font-mono text-md-on-surface-variant">{editingTag.color}</span>
                </div>
              </div>
              <fieldset class="min-w-0 space-y-2" disabled={tagSaving}>
                <legend class="dialog-field-label">
                  {$t('tagManagement.assignAddresses')}
                </legend>
                <div
                  class="rounded-lg divide-y divide-md-outline-variant"
                >
                  {#if allAddresses.length === 0}
                    <p class="text-sm text-md-on-surface-variant px-4 py-3">
                      {$t('tagManagement.noAddresses')}
                    </p>
                  {:else}
                    {#each allAddresses as acc (acc.id)}
                      <label
                        class="flex items-center gap-2 pe-4 min-h-14 cursor-pointer {rowSurface({})}"
                      >
                        <Checkbox
                          size="touch"
                          disabled={tagSaving}
                          checked={editingTag.assignIds.includes(acc.id)}
                          onchange={() => toggleAssignId(acc.id)}
                        />
                        <span
                          class="text-sm text-md-on-surface min-w-0 break-all py-2"
                          style="direction:ltr;unicode-bidi:isolate;">{acc.address}</span
                        >
                      </label>
                    {/each}
                  {/if}
                </div>
              </fieldset>
            </div>
            {#snippet footer()}
              <div class="flex flex-nowrap gap-3 w-full" use:responsiveButtonLayout data-action-tier="S">
                <Btn
                  variant="primary"
                  class="flex-1"
                  disabled={tagSaving}
                  loading={tagSaving}
                  onClick={() => void tagSaveEdit()}
                  style="border-radius: var(--md-shape-full);"
                >
                  {$t('common.save')}
                </Btn>
                <Btn
                  variant="ghost"
                  class="flex-1"
                  disabled={tagSaving}
                  title={tagFormHasChanges ? $t('identities.resetChangesHint') : undefined}
                  onClick={tagFormHasChanges ? tagResetChanges : tagCancelEdit}
                  style="border-radius: var(--md-shape-full); color: var(--md-primary);"
                >
                  {tagFormHasChanges ? $t('identities.resetChanges') : $t('common.cancel')}
                </Btn>
              </div>
            {/snippet}
          </ModalDialog>
        {/if}

        {#if postCreateAssign}
          <ModalDialog
            open={!!postCreateAssign}
            title={$t('tagManagement.assignAfterCreate', {
              values: { name: postCreateAssign.tag },
            })}
            onClose={() => {
              postCreateAssign = null;
              postAssignIds = [];
            }}
            maxWidth="sm"
          >
            <div
              class="scroll-body max-h-56 overflow-y-auto rounded-lg divide-y divide-md-outline-variant"
            >
              {#each allAddresses as acc (acc.id)}
                <label
                  class="flex items-center gap-2 pe-4 min-h-14 cursor-pointer {rowSurface({})}"
                >
                  <Checkbox
                    size="touch"
                    disabled={tagSaving}
                    checked={postAssignIds.includes(acc.id)}
                    onchange={() => togglePostAssign(acc.id)}
                  />
                  <span
                    class="text-sm text-md-on-surface min-w-0 break-all py-2"
                    style="direction:ltr;unicode-bidi:isolate;">{acc.address}</span
                  >
                </label>
              {/each}
            </div>
            {#snippet footer()}
              <div class="flex flex-nowrap gap-3 w-full" use:responsiveButtonLayout data-action-tier="S">
                <Btn
                  variant="primary"
                  class="flex-1"
                  disabled={tagSaving}
                  loading={tagSaving}
                  onClick={() => void savePostAssign()}
                >
                  {$t('tagManagement.assignSave')}
                </Btn>
                <Btn
                  variant="ghost"
                  class="flex-1"
                  onClick={() => {
                    postCreateAssign = null;
                    postAssignIds = [];
                  }}
                >
                  {$t('tagManagement.skipAssign')}
                </Btn>
              </div>
            {/snippet}
          </ModalDialog>
        {/if}
      </div>
    {:else if activeTab === 'labels'}
      <div class="relative flex flex-col h-full min-h-0">
        <div bind:this={labelsListEl} class="scroll-body scroll-body-framed flex-1 {labelsLoading || labels.length > 0 ? 'overflow-y-auto' : 'overflow-hidden'} py-3 space-y-3 min-h-0">
          {#if labelsLoading}
            {#each Array(labelSkeletonCount) as _, i (i)}
              <Skeleton width="100%" height="3.5rem" radius="0.75rem" />
            {/each}
          {:else if labelLoadFailed}
            <EmptyState compact icon="warning" title={$t('toasts.operationFailed')} actionLabel={$t('common.retry')} onAction={() => void loadLabels()} />
          {:else if labels.length === 0}
            <EmptyState
              icon="tag"
              title={$t('labelManagement.noLabels')}
              description={$t('labelManagement.noLabelsHint')}
              fillParent
            />
          {:else}
            <div
              class="grid gap-3"
              style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));"
            >
              {#if filteredLabels.length === 0}
                <EmptyState compact icon="search" title={$t('savedLoginInfo.noResultsMatchSearch')} description={$t('common.noMatchesHint')} actionLabel={$t('common.clearSearch')} onAction={() => { searches.labels = ''; organizeSearchInput?.focus(); }} />
              {/if}
              {#each filteredLabels as label}
                <div
                  class="density-row-pad bg-md-surface-container-low rounded-xl border border-md-outline-variant/20 px-4 flex items-center gap-3 min-w-0"
                >
                  <Badge
                    variant="tag"
                    size="md"
                    icon="tag"
                    customColor={labelColorFor(labelCatalog, label.name)}
                    label={label.name}
                    class="shrink-0"
                  />
                  <button type="button" class="flex-1 min-w-0 rounded-lg p-1 ui-label text-md-primary {controlSurface(false)}" onclick={() => { usageTarget = { kind: 'label', name: label.name }; }} aria-label={$t('organize.openLabelUsage', { values: { name: label.name } })}>
                      {pluralMessage(
                        $t,
                        {
                          oneKey: 'labelManagement.emailCount',
                          otherKey: 'labelManagement.emailCountPlural',
                        },
                        label.count
                      )}
                  </button>
                  <div class="flex flex-nowrap items-center gap-2 min-w-0" use:responsiveButtonLayout data-action-tier="XS">
                    <button
                      type="button"
                      class="md-action h-8 rounded-lg bg-md-secondary-container text-md-on-secondary-container transition-colors"
                      onclick={() => labelStartRename(label.name)}
                    ><span class="btn-label">{$t('labelManagement.rename')}</span></button>
                    <button
                      type="button"
                      class="md-action h-8 flex items-center justify-center rounded-full text-md-error transition-colors"
                      aria-label={$t('labelManagement.deleteLabel')}
                      onclick={() => deleteLabel(label.name)}
                    >
                      <Icon name="delete" class="w-5 h-5" />
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
          <div
            class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
            style="height: calc(var(--bottom-safe-area, 0px) + 16px);"
            aria-hidden="true"
          ></div>
        </div>

        {#if creatingLabel}
          <ModalDialog
            open={creatingLabel}
            title={$t('labelManagement.newLabelPlaceholder')}
            onClose={labelCancelCreate}
            maxWidth="sm"
          >
            <div class="flex items-center gap-2">
              <input
                type="color"
                class="w-8 h-8 rounded-lg cursor-pointer border-0 p-0.5 bg-transparent shrink-0"
                bind:value={createLabelColor}
                aria-label={$t('labelManagement.labelColor')}
                title={$t('labelManagement.labelColor')}
              />
              <input
                class="flex-1 bg-md-secondary-container rounded-lg px-3 py-2 text-sm text-md-on-secondary-container outline-none border border-md-primary min-w-0"
                placeholder={$t('labelManagement.newLabelPlaceholder')}
                bind:value={createLabelValue}
                onkeydown={(e) => {
                  if (e.key === 'Enter') void saveNewLabel();
                  else if (e.key === 'Escape') labelCancelCreate();
                }}
              />
            </div>
            {#snippet footer()}
              <div class="flex flex-nowrap gap-3 w-full" use:responsiveButtonLayout data-action-tier="S">
                <Btn
                  variant="ghost"
                  class="flex-1"
                  onClick={labelCancelCreate}
                >
                  {$t('common.cancel')}
                </Btn>
                <Btn
                  variant="primary"
                  class="flex-1"
                  onClick={() => void saveNewLabel()}
                >
                  {$t('common.save')}
                </Btn>
              </div>
            {/snippet}
          </ModalDialog>
        {/if}

        {#if renamingLabel}
          <ModalDialog
            open={!!renamingLabel}
            title={$t('labelManagement.rename')}
            onClose={labelCancelRename}
            maxWidth="sm"
          >
            <div class="flex items-center gap-2">
              <input
                type="color"
                class="w-8 h-8 rounded-lg cursor-pointer border-0 p-0.5 bg-transparent shrink-0"
                bind:value={labelRenameColor}
                aria-label={$t('labelManagement.labelColor')}
                title={$t('labelManagement.labelColor')}
              />
              <input
                class="flex-1 bg-md-secondary-container rounded-lg px-3 py-2 text-sm text-md-on-secondary-container outline-none border border-md-primary min-w-0"
                bind:value={labelRenameValue}
                onkeydown={(e) => {
                  if (e.key === 'Enter' && renamingLabel)
                    void renameLabel(renamingLabel, labelRenameValue, labelRenameColor);
                  else if (e.key === 'Escape') labelCancelRename();
                }}
              />
            </div>
            {#snippet footer()}
              <div class="flex flex-nowrap gap-3 w-full" use:responsiveButtonLayout data-action-tier="S">
                <Btn
                  variant="ghost"
                  class="flex-1"
                  onClick={labelCancelRename}
                >
                  {$t('common.cancel')}
                </Btn>
                <Btn
                  variant="primary"
                  class="flex-1"
                  onClick={() =>
                    renamingLabel && void renameLabel(renamingLabel, labelRenameValue, labelRenameColor)
                  }
                >
                  {$t('common.save')}
                </Btn>
              </div>
            {/snippet}
          </ModalDialog>
        {/if}
      </div>
    {:else}
      <div class="relative flex flex-col h-full min-h-0">
        <div class="scroll-body scroll-body-framed flex-1 {savedSearchFilters.length > 0 ? 'overflow-y-auto' : 'overflow-hidden'} py-3 space-y-3 min-h-0">
          {#if savedSearchFilters.length === 0}
            <EmptyState
              icon="search"
              title={$t('filtersManagement.noFilters')}
              description={$t('filtersManagement.noFiltersHint')}
              fillParent
            />
          {:else}
            <div
              class="grid gap-3"
              style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));"
            >
              {#if filteredSavedFilters.length === 0}
                <EmptyState compact icon="search" title={$t('savedLoginInfo.noResultsMatchSearch')} description={$t('common.noMatchesHint')} actionLabel={$t('common.clearSearch')} onAction={() => { searches.filters = ''; organizeSearchInput?.focus(); }} />
              {/if}
              {#each filteredSavedFilters as filter}
                <div class="density-row-pad bg-md-surface-container-low rounded-xl border border-md-outline-variant/20 px-4 min-w-0 flex items-start justify-between gap-2">
                    <button
                      type="button"
                      class="flex-1 text-start min-w-0"
                      onclick={() => void applySavedFilter(filter)}
                      disabled={!!applyingFilterId}
                      aria-label={$t('organize.applyFilter', {
                        values: { name: filter.name },
                      })}
                    >
                      <div class="font-medium text-sm text-md-on-surface truncate">
                        {filter.name}
                      </div>
                      <div class="text-xs text-md-on-surface/50 mt-0.5 line-clamp-2">
                        {getFilterSummary(filter)}
                      </div>
                      <div class="text-xs text-md-on-surface/35 mt-0.5">
                        {$t('filtersManagement.created', {
                          values: { date: formatFilterDate(filter.createdAt) },
                        })}
                      </div>
                      <span class="mt-1 inline-flex items-center gap-1 ui-label text-md-primary"><Icon name="forward" class="w-4 h-4" />{$t('common.apply')}</span>
                    </button>
                    <div class="flex flex-nowrap gap-2" use:responsiveButtonLayout data-action-tier="XS">
                      <button type="button" class="md-action w-8 h-8 flex items-center justify-center rounded-full text-md-primary transition-colors" onclick={() => filterStartEdit(filter)} aria-label={$t('filtersManagement.editFilter', { values: { name: filter.name } })} title={$t('filtersManagement.editFilter', { values: { name: filter.name } })}>
                        <Icon name="filter" class="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        class="md-action w-8 h-8 flex items-center justify-center rounded-full text-md-on-surface-variant transition-colors"
                        onclick={() => filterStartRename(filter)}
                        aria-label={$t('filtersManagement.renameFilter', {
                          values: { name: filter.name },
                        })}
                        title={$t('filtersManagement.renameFilter', {
                          values: { name: filter.name },
                        })}
                      >
                        <Icon name="edit" class="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        class="md-action w-8 h-8 flex items-center justify-center rounded-full text-md-error transition-colors"
                        onclick={() => deleteFilter(filter.id, filter.name)}
                        aria-label={$t('filtersManagement.deleteFilter', {
                          values: { name: filter.name },
                        })}
                        disabled={filterSaving}
                      >
                        <Icon name="delete" class="w-5 h-5" />
                      </button>
                    </div>
                </div>
              {/each}
            </div>
          {/if}

          <div
            class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
            style="height: calc(var(--bottom-safe-area, 0px) + 16px);"
            aria-hidden="true"
          ></div>
        </div>

        {#if filterEditingId}
          <ModalDialog
            open={!!filterEditingId}
            title={$t('filtersManagement.editFilter', {
              values: { name: filterEditDraft.name || '' },
            })}
            onClose={filterCancelEdit}
            maxWidth="sm"
          >
            <div class="space-y-2">
              <label class="block text-sm text-md-on-surface-variant" for="edit-filter-name"
                >{$t('filtersManagement.filterName')}</label
              >
              <input
                id="edit-filter-name"
                type="text"
                class="w-full bg-md-secondary-container text-sm text-md-on-secondary-container rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-md-primary"
                bind:value={filterEditDraft.name}
              />
              <label class="block text-sm text-md-on-surface-variant" for="edit-filter-q"
                >{$t('filtersManagement.searchQuery')}</label
              >
              <input
                id="edit-filter-q"
                type="text"
                class="w-full bg-md-secondary-container text-sm text-md-on-secondary-container rounded-lg px-3 py-1.5 outline-none"
                bind:value={filterEditDraft.searchQuery}
                placeholder={$t('filtersManagement.searchQueryPlaceholder')}
              />
              <label class="block text-sm text-md-on-surface-variant" for="edit-filter-dom"
                >{$t('filtersManagement.senderDomain')}</label
              >
              <input
                id="edit-filter-dom"
                type="text"
                class="w-full bg-md-secondary-container text-sm text-md-on-secondary-container rounded-lg px-3 py-1.5 outline-none"
                bind:value={filterEditDraft.senderDomain}
                placeholder="example.com"
              />
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-sm text-md-on-surface-variant" for="edit-filter-from"
                    >{$t('filtersManagement.dateFrom')}</label
                  >
                  <input
                    id="edit-filter-from"
                    type="date"
                    class="w-full bg-md-secondary-container text-sm rounded-lg px-2 py-1.5 outline-none"
                    bind:value={filterEditDraft.dateFrom}
                  />
                </div>
                <div>
                  <label class="block text-sm text-md-on-surface-variant" for="edit-filter-to"
                    >{$t('filtersManagement.dateTo')}</label
                  >
                  <input
                    id="edit-filter-to"
                    type="date"
                    class="w-full bg-md-secondary-container text-sm rounded-lg px-2 py-1.5 outline-none"
                    bind:value={filterEditDraft.dateTo}
                  />
                </div>
              </div>
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox bind:checked={filterEditDraft.hasOTP} />
                {$t('filtersManagement.otpOnly')}
              </label>
            </div>
            {#snippet footer()}
              <div class="flex flex-nowrap gap-3 w-full pt-1" use:responsiveButtonLayout data-action-tier="S">
                <Btn
                  variant="ghost"
                  class="flex-1"
                  onClick={filterCancelEdit}
                >
                  {$t('common.cancel')}
                </Btn>
                <Btn
                  variant="primary"
                  class="flex-1"
                  disabled={filterSaving}
                  loading={filterSaving}
                  onClick={filterSaveEdit}
                >
                  {$t('common.save')}
                </Btn>
              </div>
            {/snippet}
          </ModalDialog>
        {/if}

        {#if filterRenamingId}
          <ModalDialog
            open={!!filterRenamingId}
            title={$t('filtersManagement.filterName')}
            onClose={filterCancelRename}
            maxWidth="sm"
          >
            <input
              type="text"
              class="w-full bg-md-secondary-container text-sm text-md-on-secondary-container rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-md-primary"
              bind:value={filterRenameValue}
              placeholder={$t('filtersManagement.filterName')}
              aria-label={$t('filtersManagement.filterName')}
            />
            {#snippet footer()}
              <div class="flex flex-nowrap gap-3 w-full" use:responsiveButtonLayout data-action-tier="S">
                <Btn
                  variant="ghost"
                  class="flex-1"
                  onClick={filterCancelRename}
                >
                  {$t('common.cancel')}
                </Btn>
                <Btn
                  variant="primary"
                  class="flex-1"
                  disabled={filterSaving}
                  loading={filterSaving}
                  onClick={filterSaveRename}
                >
                  {$t('common.save')}
                </Btn>
              </div>
            {/snippet}
          </ModalDialog>
        {/if}
      </div>
    {/if}
  </div>
</div>

{#if usageTarget}
  <ModalDialog open title={usageTarget.kind === 'tag' ? $t('organize.tagUsageTitle', { values: { name: usageTarget.name } }) : $t('organize.labelUsageTitle', { values: { name: usageTarget.name } })} onClose={() => { if (!usageBusy) usageTarget = null; }} maxWidth="lg">
    <div class="divide-y divide-md-outline-variant/30" data-organize-usage={usageTarget.kind}>
      {#if usageTarget.kind === 'tag'}
        {#each usageAddresses as address (address.id)}
          <button type="button" class="w-full rounded-lg p-3 text-start {rowSurface({})}" disabled={usageBusy} onclick={() => void openUsageAddress(address)}>
            <span class="block text-sm text-md-on-surface break-all">{address.address}</span>
            <span class="block ui-support text-md-on-surface-variant">{address.accountStatus === 'deleted' ? $t('address.statusDeleted') : address.accountStatus === 'archived' ? $t('common.archived') : address.status === 'expired' ? $t('inbox.expired') : $t('address.live')}</span>
          </button>
        {:else}
          <EmptyState compact icon="tag" title={$t('organize.noUsage')} />
        {/each}
      {:else if labelsLoading}
        <Skeleton width="100%" height="4rem" radius="0.75rem" />
      {:else if labelLoadFailed}
        <EmptyState compact icon="warning" title={$t('toasts.operationFailed')} actionLabel={$t('common.retry')} onAction={() => void loadLabels()} />
      {:else}
        {#each usageEmails as email (`${email.original_inbox}_${email.id}`)}
          <button type="button" class="w-full rounded-lg p-3 text-start {rowSurface({})}" onclick={() => { onOpenMessage(email); usageTarget = null; }}>
            <span class="block text-sm font-medium text-md-on-surface break-words">{email.subject || $t('emailList.noSubject')}</span>
            <span class="block ui-support text-md-on-surface-variant break-all">{email.from_name || email.from} · {email.original_inbox}</span>
          </button>
        {:else}
          <EmptyState compact icon="mail" title={$t('organize.noUsage')} />
        {/each}
      {/if}
    </div>
  </ModalDialog>
{/if}

<ConfirmDialog
  confirmDialog={deleteConfirmTarget
    ? {
        title: $t('labelManagement.deleteLabel'),
        message: $t('labelManagement.deleteConfirm', {
          values: { name: deleteConfirmTarget },
        }),
        confirmLabel: $t('common.delete'),
        onConfirm: handleConfirmDeleteLabel,
        destructive: true,
      }
    : null}
  onClose={() => {
    deleteConfirmTarget = null;
  }}
/>
