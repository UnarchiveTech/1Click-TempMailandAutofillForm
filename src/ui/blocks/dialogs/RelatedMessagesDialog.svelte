<script lang="ts">
import { onMount, tick } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import {
  buildRelatedMessages,
  type RelatedMessage,
  type RelatedMessageKind,
} from '@/features/login-info/related-messages.js';
import ActiveFilterChips from '@/ui/components/composites/ActiveFilterChips.svelte';
import AppLoadingSkeleton from '@/ui/components/composites/AppLoadingSkeleton.svelte';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import MessageSourcePreview from '@/ui/components/composites/MessageSourcePreview.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import SearchFilterHeader from '@/ui/components/composites/SearchFilterHeader.svelte';
import Badge from '@/ui/components/primitives/Badge.svelte';
import Btn from '@/ui/components/primitives/Btn.svelte';
import Dropdown from '@/ui/components/primitives/Dropdown.svelte';
import { htmlToPlainText } from '@/utils/email/sanitize-html.js';
import { logError } from '@/utils/logger.js';
import {
  EMAIL_STORAGE_ADDRESS_INDEX_KEY,
  getEmailMaps,
  isEmailStorageBagKey,
} from '@/utils/storage/storage-keys.js';
import { formatFullDateTime } from '@/utils/time/time-format.js';
import type { CredentialsHistoryItem } from '@/utils/types.js';
import { PORTAL_Z } from '@/utils/ui/portal-layers.js';
import { toastStore } from '@/utils/ui/toastStore.js';

let {
  login,
  onClose,
}: { login: Pick<CredentialsHistoryItem, 'domain' | 'email'>; onClose: () => void } = $props();
let entries = $state<RelatedMessage[]>([]);
let query = $state('');
let kind = $state('');
let limit = $state(30);
let sourceKey = $state<string | null>(null);
let listElement: HTMLDivElement;
let searchInput: HTMLInputElement | null = null;
let previewTrigger: HTMLElement | null = null;
let listScrollTop = 0;
let loading = $state(true);
let failed = $state(false);
let generation = 0;
let disposed = false;
const kindKeys: Record<RelatedMessageKind, string> = {
  verification: 'relatedMessages.verification',
  receipt: 'relatedMessages.receipts',
  security: 'relatedMessages.security',
  other: 'relatedMessages.other',
};
const options = $derived([
  { value: '', label: $t('relatedMessages.all') },
  ...Object.entries(kindKeys).map(([value, key]) => ({ value, label: $t(key) })),
]);
const activeFilters = $derived([
  ...(query.trim() ? [{ id: 'query', label: `${$t('common.search')}: ${query.trim()}` }] : []),
  ...(kind
    ? [
        {
          id: 'kind',
          label: `${$t('relatedMessages.category')}: ${options.find((option) => option.value === kind)?.label ?? kind}`,
        },
      ]
    : []),
]);
function clearFilters() {
  query = '';
  kind = '';
}
async function viewMessage(key: string, event: MouseEvent) {
  previewTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  listScrollTop = listElement.closest('.scroll-body')?.scrollTop ?? 0;
  sourceKey = key;
  await tick();
  const scroller = listElement.closest('.scroll-body');
  if (scroller) scroller.scrollTop = 0;
}
async function backToResults() {
  sourceKey = null;
  await tick();
  const scroller = listElement.closest('.scroll-body');
  if (scroller) scroller.scrollTop = listScrollTop;
  if (previewTrigger?.isConnected) previewTrigger.focus({ preventScroll: true });
  else searchInput?.focus({ preventScroll: true });
}
const filtered = $derived(
  entries.filter((entry) => {
    const haystack = [entry.message.subject, entry.message.from, entry.message.from_name]
      .join('\n')
      .normalize('NFKC')
      .toLowerCase();
    return (
      (!kind || entry.kind === kind) &&
      query
        .normalize('NFKC')
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .every((term) => haystack.includes(term))
    );
  })
);
const source = $derived(entries.find((entry) => entry.key === sourceKey));
const body = $derived(
  source
    ? source.message.body_plain ||
        htmlToPlainText(source.message.body_html || source.message.body || '')
    : ''
);
$effect(() => {
  void query;
  void kind;
  limit = 30;
});

async function refresh() {
  const request = ++generation;
  try {
    const maps = await getEmailMaps();
    if (disposed || request !== generation) return;
    entries = buildRelatedMessages(login, maps.storedEmails, maps.archivedEmails);
    failed = false;
    if (sourceKey && !entries.some((entry) => entry.key === sourceKey)) void backToResults();
  } catch (error) {
    if (disposed || request !== generation) return;
    failed = true;
    logError('Failed to read related messages', error);
    toastStore.error($t('relatedMessages.loadFailed'));
  } finally {
    if (!disposed && request === generation) loading = false;
  }
}

onMount(() => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onChanged = (changes: Record<string, unknown>, area: string) => {
    if (
      area !== 'local' ||
      !Object.keys(changes).some(
        (key) => key === EMAIL_STORAGE_ADDRESS_INDEX_KEY || isEmailStorageBagKey(key)
      )
    )
      return;
    generation += 1;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 80);
  };
  browser.storage.onChanged.addListener(onChanged);
  void refresh();
  return () => {
    disposed = true;
    generation += 1;
    clearTimeout(timer);
    browser.storage.onChanged.removeListener(onChanged);
  };
});
</script>

<ModalDialog open={true} title={$t('relatedMessages.title')} subtitle={$t('relatedMessages.hint')} {onClose} maxWidth="xl">
  <div bind:this={listElement} style:display={source ? 'none' : undefined} class="dialog-content-stack" data-related-messages>
    <p class="text-sm font-medium text-md-on-surface break-words"><bdi>{login.domain}</bdi> · <bdi>{login.email}</bdi></p>
    <SearchFilterHeader bind:value={query} placeholder={$t('relatedMessages.search')} ariaLabel={$t('relatedMessages.search')} scope="relatedMessages" paddingClass="p-0" borderBottom={false} showVoiceSearch={false} class="bg-transparent! backdrop-blur-none!" onInputRef={(input) => { searchInput = input; }} />
    <Dropdown bind:value={kind} {options} label={$t('relatedMessages.category')} zIndex={PORTAL_Z.dialogMenu} />
    <ActiveFilterChips filters={activeFilters} onRemove={(id) => { if (id === 'query') query = ''; else kind = ''; }} onClear={clearFilters} onEmpty={() => searchInput?.focus()} />
    {#if loading}
      <AppLoadingSkeleton className="h-48" ariaLabel={$t('common.loading')} />
    {:else if failed}
      <EmptyState compact icon="mail" title={$t('relatedMessages.loadFailed')} actionLabel={$t('common.retry')} onAction={() => void refresh()} />
    {:else if filtered.length === 0}
      <EmptyState compact icon="mail" title={entries.length ? $t('relatedMessages.empty') : $t('relatedMessages.noMessages')} description={entries.length ? $t('common.noMatchesHint') : $t('relatedMessages.emptyHint')} actionLabel={activeFilters.length ? $t('savedLoginInfo.clearFilters') : undefined} onAction={() => { clearFilters(); searchInput?.focus(); }} />
    {:else}
      <p class="text-xs text-md-on-surface-variant" role="status">{$t('common.showingCount', { values: { n: filtered.length, m: entries.length } })}</p>
      <ol class="space-y-3">
        {#each filtered.slice(0, limit) as entry (entry.key)}
          <li class="rounded-xl bg-md-surface-container-high p-3 space-y-2" data-related-message>
            <div class="flex flex-wrap items-center gap-2"><Badge variant="neutral">{$t(kindKeys[entry.kind])}</Badge>{#if entry.archived}<Badge variant="neutral">{$t('common.archived')}</Badge>{/if}</div>
            <p class="text-sm font-medium text-md-on-surface break-words">{entry.message.subject || $t('addressView.noSubject')}</p>
            <p class="text-xs text-md-on-surface-variant break-words"><bdi>{entry.message.from_name || entry.message.from}</bdi> · {formatFullDateTime(entry.message.received_at)}</p>
            <Btn variant="tonal" icon="mail" label={$t('attachmentLibrary.viewMessage')} onclick={(event) => void viewMessage(entry.key, event)} />
          </li>
        {/each}
      </ol>
      {#if limit < filtered.length}<Btn variant="tonal" label={$t('relatedMessages.more')} onclick={() => { limit += 30; }} />{/if}
    {/if}
  </div>
  {#if source}
    <div data-related-source><MessageSourcePreview message={source.message} inbox={source.inbox} {body} onBack={() => void backToResults()} /></div>
  {/if}
</ModalDialog>
