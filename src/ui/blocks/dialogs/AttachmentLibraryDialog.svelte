<script lang="ts">
import { onMount, tick } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import {
  attachmentDownloadUrl,
  attachmentTypeLabel,
  buildAttachmentLibrary,
  filterAttachmentLibrary,
  type LibraryAttachment,
} from '@/features/attachments/attachment-library.js';
import ActiveFilterChips from '@/ui/components/composites/ActiveFilterChips.svelte';
import AppLoadingSkeleton from '@/ui/components/composites/AppLoadingSkeleton.svelte';
import ButtonGroup from '@/ui/components/composites/ButtonGroup.svelte';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import MessageSourcePreview from '@/ui/components/composites/MessageSourcePreview.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import SearchFilterHeader from '@/ui/components/composites/SearchFilterHeader.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
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
import { PORTAL_Z } from '@/utils/ui/portal-layers.js';
import { toastStore } from '@/utils/ui/toastStore.js';

let { onClose }: { onClose: () => void } = $props();
let entries = $state<LibraryAttachment[]>([]);
let query = $state('');
let fileType = $state('');
let inbox = $state('');
let loading = $state(true);
let failed = $state(false);
let limit = $state(40);
let sourceKey = $state<string | null>(null);
let listElement: HTMLDivElement;
let searchInput: HTMLInputElement | null = null;
let previewTrigger: HTMLElement | null = null;
let listScrollTop = 0;
let generation = 0;
let disposed = false;

const filtered = $derived(filterAttachmentLibrary(entries, query, fileType, inbox));
const source = $derived(entries.find((entry) => entry.key === sourceKey) ?? null);
const sourceBody = $derived(
  source
    ? source.message.body_plain ||
        htmlToPlainText(source.message.body_html || source.message.body || '')
    : ''
);
const typeOptions = $derived([
  { value: '', label: $t('attachmentLibrary.allTypes') },
  ...Array.from(new Set(entries.map((entry) => entry.fileType).filter(Boolean)))
    .sort()
    .map((value) => ({ value, label: attachmentTypeLabel(value) })),
]);
const inboxOptions = $derived([
  { value: '', label: $t('attachmentLibrary.allInboxes') },
  ...Array.from(new Set(entries.map((entry) => entry.inbox)))
    .sort()
    .map((value) => ({ value, label: value })),
]);
const activeFilters = $derived([
  ...(query.trim() ? [{ id: 'query', label: `${$t('common.search')}: ${query.trim()}` }] : []),
  ...(fileType
    ? [
        {
          id: 'fileType',
          label: `${$t('attachmentLibrary.fileType')}: ${attachmentTypeLabel(fileType)}`,
        },
      ]
    : []),
  ...(inbox ? [{ id: 'inbox', label: `${$t('attachmentLibrary.inbox')}: ${inbox}` }] : []),
]);
function clearFilters() {
  query = '';
  fileType = '';
  inbox = '';
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

$effect(() => {
  void query;
  void fileType;
  void inbox;
  limit = 40;
});

async function refresh() {
  const request = ++generation;
  failed = false;
  try {
    const maps = await getEmailMaps();
    if (disposed || request !== generation) return;
    entries = buildAttachmentLibrary(maps.storedEmails, maps.archivedEmails);
    if (sourceKey && !entries.some((entry) => entry.key === sourceKey)) void backToResults();
    if (fileType && !entries.some((entry) => entry.fileType === fileType)) fileType = '';
    if (inbox && !entries.some((entry) => entry.inbox === inbox)) inbox = '';
  } catch (error) {
    if (disposed || request !== generation) return;
    failed = true;
    logError('Failed to load attachment library', error);
    toastStore.error($t('attachmentLibrary.loadFailed'));
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

async function download(entry: LibraryAttachment) {
  const url = attachmentDownloadUrl(entry.attachment?.downloadUrl);
  if (!url) return;
  try {
    await browser.tabs.create({ url });
  } catch (error) {
    logError('Failed to open attachment download', error);
    toastStore.error($t('attachmentLibrary.downloadFailed'));
  }
}
</script>

<ModalDialog open={true} title={$t('attachmentLibrary.title')} subtitle={$t('attachmentLibrary.description')} maxWidth="xl" {onClose}>
  <div bind:this={listElement} style:display={source ? 'none' : undefined} class="dialog-content-stack" data-attachment-library>
    <SearchFilterHeader bind:value={query} placeholder={$t('attachmentLibrary.search')} ariaLabel={$t('attachmentLibrary.search')} scope="attachmentLibrary" showVoiceSearch={false} borderBottom={false} paddingClass="p-0" class="bg-transparent! backdrop-blur-none!" onInputRef={(input) => { searchInput = input; }} />
    <div class="grid grid-cols-2 gap-3">
      <Dropdown bind:value={fileType} options={typeOptions} label={$t('attachmentLibrary.fileType')} class="min-w-0" zIndex={PORTAL_Z.dialogMenu} />
      <Dropdown bind:value={inbox} options={inboxOptions} label={$t('attachmentLibrary.inbox')} class="min-w-0" zIndex={PORTAL_Z.dialogMenu} />
    </div>
    <ActiveFilterChips filters={activeFilters} onRemove={(id) => { if (id === 'query') query = ''; else if (id === 'fileType') fileType = ''; else inbox = ''; }} onClear={clearFilters} onEmpty={() => searchInput?.focus()} />
    {#if loading}
      <AppLoadingSkeleton className="h-48 flex flex-col gap-3" ariaLabel={$t('common.loading')} />
    {:else if failed}
      <EmptyState compact icon="description" title={$t('attachmentLibrary.loadFailed')} actionLabel={$t('common.retry')} onAction={() => void refresh()} />
    {:else}
      <p class="text-xs text-md-on-surface-variant" role="status">{$t('common.showingCount', { values: { n: filtered.length, m: entries.length } })}</p>
      {#if filtered.length === 0}
        <EmptyState compact icon="description" title={entries.length ? $t('attachmentLibrary.empty') : $t('attachmentLibrary.noAttachments')} description={entries.length ? $t('attachmentLibrary.emptyHint') : $t('attachmentLibrary.noAttachmentsHint')} actionLabel={activeFilters.length ? $t('savedLoginInfo.clearFilters') : undefined} onAction={() => { clearFilters(); searchInput?.focus(); }} />
      {:else}
        <ul class="space-y-3">
          {#each filtered.slice(0, limit) as entry (entry.key)}
            <li class="rounded-xl bg-md-surface-container-high p-3 space-y-2" data-attachment-entry>
              <div class="flex items-start gap-2">
                <Icon name="description" class="w-5 h-5 shrink-0 text-md-primary" />
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-md-on-surface break-words">{entry.attachment?.filename || $t('attachmentLibrary.unknownFilename')}</p>
                  <p class="text-xs text-md-on-surface-variant break-words">{entry.message.from_name || entry.message.from || $t('attachmentLibrary.unknownSender')}{entry.message.from_name && entry.message.from ? ` · ${entry.message.from}` : ''}</p>
                </div>
                {#if entry.archived}<Badge variant="neutral">{$t('common.archived')}</Badge>{/if}
              </div>
              <p class="text-xs text-md-on-surface-variant break-words">{entry.inbox} · {formatFullDateTime(entry.message.received_at)}</p>
              {#if entry.fileType}<p class="text-xs text-md-on-surface-variant break-all">{attachmentTypeLabel(entry.fileType)}</p>{/if}
              {#if entry.message.subject}<p class="text-sm text-md-on-surface break-words">{entry.message.subject}</p>{/if}
              {#if !attachmentDownloadUrl(entry.attachment?.downloadUrl)}
                <p class="text-xs text-md-on-surface-variant">{$t(entry.attachment ? 'attachmentLibrary.noDownload' : 'attachmentLibrary.metadataMissing')}</p>
              {/if}
              <ButtonGroup>
                <Btn variant="tonal" icon="mail" label={$t('attachmentLibrary.viewMessage')} onclick={(event) => void viewMessage(entry.key, event)} />
                {#if attachmentDownloadUrl(entry.attachment?.downloadUrl)}
                  <Btn variant="primary" icon="download" label={$t('inbox.emailActions.download')} onclick={() => void download(entry)} />
                {/if}
              </ButtonGroup>
            </li>
          {/each}
        </ul>
        {#if limit < filtered.length}
          <Btn variant="tonal" label={$t('attachmentLibrary.showMore')} class="w-full" onclick={() => { limit += 40; }} />
        {/if}
      {/if}
    {/if}
  </div>
  {#if source}
    <div data-attachment-source><MessageSourcePreview message={source.message} inbox={source.inbox} body={sourceBody} onBack={() => void backToResults()} /></div>
  {/if}
</ModalDialog>
