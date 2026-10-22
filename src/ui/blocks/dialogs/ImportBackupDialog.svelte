<script lang="ts">
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import {
  BACKUP_CATEGORY_META,
  type BackupCategory,
  type BackupFileV3,
  type BackupInspection,
  type ConflictPolicy,
  type ExpiredAddressMode,
  formatBytes,
  type ImportPreview,
  type ImportSummary,
  importBackup,
  inspectBackup,
  MAX_BACKUP_IMPORT_BYTES,
  type ParseBackupResult,
  parseBackupText,
  previewImport,
  reencryptPayloadToLocalKey,
  resolveBackupPayload,
} from '@/features/settings/backup-actions.js';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Checkbox, Radio } from '@/ui/components/primitives';
import Btn from '@/ui/components/primitives/Btn.svelte';
import {
  BaseExtensionError,
  ErrorCode,
  localizedErrorMessageOrFallback,
  translateResultMessage,
} from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';

let {
  open = false,
  onClose = () => {},
  onSuccess = (_summary?: string, _result?: ImportSummary) => {},
  onError = (_msg: string) => {},
  loadAddresses = async () => {},
}: {
  open?: boolean;
  onClose?: () => void;
  onSuccess?: (summary?: string, result?: ImportSummary) => void;
  onError?: (message: string) => void;
  loadAddresses?: () => Promise<void>;
} = $props();

let step = $state<1 | 2 | 3>(1);
let fileName = $state('');
let fileBytes = $state(0);
let parsed = $state<ParseBackupResult | null>(null);
let payload = $state<BackupFileV3 | null>(null);
/** True when a password-encrypted backup's secrets were re-encrypted to THIS device's key. */
let keyReencrypted = $state(false);
let undecryptableCount = $state(0);
let inspection = $state<BackupInspection | null>(null);
let dryRun = $state<ImportPreview | null>(null);
let parseError = $state('');
let importError = $state('');
let decryptPassword = $state('');
let needsPassword = $state(false);
let selected = $state<Record<BackupCategory, boolean>>({
  settings: true,
  identities: true,
  savedLogins: true,
  addresses: true,
  filters: true,
  mailboxRules: true,
  siteRules: true,
});
let includeEmails = $state(true);
// Prefer importing expired sessions too so export → hard-reset → import restores mailboxes
let expiredMode = $state<ExpiredAddressMode>('all');
let conflictPolicy = $state<ConflictPolicy>('replace');
let isProcessing = $state(false);
let isDone = $state(false);
let dragOver = $state(false);
/** Inboxes imported without credentials (secrets dropped) - the re-auth walkthrough queue. */
let reauthQueue = $state<
  Array<{
    id: string;
    address: string;
    provider: string;
    status: 'pending' | 'working' | 'done' | 'failed';
    error?: string;
  }>
>([]);
let reauthPending = $derived(
  reauthQueue.filter((r) => r.status === 'pending' || r.status === 'failed').length
);
let reauthAllDone = $derived(
  reauthQueue.length > 0 && reauthQueue.every((r) => r.status === 'done')
);
let dialogRef = $state<HTMLElement | null>(null);
let fileInputRef = $state<HTMLInputElement | null>(null);
let showClipboardFallback = $state(false);
let clipboardFallbackText = $state('');

let presentCategories = $derived(inspection?.presentCategories ?? []);
let selectedCategories = $derived(presentCategories.filter((c) => selected[c]));
let canImport = $derived(
  !!payload && selectedCategories.length > 0 && !isProcessing && !parseError
);

function resetState() {
  step = 1;
  fileName = '';
  fileBytes = 0;
  parsed = null;
  payload = null;
  inspection = null;
  dryRun = null;
  parseError = '';
  importError = '';
  decryptPassword = '';
  needsPassword = false;
  selected = {
    settings: true,
    identities: true,
    savedLogins: true,
    addresses: true,
    filters: true,
    mailboxRules: true,
    siteRules: true,
  };
  includeEmails = true;
  expiredMode = 'all';
  conflictPolicy = 'replace';
  isProcessing = false;
  isDone = false;
  dragOver = false;
  keyReencrypted = false;
  undecryptableCount = 0;
  reauthQueue = [];
  if (fileInputRef) fileInputRef.value = '';
}

function applyDefaultSelection(present: BackupCategory[]) {
  const next: Record<BackupCategory, boolean> = {
    settings: false,
    identities: false,
    savedLogins: false,
    addresses: false,
    filters: false,
    mailboxRules: false,
    siteRules: false,
  };
  for (const c of present) next[c] = true;
  selected = next;
}

function selectAllPresent() {
  applyDefaultSelection(presentCategories);
  void refreshDryRun();
}

function clearAll() {
  selected = {
    settings: false,
    identities: false,
    savedLogins: false,
    addresses: false,
    filters: false,
    mailboxRules: false,
    siteRules: false,
  };
  dryRun = null;
}

function toggle(cat: BackupCategory) {
  if (!presentCategories.includes(cat)) return;
  selected[cat] = !selected[cat];
  selected = { ...selected };
  void refreshDryRun();
}

function categoryCountLabel(cat: BackupCategory): string {
  if (!inspection) return '';
  const c = inspection.counts;
  switch (cat) {
    case 'identities':
      return c.identities ? String(c.identities) : '';
    case 'savedLogins':
      return c.savedLogins ? String(c.savedLogins) : '';
    case 'addresses':
      return c.addressesTotal
        ? `${c.addressesTotal}${c.addressesExpired ? ` · ${c.addressesExpired}` : ''}`
        : '';
    case 'filters':
      return c.filters ? String(c.filters) : '';
    case 'mailboxRules':
      return c.mailboxRules ? String(c.mailboxRules) : '';
    case 'siteRules':
      return c.siteRules ? String(c.siteRules) : '';
    default:
      return '';
  }
}

async function refreshDryRun() {
  if (!payload || !selectedCategories.length) {
    dryRun = null;
    return;
  }
  try {
    dryRun = await previewImport(browser, payload, {
      categories: selectedCategories,
      includeEmails,
      expiredMode,
      conflictPolicy,
    });
  } catch (e) {
    logError('dry-run failed', e);
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open && !isProcessing) {
    e.stopPropagation();
    onClose();
  }
}

// Only reset when the dialog opens (open false→true), not on every reactive
// re-run mid-import. ModalDialog owns the shared focus/scroll lifecycle.
let wasOpen = false;
$effect(() => {
  if (!open) {
    wasOpen = false;
    return;
  }
  if (wasOpen) return;

  wasOpen = true;
  resetState();
  window.addEventListener('keydown', handleKeydown);
  return () => {
    window.removeEventListener('keydown', handleKeydown);
  };
});

async function loadFromText(text: string, name: string) {
  parseError = '';
  payload = null;
  inspection = null;
  dryRun = null;
  needsPassword = false;
  decryptPassword = '';
  fileName = name;
  // Reject oversized pastes / dropped text before parsing (the file picker and
  // drop handler cap on exact bytes; this catches the clipboard path).
  if (text.length > MAX_BACKUP_IMPORT_BYTES) {
    parseError = $t('backup.fileTooLarge');
    return;
  }
  try {
    const result = await parseBackupText(text);
    parsed = result;
    fileBytes = result.bytes;
    if (result.kind === 'encrypted') {
      needsPassword = true;
      step = 1;
      return;
    }
    await applyPlainPayload(result.payload, result.bytes);
  } catch (err) {
    parseError = localizedErrorMessageOrFallback(err, $t, 'errors.invalidBackupFormat');
    logError('Failed to parse backup', err);
  }
}

async function applyPlainPayload(p: BackupFileV3, bytes: number) {
  const insp = inspectBackup(p, Date.now(), bytes);
  payload = p;
  inspection = insp;
  applyDefaultSelection(insp.presentCategories);
  if (insp.presentCategories.length === 0) {
    parseError = $t('backup.emptyBackup');
    step = 1;
    return;
  }
  step = 2;
  await refreshDryRun();
}

async function unlockEncrypted() {
  if (parsed?.kind !== 'encrypted') return;
  parseError = '';
  try {
    const resolved = await resolveBackupPayload(parsed, decryptPassword);
    let p = resolved.payload;
    // Cross-device restore: if the backup wrapped the exporting device's
    // master key, decrypt every imported secret and re-encrypt it with THIS
    // device's key so the restore is actually usable here.
    if (resolved.wrappedMasterKey) {
      const r = await reencryptPayloadToLocalKey(
        p,
        resolved.wrappedMasterKey,
        decryptPassword,
        resolved.salt,
        resolved.kdf
      );
      p = r.payload;
      keyReencrypted = r.reencrypted;
      undecryptableCount = r.leftUntouched;
    }
    await applyPlainPayload(p, parsed.bytes);
    needsPassword = false;
  } catch (err) {
    // Wrong password, corrupt ciphertext and key mismatch all arrive as keyed
    // backup errors; an unexpected throw collapses to the same user-facing
    // reason instead of leaking its English message.
    parseError = localizedErrorMessageOrFallback(err, $t, 'errors.backupDecryptionFailed');
  }
}

async function readFileAsText(file: File): Promise<string> {
  // Prefer File.text(); fall back to FileReader (older Chromium / some drop payloads)
  try {
    if (typeof file.text === 'function') return await file.text();
  } catch {
    /* fall through */
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => {
      // FileReader rejects with a DOMException whose English message is not
      // user-facing: log it and reject with a keyed error so the caller's
      // localizedErrorMessageOrFallback() resolves it to translated copy
      // instead of leaking the raw value to the dialog.
      logError('FileReader failed to read import file', reader.error);
      reject(
        new BaseExtensionError('errors.backupFileReadFailed', ErrorCode.BACKUP_FILE_READ_FAILED)
      );
    };
    reader.readAsText(file);
  });
}

async function ingestFile(file: File | null | undefined) {
  if (!file) {
    parseError = $t('backup.emptyBackup');
    return;
  }
  // Cap on the declared size BEFORE `readFileAsText` materializes the blob - a
  // multi-gigabyte picked/dropped file must not be read into memory at all.
  if (file.size > MAX_BACKUP_IMPORT_BYTES) {
    parseError = $t('backup.fileTooLarge');
    return;
  }
  try {
    const text = await readFileAsText(file);
    if (!text?.trim()) {
      parseError = $t('backup.emptyBackup');
      return;
    }
    await loadFromText(text, file.name || 'import.json');
  } catch (err) {
    parseError = localizedErrorMessageOrFallback(err, $t, 'errors.backupFileReadFailed');
    logError('Failed to read import file', err);
  }
}

/** Optional: open full app tab for import (paste/drag still work in popup). */
async function openImportInFullPage() {
  try {
    await browser.storage.session.set({ openImportBackup: true, openImportAt: Date.now() });
  } catch {
    /* ignore */
    try {
      await writeWithRetry({ openImportBackup: true, openImportAt: Date.now() });
    } catch {
      /* ignore */
    }
  }
  try {
    const appUrl = (browser.runtime as unknown as { getURL: (path: string) => string }).getURL(
      '/app.html'
    );
    await browser.tabs.create({ url: appUrl });
  } catch {
    /* ignore */
    const appUrl = (browser.runtime as unknown as { getURL: (path: string) => string }).getURL(
      '/app.html'
    );
    window.open(appUrl, '_blank');
  }
  onClose();
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  await ingestFile(file);
  // Allow re-selecting the same file later
  try {
    input.value = '';
  } catch {
    /* ignore */
  }
}

async function onDrop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  dragOver = false;
  const dt = e.dataTransfer;
  let file = dt?.files?.[0] || null;
  // Some browsers only expose items, not files, until drop is fully handled
  if (!file && dt?.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file') {
        file = item.getAsFile();
        if (file) break;
      }
    }
  }
  // Text paste as last resort
  if (!file && dt) {
    const text = dt.getData('text/plain') || dt.getData('text');
    if (text?.trim()) {
      await loadFromText(text, 'dropped.json');
      return;
    }
  }
  await ingestFile(file);
}

async function pasteFromClipboard() {
  parseError = '';
  try {
    let text = '';
    // Prefer async clipboard API (needs clipboardRead + user gesture)
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Clipboard access may be blocked in a popup; use the extension dialog fallback.
      showClipboardFallback = true;
      return;
    }
    if (!text?.trim()) {
      parseError = $t('backup.clipboardEmpty');
      return;
    }
    await loadFromText(text, 'clipboard.json');
  } catch (e) {
    logError('Clipboard read failed', e);
    parseError = localizedErrorMessageOrFallback(e, $t, 'backup.clipboardFailed');
  }
}

function acceptClipboardFallback() {
  const text = clipboardFallbackText.trim();
  showClipboardFallback = false;
  clipboardFallbackText = '';
  if (text) void loadFromText(text, 'clipboard.json');
  else parseError = $t('backup.clipboardEmpty');
}

function goConfirm() {
  if (!canImport) {
    onError($t('backup.selectAtLeastOne'));
    return;
  }
  step = 3;
  void refreshDryRun();
}

async function handleImport() {
  if (!canImport || !payload) return;
  importError = '';
  isProcessing = true;
  try {
    const summary = await importBackup(
      browser,
      payload,
      {
        categories: selectedCategories,
        includeEmails: selected.addresses ? includeEmails : false,
        expiredMode,
        conflictPolicy,
      },
      loadAddresses
    );
    isDone = true;
    const parts: string[] = [];
    if (summary.importedAddresses)
      parts.push($t('backup.summaryAddresses', { values: { n: summary.importedAddresses } }));
    if (summary.skippedExpiredAddresses)
      parts.push(
        $t('backup.summarySkippedExpired', { values: { n: summary.skippedExpiredAddresses } })
      );
    if (summary.imported.identities)
      parts.push($t('backup.summaryIdentities', { values: { n: summary.imported.identities } }));
    if (summary.imported.savedLogins)
      parts.push($t('backup.summaryLogins', { values: { n: summary.imported.savedLogins } }));
    if (summary.keyFingerprintMismatch) parts.push($t('backup.keyMismatchWarning'));
    if (summary.secretsDropped) parts.push($t('backup.secretsDroppedWarning'));
    if (keyReencrypted) parts.push($t('backup.keyReencryptedNote'));
    if (undecryptableCount > 0)
      parts.push($t('backup.undecryptableSecretsWarning', { values: { n: undecryptableCount } }));
    onSuccess(parts.length ? parts.join(' · ') : undefined, summary);
    if (summary.secretsDroppedAddresses?.length) {
      // Secrets were dropped - keep the dialog open so the user can walk
      // through re-authenticating each affected inbox instead of hunting for
      // them manually afterwards.
      reauthQueue = summary.secretsDroppedAddresses.map((i) => ({
        id: i.id,
        address: i.address,
        provider: i.provider,
        status: 'pending' as const,
      }));
    } else {
      setTimeout(() => onClose(), 1800);
    }
  } catch (e) {
    logError('Import backup failed', e);
    isProcessing = false;
    importError = localizedErrorMessageOrFallback(e, $t, 'errors.importFailed');
    onError(importError);
  }
}

async function reauthenticateOne(id: string) {
  const item = reauthQueue.find((r) => r.id === id);
  if (!item || item.status === 'working' || item.status === 'done') return;
  item.status = 'working';
  item.error = undefined;
  reauthQueue = [...reauthQueue];
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'reauthenticateAddress',
      addressId: id,
    })) as { success?: boolean; error?: string } | undefined;
    if (res?.success) {
      item.status = 'done';
      await loadAddresses();
    } else {
      item.status = 'failed';
      // The background answers with an `errors.*` code - translate it for the
      // tooltip instead of rendering the raw key (or English payload).
      item.error = res?.error ? translateResultMessage(res.error, $t) : undefined;
    }
  } catch (e) {
    logError('Re-authentication request failed', e);
    item.status = 'failed';
    item.error = localizedErrorMessageOrFallback(e, $t, 'errors.reauthFailed');
  }
  reauthQueue = [...reauthQueue];
}

async function reauthenticateAll() {
  const ids = reauthQueue
    .filter((item) => item.status === 'pending' || item.status === 'failed')
    .map((item) => item.id);
  if (ids.length === 0) return;
  // One batched round-trip: the background re-authenticates every inbox under
  // a single locked pass (one address-list read + write) and reports per-id
  // outcomes - the walkthrough no longer issues N sequential reauths that each
  // re-read the full address list.
  let results: Array<{ addressId?: string; success?: boolean; error?: string }> = [];
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'reauthenticateAddresses',
      addressIds: ids,
    })) as
      | { results?: Array<{ addressId?: string; success?: boolean; error?: string }> }
      | undefined;
    results = Array.isArray(res?.results) ? res.results : [];
  } catch (e) {
    logError('Bulk re-authentication request failed', e);
    results = ids.map((id) => ({
      addressId: id,
      success: false,
      error: localizedErrorMessageOrFallback(e, $t, 'errors.reauthFailed'),
    }));
  }
  const byId = new Map(results.map((r) => [r.addressId, r]));
  for (const item of reauthQueue) {
    const r = byId.get(item.id);
    if (!r) continue;
    item.status = r.success ? 'done' : 'failed';
    item.error = r.success ? undefined : translateResultMessage(r.error, $t);
  }
  reauthQueue = [...reauthQueue];
  await loadAddresses();
}
</script>

<ModalDialog
    {open}
    activityDialogKey="dialog:import"
    title={$t('backup.importTitle')}
  subtitle={$t('backup.importSubtitle')}
  maxWidth="sm"
  bodyScroll={false}
  footer={!isDone || reauthQueue.length > 0 ? importFooter : undefined}
  showCloseButton={!isProcessing}
  onClose={() => {
    if (!isProcessing) onClose();
  }}
  progress={isProcessing && !isDone ? { indeterminate: true } : undefined}
  bind:dialogRef
>
  <div class="dialog-content-stack flex-1 min-h-0">
    <!-- Step progress indicator -->
    {#if !isDone}
      <div class="dialog-field scroll-edge shrink-0">
      <div class="flex items-center gap-1 text-xs font-semibold">
        {#each [1, 2, 3] as s (s)}
          <div
            class="flex-1 h-1 rounded-full {step >= s ? 'bg-md-primary' : 'bg-md-surface-variant/50'}"
          ></div>
        {/each}
      </div>
      <div class="flex justify-between text-xs text-md-on-surface/45">
        <span class={step === 1 ? 'text-md-primary font-bold' : ''}>{$t('backup.stepFile')}</span>
        <span class={step === 2 ? 'text-md-primary font-bold' : ''}>{$t('backup.stepChoose')}</span>
        <span class={step === 3 ? 'text-md-primary font-bold' : ''}>{$t('common.confirm')}</span>
      </div>
      </div>
    {/if}



      <div class="scroll-body scroll-body-framed flex-1 min-h-0 overflow-y-auto space-y-3">
        {#if isDone}
          <div class="dialog-body-padding flex flex-col items-center gap-2 text-center">
            <div class="w-12 h-12 rounded-full bg-md-primary/15 text-md-primary flex items-center justify-center">
              <Icon name="checkCircle" class="w-7 h-7" />
            </div>
            <h3 class="text-sm font-bold">{$t('backup.importComplete')}</h3>
            <p class="text-xs text-md-on-surface/60">{$t('backup.importCompleteHint')}</p>
          </div>

          {#if undecryptableCount > 0}
            <div class="rounded-xl border border-md-warning/40 bg-md-warning/10 p-3 space-y-1 text-start">
              <div class="text-xs font-bold flex items-center gap-1.5 text-md-warning">
                <Icon name="warning" class="w-4 h-4 shrink-0" />
                {$t('backup.undecryptableSecretsTitle')}
              </div>
              <p class="text-xs text-md-on-surface/70 leading-snug">
                {$t('backup.undecryptableSecretsWarning', { values: { n: undecryptableCount } })}
              </p>
            </div>
          {/if}

          {#if reauthQueue.length > 0}
            <div class="rounded-xl border border-md-warning/40 bg-md-warning/10 p-3 space-y-2">
              <div class="text-xs font-bold flex items-center gap-1.5 text-md-warning">
                <Icon name="warning" class="w-4 h-4 shrink-0" />
                {$t('backup.reauthNeededTitle')}
              </div>
              <p class="text-xs text-md-on-surface/70 leading-snug">{$t('backup.reauthNeededHint')}</p>
              <div class="flex flex-col gap-1.5">
                {#each reauthQueue as item (item.id)}
                  <div class="flex items-center gap-2 rounded-lg bg-md-surface-container px-2.5 py-2">
                    <div class="min-w-0 flex-1">
                      <div class="text-xs font-semibold truncate">{item.address}</div>
                      <div class="text-xs text-md-on-surface-variant truncate">{item.provider}</div>
                    </div>
                    {#if item.status === 'done'}
                      <span class="text-xs text-md-success flex items-center gap-1 shrink-0">
                        <Icon name="checkCircle" class="w-3.5 h-3.5" />{$t('backup.reauthDone')}
                      </span>
                    {:else if item.status === 'working'}
                      <span class="text-xs text-md-on-surface/50 shrink-0">{$t('backup.reauthWorking')}</span>
                    {:else if item.status === 'failed'}
                      <span class="text-xs text-md-error shrink-0" title={item.error}>{$t('backup.reauthFailed')}</span>
                    {:else}
                      <button
                        type="button"
                        class="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-lg bg-md-primary text-md-on-primary"
                        onclick={() => void reauthenticateOne(item.id)}
                      >
                        {$t('backup.reauthAction')}
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
              {#if reauthPending > 0}
                <Btn
                  variant="warningTonal"
                  size="sm"
                  class="w-full"
                  onclick={() => void reauthenticateAll()}
                >
                  {$t('backup.reauthAll', { values: { n: reauthPending } })}
                </Btn>
              {:else if reauthAllDone}
                <p class="text-xs font-semibold text-md-success flex items-center gap-1.5">
                  <Icon name="checkCircle" class="w-3.5 h-3.5 shrink-0" />
                  {$t('backup.reauthAllDone')}
                </p>
              {/if}
            </div>
          {/if}
        {:else if step === 1}
          <!-- File step -->
          <input
            bind:this={fileInputRef}
            type="file"
            accept=".json,.jsonc,.txt,application/json,text/json,text/plain,*/*"
            class="hidden"
            onchange={(e) => void onFileSelected(e)}
          />
          <div
            class="dialog-body-padding rounded-xl border-2 border-dashed px-4 text-center transition-colors {dragOver
              ? 'border-md-primary bg-md-primary/10'
              : 'border-md-primary/30 bg-md-surface-container-low/40'}"
            role="button"
            tabindex="0"
            ondragenter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragOver = true;
            }}
            ondragover={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
              dragOver = true;
            }}
            ondragleave={(e) => {
              e.preventDefault();
              dragOver = false;
            }}
            ondrop={(e) => void onDrop(e)}
            onclick={() => {
              fileInputRef?.click();
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                fileInputRef?.click();
              }
            }}
          >
            <Icon name="upload" class="w-8 h-8 mx-auto text-md-primary/70 mb-2" />
            <p class="text-sm font-semibold text-md-primary">{$t('backup.dropOrChoose')}</p>
            <p class="text-xs text-md-on-surface/50 mt-1">{$t('backup.chooseFile')}</p>
            <p class="text-xs text-md-on-surface/40 mt-2 px-2">{$t('backup.importPopupHint')}</p>
          </div>

          <div class="w-full flex flex-nowrap items-center gap-3" use:responsiveButtonLayout data-action-tier="S">
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl border border-md-outline text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
              onclick={() => { fileInputRef?.click(); }}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('backup.chooseFile')}</span>
            </button>
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl border border-md-outline text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
              onclick={() => { void openImportInFullPage(); }}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('backup.openFullPage')}</span>
            </button>
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl border border-md-outline text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
              onclick={() => { void pasteFromClipboard(); }}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('backup.pasteClipboard')}</span>
            </button>
          </div>

          {#if parseError}
            <div class="text-xs text-md-error bg-md-error/10 rounded-xl px-3 py-2">{parseError}</div>
          {/if}

          {#if fileName}
            <div class="text-xs text-md-on-surface/60 rounded-lg bg-md-surface-variant/25 px-3 py-2">
              <span class="font-semibold text-md-on-surface/80">{fileName}</span>
              {#if fileBytes}
                <span class="ms-1">· {formatBytes(fileBytes)}</span>
              {/if}
            </div>
          {/if}

          {#if needsPassword && parsed?.kind === 'encrypted'}
            <div class="space-y-2">
              <p class="text-sm text-md-on-surface-variant">{$t('preferences.decryptBackupPrompt')}</p>
              <input
                type="password"
                class="w-full px-3 py-2 text-sm rounded-xl border border-md-outline-variant/40 bg-md-surface-container"
                placeholder={$t('preferences.enterPassword')}
                bind:value={decryptPassword}
                autocomplete="current-password"
              />
              <button
                type="button"
                class="w-full px-3 py-2 text-sm font-semibold rounded-xl bg-md-primary text-md-on-primary"
                onclick={(e) => {
                  e.stopPropagation();
                  void unlockEncrypted();
                }}
              >
                {$t('backup.unlockBackup')}
              </button>
            </div>
          {/if}
        {:else if step === 2 && payload && inspection}
          <!-- Choose step -->
          {#if inspection.exportDate || inspection.version}
            <p class="text-xs text-md-on-surface/50">
              {#if inspection.version}v{inspection.version}{/if}
              {#if inspection.exportDate}
                · {new Date(inspection.exportDate).toLocaleString($locale || 'en')}
              {/if}
              {#if inspection.approximateBytes}
                · {formatBytes(inspection.approximateBytes)}
              {/if}
              {#if inspection.secretsExcluded}
                · {$t('backup.fileSecretsExcluded')}
              {/if}
            </p>
          {/if}

          {#if inspection.counts.addressesTotal > 0}
            <p class="text-xs text-md-on-surface/55 leading-snug">
              {$t('backup.addressSummary', {
                values: {
                  total: inspection.counts.addressesTotal,
                  expired: inspection.counts.addressesExpired,
                  renewable: inspection.counts.addressesExpiredRenewable,
                  nonRenewable: inspection.counts.addressesExpiredNonRenewable,
                },
              })}
            </p>
          {/if}

          <div class="w-full flex flex-nowrap items-center gap-3" use:responsiveButtonLayout data-action-tier="S">
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl border border-md-outline text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
              onclick={() => { selectAllPresent(); }}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.selectAll')}</span>
            </button>
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl border border-md-outline text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
              onclick={() => { clearAll(); }}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.clear')}</span>
            </button>
          </div>

          <p class="text-sm font-medium text-md-on-surface">{$t('backup.chooseWhatToImport')}</p>

          <div class="flex flex-col gap-1.5">
            {#each presentCategories as cat (cat)}
              <label
                class="flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer {selected[cat]
                  ? 'border-md-primary'
                  : 'border-md-outline-variant/20 bg-md-surface-container-low/50'}"
              >
                <Checkbox
                  class="shrink-0"
                  checked={selected[cat]}
                  onchange={() => toggle(cat)}
                  disabled={isProcessing}
                />
                <Icon name={BACKUP_CATEGORY_META[cat].icon} class="w-4 h-4 text-md-primary/80 shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold">{$t(`backup.category.${cat}`)}</div>
                  <div class="text-xs text-md-on-surface/50 truncate">
                    {$t(`backup.category.${cat}Hint`)}
                  </div>
                </div>
                {#if categoryCountLabel(cat)}
                  <span class="text-xs font-mono text-md-on-surface/45">({categoryCountLabel(cat)})</span>
                {/if}
              </label>
            {/each}
          </div>

          <!-- Conflict policy -->
          <div class="space-y-1.5">
            <div class="text-sm font-semibold text-md-on-surface">{$t('backup.conflictPolicy')}</div>
            <label class="flex items-start gap-2 text-sm cursor-pointer">
              <Radio
                checked={conflictPolicy === 'merge'}
                onchange={() => {
                  conflictPolicy = 'merge';
                  void refreshDryRun();
                }}
              />
              <span>
                <span class="font-semibold">{$t('backup.policyMerge')}</span>
                <span class="block text-xs text-md-on-surface/50">{$t('backup.policyMergeHint')}</span>
              </span>
            </label>
            <label class="flex items-start gap-2 text-sm cursor-pointer">
              <Radio
                checked={conflictPolicy === 'replace'}
                onchange={() => {
                  conflictPolicy = 'replace';
                  void refreshDryRun();
                }}
              />
              <span>
                <span class="font-semibold">{$t('backup.policyReplace')}</span>
                <span class="block text-xs text-md-on-surface/50">{$t('backup.policyReplaceHint')}</span>
              </span>
            </label>
          </div>

          {#if selected.addresses && presentCategories.includes('addresses')}
            <div class="ms-0.5 ps-3 border-s-2 border-md-primary/30 space-y-2">
              <label
                class="flex items-start gap-2 text-sm {selected.addresses
                  ? 'cursor-pointer'
                  : 'opacity-40 pointer-events-none'}"
              >
                <Checkbox
                  class="mt-0.5"
                  bind:checked={includeEmails}
                  disabled={isProcessing || !selected.addresses}
                  onchange={() => void refreshDryRun()}
                />
                <span>
                  <span class="font-semibold">{$t('backup.includeEmails')}</span>
                  <span class="block text-xs text-md-on-surface/50">{$t('backup.includeEmailsHint')}</span>
                </span>
              </label>

              <div class="text-sm font-semibold text-md-on-surface">{$t('backup.expiredModeTitle')}</div>
              {#each [
                { value: 'skip' as const, label: 'expiredSkip', hint: 'expiredSkipHint' },
                { value: 'renewableOnly' as const, label: 'expiredRenewableOnly', hint: 'expiredRenewableOnlyHint' },
                { value: 'all' as const, label: 'expiredAll', hint: 'expiredAllHint' },
              ] as opt (opt.value)}
                <label class="flex items-start gap-2 text-sm cursor-pointer">
                  <Radio
                    checked={expiredMode === opt.value}
                    onchange={() => {
                      expiredMode = opt.value;
                      void refreshDryRun();
                    }}
                  />
                  <span>
                    <span class="font-semibold">{$t(`backup.${opt.label}`)}</span>
                    <span class="block text-xs text-md-on-surface/50 leading-snug"
                      >{$t(`backup.${opt.hint}`)}</span
                    >
                  </span>
                </label>
              {/each}

              {#if expiredMode === 'all' && inspection.counts.addressesExpiredNonRenewable > 0}
                <p class="text-xs text-md-warning leading-snug">
                  {$t('backup.nonRenewableWarning', {
                    values: { n: inspection.counts.addressesExpiredNonRenewable },
                  })}
                </p>
              {/if}
              {#if expiredMode === 'skip' && inspection.counts.addressesExpired > 0}
                <p class="text-xs text-md-on-surface/55 leading-snug">
                  {$t('backup.expiredWillSkip', {
                    values: { n: inspection.counts.addressesExpired },
                  })}
                </p>
              {/if}
            </div>
          {/if}

          {#if dryRun}
            <div class="rounded-xl bg-md-surface-variant/30 border border-md-outline-variant/20 px-3 py-2 text-xs text-md-on-surface/70 leading-relaxed">
              <div class="font-semibold text-md-on-surface/85 mb-0.5">{$t('backup.dryRunTitle')}</div>
              {$t('backup.dryRunBody', {
                values: {
                  newIdentities: dryRun.newIdentities,
                  skipIdentities: dryRun.skippedExistingIdentities,
                  newAddresses: dryRun.addressesNew,
                  skipExpired: dryRun.skippedExpiredAddresses,
                  policy: dryRun.willReplace
                    ? $t('backup.policyReplace')
                    : $t('backup.policyMerge'),
                },
              })}
              {#if dryRun.secretsImportBlocked}
                <p class="text-xs text-md-error flex items-start gap-1.5 mt-2 leading-snug">
                  <Icon name="warning" class="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {$t('backup.dryRunSecretsBlocked')}
                </p>
              {:else if dryRun.secretsDroppable > 0}
                <p class="text-xs text-md-warning flex items-start gap-1.5 mt-2 leading-snug">
                  <Icon name="warning" class="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {$t('backup.dryRunSecretsDropped', {
                    values: { n: dryRun.secretsDroppable },
                  })}
                </p>
              {/if}
            </div>
          {/if}
        {:else if step === 3 && dryRun}
          <!-- Confirm step -->
          <div class="rounded-xl border border-md-outline-variant/25 p-3 space-y-2 text-xs">
            <div class="font-bold text-sm">{$t('backup.confirmTitle')}</div>
            <ul class="text-sm text-md-on-surface-variant space-y-1 list-disc ps-4">
              <li>
                {$t('backup.confirmCategories', {
                  values: { n: selectedCategories.length },
                })}
              </li>
              <li>
                {conflictPolicy === 'replace'
                  ? $t('backup.policyReplace')
                  : $t('backup.policyMerge')}
              </li>
              {#if selected.addresses}
                <li>
                  {$t('backup.confirmAddresses', {
                    values: {
                      n: dryRun.addressesToImport,
                      skipped: dryRun.skippedExpiredAddresses,
                    },
                  })}
                </li>
              {/if}
              {#if dryRun.newIdentities || dryRun.skippedExistingIdentities}
                <li>
                  {$t('backup.confirmIdentities', {
                    values: {
                      add: dryRun.newIdentities,
                      skip: dryRun.skippedExistingIdentities,
                    },
                  })}
                </li>
              {/if}
            </ul>
            {#if conflictPolicy === 'replace'}
              <p class="text-xs text-md-warning">{$t('backup.replaceWarning')}</p>
            {/if}
            {#if dryRun.secretsImportBlocked}
              <p class="text-xs text-md-error flex items-start gap-1.5 leading-snug">
                <Icon name="warning" class="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {$t('backup.dryRunSecretsBlocked')}
              </p>
            {:else if dryRun.secretsDroppable > 0}
              <p class="text-xs text-md-warning flex items-start gap-1.5 leading-snug">
                <Icon name="warning" class="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {$t('backup.dryRunSecretsDropped', {
                  values: { n: dryRun.secretsDroppable },
                })}
              </p>
            {/if}
          </div>
        {/if}
        {#if importError}
          <p role="alert" class="rounded-xl bg-md-error-container p-3 text-sm text-md-on-error-container">{importError}</p>
        {/if}
      </div>

  </div>
</ModalDialog>

{#snippet importFooter()}
        <div class="w-full flex flex-nowrap gap-2" use:responsiveButtonLayout data-action-tier="S">
          {#if isDone}
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-md-primary text-md-on-primary transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
              onclick={onClose}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.close')}</span>
            </button>
          {:else if step === 1}
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl border border-md-outline text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible disabled:opacity-50 disabled:pointer-events-none"
              disabled={isProcessing}
              onclick={onClose}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.cancel')}</span>
            </button>
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-md-primary text-md-on-primary transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible disabled:opacity-50 disabled:pointer-events-none"
              disabled={!payload || needsPassword}
              onclick={() => { step = 2; }}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.continue')}</span>
            </button>
          {:else if step === 2}
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl border border-md-outline text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
              onclick={() => { step = 1; }}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.back')}</span>
            </button>
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-md-primary text-md-on-primary transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible disabled:opacity-50 disabled:pointer-events-none"
              disabled={!canImport}
              onclick={() => { goConfirm(); }}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.continue')}</span>
            </button>
          {:else}
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl border border-md-outline text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible disabled:opacity-50 disabled:pointer-events-none"
              disabled={isProcessing}
              onclick={() => { step = 2; }}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.back')}</span>
            </button>
            <button
              type="button"
              class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-md-primary text-md-on-primary transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible disabled:opacity-50 disabled:pointer-events-none"
              disabled={!canImport || isProcessing}
              onclick={() => { void handleImport(); }}
            >
              <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{isProcessing ? $t('backup.importing') : $t('backup.importAction')}</span>
            </button>
          {/if}
        </div>
{/snippet}

{#if showClipboardFallback}
  <ModalDialog
    open={true}
    activityDialogKey="dialog:import"
    title={$t('backup.pastePrompt')}
    maxWidth="sm"
    onClose={() => {
      showClipboardFallback = false;
      clipboardFallbackText = '';
    }}
  >
    <textarea
      class="w-full min-h-32 rounded-xl border border-md-outline-variant/40 bg-md-surface-container px-3 py-2 text-sm outline-none focus:border-md-primary"
      bind:value={clipboardFallbackText}
      aria-label={$t('backup.pastePrompt')}
    ></textarea>
    {#snippet footer()}
      <div class="w-full flex flex-nowrap items-center gap-2" use:responsiveButtonLayout data-action-tier="S">
        <button
          type="button"
          class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-transparent text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
          onclick={() => { showClipboardFallback = false; clipboardFallbackText = ''; }}
        >
          <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.cancel')}</span>
        </button>
        <button
          type="button"
          class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-md-primary text-md-on-primary transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
          onclick={acceptClipboardFallback}
        >
          <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.continue')}</span>
        </button>
      </div>
    {/snippet}
  </ModalDialog>
{/if}
