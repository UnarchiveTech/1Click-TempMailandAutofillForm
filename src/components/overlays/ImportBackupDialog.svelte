<script lang="ts">
import { tick } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import Btn from '@/components/ui/primitives/Btn.svelte';
import {
  type BackupCategory,
  type BackupFileV3,
  type BackupInspection,
  type ConflictPolicy,
  type ExpiredInboxMode,
  formatBytes,
  type ImportPreview,
  type ImportSummary,
  importBackup,
  inspectBackup,
  type ParseBackupResult,
  parseBackupText,
  previewImport,
  resolveBackupPayload,
} from '@/features/settings/backup-actions.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { logError } from '@/utils/logger.js';
import { portalToBody } from '@/utils/portal-layers.js';

let {
  open = false,
  onClose = () => {},
  onSuccess = (_summary?: string, _result?: ImportSummary) => {},
  onError = (_msg: string) => {},
  loadInboxes = async () => {},
} = $props<{
  open?: boolean;
  onClose?: () => void;
  onSuccess?: (summary?: string, result?: ImportSummary) => void;
  onError?: (message: string) => void;
  loadInboxes?: () => Promise<void>;
}>();

const CATEGORY_ICONS: Record<BackupCategory, string> = {
  settings: 'settings',
  identities: 'user',
  savedLogins: 'lock',
  inboxes: 'mail',
  filters: 'filter',
};

let step = $state<1 | 2 | 3>(1);
let fileName = $state('');
let fileBytes = $state(0);
let parsed = $state<ParseBackupResult | null>(null);
let payload = $state<BackupFileV3 | null>(null);
let inspection = $state<BackupInspection | null>(null);
let dryRun = $state<ImportPreview | null>(null);
let parseError = $state('');
let decryptPassword = $state('');
let needsPassword = $state(false);
let selected = $state<Record<BackupCategory, boolean>>({
  settings: true,
  identities: true,
  savedLogins: true,
  inboxes: true,
  filters: true,
});
let includeEmails = $state(true);
// Prefer importing expired sessions too so export → hard-reset → import restores mailboxes
let expiredMode = $state<ExpiredInboxMode>('all');
let conflictPolicy = $state<ConflictPolicy>('replace');
let isProcessing = $state(false);
let isDone = $state(false);
let dragOver = $state(false);
let dialogRef = $state<HTMLElement | null>(null);
let fileInputRef = $state<HTMLInputElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);
let cleanupFocusTrap: (() => void) | null = null;
let previousActiveElement: HTMLElement | null = null;

$effect(() => {
  if (open && overlayEl) {
    return portalToBody(overlayEl);
  }
});

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
  decryptPassword = '';
  needsPassword = false;
  selected = {
    settings: true,
    identities: true,
    savedLogins: true,
    inboxes: true,
    filters: true,
  };
  includeEmails = true;
  expiredMode = 'all';
  conflictPolicy = 'replace';
  isProcessing = false;
  isDone = false;
  dragOver = false;
  if (fileInputRef) fileInputRef.value = '';
}

function applyDefaultSelection(present: BackupCategory[]) {
  const next: Record<BackupCategory, boolean> = {
    settings: false,
    identities: false,
    savedLogins: false,
    inboxes: false,
    filters: false,
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
    inboxes: false,
    filters: false,
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
    case 'inboxes':
      return c.inboxesTotal
        ? `${c.inboxesTotal}${c.inboxesExpired ? ` · ${c.inboxesExpired}` : ''}`
        : '';
    case 'filters':
      return c.filters ? String(c.filters) : '';
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

// Only reset when dialog opens (open false→true), not on every reactive re-run mid-import
let wasOpen = false;
$effect(() => {
  if (open && !wasOpen) {
    resetState();
    previousActiveElement = document.activeElement as HTMLElement;
    window.addEventListener('keydown', handleKeydown);
    document.body.style.overflow = 'hidden';
    void tick().then(() => {
      if (dialogRef) cleanupFocusTrap = setupFocusTrap(dialogRef);
    });
  }
  if (!open && wasOpen) {
    window.removeEventListener('keydown', handleKeydown);
    document.body.style.overflow = '';
    if (cleanupFocusTrap) {
      cleanupFocusTrap();
      cleanupFocusTrap = null;
    }
    if (previousActiveElement) {
      previousActiveElement.focus();
      previousActiveElement = null;
    }
  }
  wasOpen = open;
});

async function loadFromText(text: string, name: string) {
  parseError = '';
  payload = null;
  inspection = null;
  dryRun = null;
  needsPassword = false;
  decryptPassword = '';
  fileName = name;
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
    parseError = err instanceof Error ? err.message : String(err);
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
    const p = await resolveBackupPayload(parsed, decryptPassword);
    await applyPlainPayload(p, parsed.bytes);
    needsPassword = false;
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
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
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

async function ingestFile(file: File | null | undefined) {
  if (!file) {
    parseError = $t('backup.emptyBackup') || 'No file selected';
    return;
  }
  try {
    const text = await readFileAsText(file);
    if (!text?.trim()) {
      parseError = $t('backup.emptyBackup') || 'Empty file';
      return;
    }
    await loadFromText(text, file.name || 'import.json');
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
    logError('Failed to read import file', err);
  }
}

/** Optional: open full app tab for import (paste/drag still work in popup). */
async function openImportInFullPage() {
  try {
    await browser.storage.session.set({ openImportBackup: true, openImportAt: Date.now() });
  } catch {
    try {
      await browser.storage.local.set({ openImportBackup: true, openImportAt: Date.now() });
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
      // Fallback: prompt paste (works when clipboard API is blocked in popup)
      text = window.prompt($t('backup.pastePrompt') || 'Paste backup JSON here:', '') || '';
    }
    if (!text?.trim()) {
      parseError = $t('backup.clipboardEmpty');
      return;
    }
    await loadFromText(text, 'clipboard.json');
  } catch (e) {
    parseError = e instanceof Error ? e.message : $t('backup.clipboardFailed');
  }
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
  isProcessing = true;
  try {
    const summary = await importBackup(
      browser,
      payload,
      {
        categories: selectedCategories,
        includeEmails: selected.inboxes ? includeEmails : false,
        expiredMode,
        conflictPolicy,
      },
      loadInboxes
    );
    isDone = true;
    const parts: string[] = [];
    if (summary.importedInboxes)
      parts.push($t('backup.summaryInboxes', { values: { n: summary.importedInboxes } }));
    if (summary.skippedExpiredInboxes)
      parts.push(
        $t('backup.summarySkippedExpired', { values: { n: summary.skippedExpiredInboxes } })
      );
    if (summary.imported.identities)
      parts.push($t('backup.summaryIdentities', { values: { n: summary.imported.identities } }));
    if (summary.imported.savedLogins)
      parts.push($t('backup.summaryLogins', { values: { n: summary.imported.savedLogins } }));
    onSuccess(parts.length ? parts.join(' · ') : undefined, summary);
    setTimeout(() => onClose(), 1800);
  } catch (e) {
    logError('Import backup failed', e);
    isProcessing = false;
    onError(e instanceof Error ? e.message : String(e));
  }
}
</script>

{#if open}
  <div
    bind:this={overlayEl}
    class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="import-backup-title"
  >
    <div
      class="absolute inset-0 bg-md-scrim/30 backdrop-blur-sm"
      role="button"
      tabindex="-1"
      aria-label={$t('common.close')}
      onclick={(e) => {
        e.stopPropagation();
        if (!isProcessing) onClose();
      }}
      onkeydown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !isProcessing) onClose();
      }}
    ></div>

    <div
      class="dialog-enter relative w-full max-w-sm max-h-[90vh] flex flex-col bg-md-surface-container/95 backdrop-blur-xl border border-md-outline-variant/30 rounded-2xl shadow-2xl text-md-on-surface z-10 overflow-hidden"
      bind:this={dialogRef}
      tabindex="-1"
    >
      <!-- Header -->
      <div class="shrink-0 border-b border-md-outline-variant/20 px-5 pt-5 pb-3">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl bg-md-primary/10 flex items-center justify-center text-md-primary">
              <Icon name="upload" class="w-5 h-5" />
            </div>
            <div>
              <h2 id="import-backup-title" class="text-sm font-bold tracking-tight">
                {$t('backup.importTitle')}
              </h2>
              <p class="text-xs text-md-on-surface/50">{$t('backup.importSubtitle')}</p>
            </div>
          </div>
          {#if !isProcessing}
            <button
              class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-md-surface-variant/50"
              onclick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label={$t('common.close')}
            >
              <Icon name="x" class="w-4 h-4 text-md-on-surface/60" />
            </button>
          {/if}
        </div>

        <!-- Steps -->
        {#if !isDone}
          <div class="flex items-center gap-1 text-xs font-semibold">
            {#each [1, 2, 3] as s (s)}
              <div
                class="flex-1 h-1 rounded-full {step >= s ? 'bg-md-primary' : 'bg-md-surface-variant/50'}"
              ></div>
            {/each}
          </div>
          <div class="flex justify-between text-xs text-md-on-surface/45 mt-1 px-0.5">
            <span class={step === 1 ? 'text-md-primary font-bold' : ''}>{$t('backup.stepFile')}</span>
            <span class={step === 2 ? 'text-md-primary font-bold' : ''}>{$t('backup.stepChoose')}</span>
            <span class={step === 3 ? 'text-md-primary font-bold' : ''}>{$t('backup.stepConfirm')}</span>
          </div>
        {/if}
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {#if isDone}
          <div class="py-8 flex flex-col items-center gap-2 text-center">
            <div class="w-12 h-12 rounded-full bg-md-primary/15 text-md-primary flex items-center justify-center">
              <Icon name="checkCircle" class="w-7 h-7" />
            </div>
            <h3 class="text-sm font-bold">{$t('backup.importComplete')}</h3>
            <p class="text-xs text-md-on-surface/60">{$t('backup.importCompleteHint')}</p>
          </div>
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
            class="rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors {dragOver
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
            <p class="text-xs font-semibold text-md-primary">{$t('backup.dropOrChoose')}</p>
            <p class="text-xs text-md-on-surface/50 mt-1">{$t('backup.chooseFile')}</p>
            <p class="text-xs text-md-on-surface/40 mt-2 px-2">{$t('backup.importPopupHint')}</p>
          </div>

          <div class="flex gap-2">
            <Btn
              variant="outline"
              size="sm"
              class="flex-1"
              onclick={() => { fileInputRef?.click(); }}
            >
              {$t('backup.chooseFile')}
            </Btn>
            <Btn
              variant="outline"
              size="sm"
              class="flex-1"
              onclick={() => { void openImportInFullPage(); }}
            >
              {$t('backup.openFullPage')}
            </Btn>
            <Btn
              variant="outline"
              size="sm"
              class="flex-1"
              onclick={() => { void pasteFromClipboard(); }}
            >
              {$t('backup.pasteClipboard')}
            </Btn>
          </div>

          {#if parseError}
            <div class="text-label-sm text-md-error bg-md-error/10 rounded-xl px-3 py-2">{parseError}</div>
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
              <p class="text-label-sm text-md-on-surface/70">{$t('preferences.decryptBackupPrompt')}</p>
              <input
                type="password"
                class="w-full px-3 py-2 text-xs rounded-xl border border-md-outline-variant/40 bg-md-surface-container"
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

          {#if parseError}
            <p class="text-label-sm text-md-error flex gap-1.5 items-start">
              <Icon name="warning" class="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {parseError}
            </p>
          {/if}
        {:else if step === 2 && payload && inspection}
          <!-- Choose step -->
          {#if inspection.exportDate || inspection.version}
            <p class="text-xs text-md-on-surface/50">
              {#if inspection.version}v{inspection.version}{/if}
              {#if inspection.exportDate}
                · {new Date(inspection.exportDate).toLocaleString()}
              {/if}
              {#if inspection.approximateBytes}
                · {formatBytes(inspection.approximateBytes)}
              {/if}
              {#if inspection.secretsExcluded}
                · {$t('backup.fileSecretsExcluded')}
              {/if}
            </p>
          {/if}

          {#if inspection.counts.inboxesTotal > 0}
            <p class="text-xs text-md-on-surface/55 leading-snug">
              {$t('backup.inboxSummary', {
                values: {
                  total: inspection.counts.inboxesTotal,
                  expired: inspection.counts.inboxesExpired,
                  renewable: inspection.counts.inboxesExpiredRenewable,
                  nonRenewable: inspection.counts.inboxesExpiredNonRenewable,
                },
              })}
            </p>
          {/if}

          <div class="flex gap-2">
            <Btn
              variant="outline"
              size="sm"
              onclick={() => { selectAllPresent(); }}
            >{$t('backup.selectAll')}</Btn>
            <Btn
              variant="outline"
              size="sm"
              onclick={() => { clearAll(); }}
            >{$t('backup.clearAll')}</Btn>
          </div>

          <p class="text-xs text-md-on-surface/70">{$t('backup.chooseWhatToImport')}</p>

          <div class="flex flex-col gap-1.5">
            {#each presentCategories as cat (cat)}
              <label
                class="flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer {selected[cat]
                  ? 'border-md-primary bg-md-primary/10'
                  : 'border-md-outline-variant/20 bg-md-surface-container-low/50'}"
              >
                <input
                  type="checkbox"
                  class="rounded border-md-outline-variant text-md-primary shrink-0"
                  checked={selected[cat]}
                  onchange={() => toggle(cat)}
                  disabled={isProcessing}
                />
                <Icon name={CATEGORY_ICONS[cat]} class="w-4 h-4 text-md-primary/80 shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-bold">{$t(`backup.category.${cat}`)}</div>
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
            <div class="text-label-sm font-semibold text-md-on-surface/80">{$t('backup.conflictPolicy')}</div>
            <label class="flex items-start gap-2 text-xs cursor-pointer">
              <input type="radio" name="conflict" value="merge" bind:group={conflictPolicy} onchange={() => void refreshDryRun()} />
              <span>
                <span class="font-semibold">{$t('backup.policyMerge')}</span>
                <span class="block text-xs text-md-on-surface/50">{$t('backup.policyMergeHint')}</span>
              </span>
            </label>
            <label class="flex items-start gap-2 text-xs cursor-pointer">
              <input type="radio" name="conflict" value="replace" bind:group={conflictPolicy} onchange={() => void refreshDryRun()} />
              <span>
                <span class="font-semibold">{$t('backup.policyReplace')}</span>
                <span class="block text-xs text-md-on-surface/50">{$t('backup.policyReplaceHint')}</span>
              </span>
            </label>
          </div>

          {#if selected.inboxes && presentCategories.includes('inboxes')}
            <div class="ms-0.5 ps-3 border-s-2 border-md-primary/30 space-y-2">
              <label
                class="flex items-start gap-2 text-xs {selected.inboxes
                  ? 'cursor-pointer'
                  : 'opacity-40 pointer-events-none'}"
              >
                <input
                  type="checkbox"
                  class="mt-0.5 rounded border-md-outline-variant text-md-primary"
                  bind:checked={includeEmails}
                  disabled={isProcessing || !selected.inboxes}
                  onchange={() => void refreshDryRun()}
                />
                <span>
                  <span class="font-semibold">{$t('backup.includeEmails')}</span>
                  <span class="block text-xs text-md-on-surface/50">{$t('backup.includeEmailsHint')}</span>
                </span>
              </label>

              <div class="text-label-sm font-semibold text-md-on-surface/80">{$t('backup.expiredModeTitle')}</div>
              {#each [
                { value: 'skip' as const, label: 'expiredSkip', hint: 'expiredSkipHint' },
                { value: 'renewableOnly' as const, label: 'expiredRenewableOnly', hint: 'expiredRenewableOnlyHint' },
                { value: 'all' as const, label: 'expiredAll', hint: 'expiredAllHint' },
              ] as opt (opt.value)}
                <label class="flex items-start gap-2 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="expiredMode"
                    value={opt.value}
                    bind:group={expiredMode}
                    onchange={() => void refreshDryRun()}
                  />
                  <span>
                    <span class="font-semibold">{$t(`backup.${opt.label}`)}</span>
                    <span class="block text-xs text-md-on-surface/50 leading-snug"
                      >{$t(`backup.${opt.hint}`)}</span
                    >
                  </span>
                </label>
              {/each}

              {#if expiredMode === 'all' && inspection.counts.inboxesExpiredNonRenewable > 0}
                <p class="text-xs text-md-warning leading-snug">
                  {$t('backup.nonRenewableWarning', {
                    values: { n: inspection.counts.inboxesExpiredNonRenewable },
                  })}
                </p>
              {/if}
              {#if expiredMode === 'skip' && inspection.counts.inboxesExpired > 0}
                <p class="text-xs text-md-on-surface/55 leading-snug">
                  {$t('backup.expiredWillSkip', {
                    values: { n: inspection.counts.inboxesExpired },
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
                  newInboxes: dryRun.inboxesNew,
                  skipExpired: dryRun.skippedExpiredInboxes,
                  policy: dryRun.willReplace
                    ? $t('backup.policyReplace')
                    : $t('backup.policyMerge'),
                },
              })}
            </div>
          {/if}
        {:else if step === 3 && dryRun}
          <!-- Confirm step -->
          <div class="rounded-xl border border-md-outline-variant/25 p-3 space-y-2 text-xs">
            <div class="font-bold text-sm">{$t('backup.confirmTitle')}</div>
            <ul class="text-label-sm text-md-on-surface/75 space-y-1 list-disc ps-4">
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
              {#if selected.inboxes}
                <li>
                  {$t('backup.confirmInboxes', {
                    values: {
                      n: dryRun.inboxesToImport,
                      skipped: dryRun.skippedExpiredInboxes,
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
          </div>
        {/if}
      </div>

      <!-- Sticky footer -->
      {#if !isDone}
        <div class="shrink-0 border-t border-md-outline-variant/20 px-5 py-3 flex gap-2 bg-md-surface-container/95">
          {#if step === 1}
            <Btn
              variant="outline"
              size="md"
              class="flex-1"
              disabled={isProcessing}
              onclick={onClose}
            >{$t('common.cancel')}</Btn>
            <Btn
              variant="primary"
              size="md"
              class="flex-1"
              disabled={!payload || needsPassword}
              onclick={() => { step = 2; }}
            >{$t('common.continue')}</Btn>
          {:else if step === 2}
            <Btn
              variant="outline"
              size="md"
              class="flex-1"
              onclick={() => { step = 1; }}
            >{$t('common.back')}</Btn>
            <Btn
              variant="primary"
              size="md"
              class="flex-1"
              disabled={!canImport}
              onclick={() => { goConfirm(); }}
            >{$t('common.continue')}</Btn>
          {:else}
            <Btn
              variant="outline"
              size="md"
              class="flex-1"
              disabled={isProcessing}
              onclick={() => { step = 2; }}
            >{$t('common.back')}</Btn>
            <Btn
              variant="primary"
              size="md"
              class="flex-1"
              disabled={!canImport}
              busy={isProcessing}
              onclick={() => { void handleImport(); }}
            >
              {isProcessing ? $t('backup.importing') : $t('backup.importAction')}
            </Btn>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
