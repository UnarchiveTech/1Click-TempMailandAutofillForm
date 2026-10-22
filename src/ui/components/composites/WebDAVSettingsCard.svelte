<script lang="ts">
/**
 * WebDAV cloud-backup settings card (Data section of Settings).
 *
 * The old always-expanded inline form became a master-toggle card:
 *
 *  - Toggle OFF (default): the card shows only the title/hint + switch. Any
 *    previously-saved connection details are KEPT, but the feature is disabled
 *    (`enabled: false`, `autoBackup` force-cleared) so no alarm runs.
 *  - Toggle ON: a dialog opens with the full connection form (URL, credentials,
 *    backup password, auto-backup schedule, allow-insecure) plus Test / Upload /
 *    Download-restore actions. The enabled state and edited details are committed
 *    only when Save is pressed.
 *
 * All WebDAV form state lives here so SettingsView only embeds the card.
 */
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import {
  buildWebDAVConfig,
  downloadAndRestoreWebDAV,
  getLastWebDAVSyncAt,
  loadWebDAVSettings,
  saveWebDAVSettings,
  testWebDAVConnection,
  uploadBackupToWebDAV,
  type WebDAVConfig,
  type WebDAVSettings,
  withWebDAVDisabled,
} from '@/features/backup/webdav-sync.js';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import SettingCard from '@/ui/components/composites/SettingCard.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn, Checkbox, InputField, Toggle } from '@/ui/components/primitives';
import { translateResultMessage } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { decryptSecret } from '@/utils/security/crypto.js';
import { formatLocalDateTime } from '@/utils/time/time.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { toastStore } from '@/utils/ui/toastStore.js';

let {
  loadAddresses = async () => {},
}: {
  /** Refresh the addresses list after a download/restore. */
  loadAddresses?: () => Promise<void>;
} = $props();

// ── Master state ─────────────────────────────────────────────────────────────
let enabled = $state(false);
let dialogOpen = $state(false);
let busy = $state(false);
let lastSyncAt = $state<number | null>(null);
/** True while the current dialog was opened by turning the master toggle on. */
let openedFromDisabledState = $state(false);

// ── Connection form ──────────────────────────────────────────────────────────
let webdavUrl = $state('');
let webdavUsername = $state('');
let webdavPassword = $state('');
let webdavPasswordEnc = $state<string | undefined>(undefined);
let webdavPasswordEdited = $state(false);
let webdavBackupPassword = $state('');
let webdavBackupPasswordEnc = $state<string | undefined>(undefined);
let webdavBackupPasswordEdited = $state(false);
let webdavAllowInsecure = $state(false);
let webdavAutoBackup = $state(false);
let webdavAutoBackupDays = $state(1);

type WebDAVFormDraft = {
  url: string;
  username: string;
  password: string;
  passwordEdited: boolean;
  passwordEnc?: string;
  backupPassword: string;
  backupPasswordEdited: boolean;
  backupPasswordEnc?: string;
  allowInsecure: boolean;
  autoBackup: boolean;
  autoBackupDays: number;
};

let dialogDraft = $state<WebDAVFormDraft | null>(null);

function captureForm(): WebDAVFormDraft {
  return {
    url: webdavUrl,
    username: webdavUsername,
    password: webdavPassword,
    passwordEdited: webdavPasswordEdited,
    passwordEnc: webdavPasswordEnc,
    backupPassword: webdavBackupPassword,
    backupPasswordEdited: webdavBackupPasswordEdited,
    backupPasswordEnc: webdavBackupPasswordEnc,
    allowInsecure: webdavAllowInsecure,
    autoBackup: webdavAutoBackup,
    autoBackupDays: webdavAutoBackupDays,
  };
}

function restoreForm(draft: WebDAVFormDraft) {
  webdavUrl = draft.url;
  webdavUsername = draft.username;
  webdavPassword = draft.password;
  webdavPasswordEdited = draft.passwordEdited;
  webdavPasswordEnc = draft.passwordEnc;
  webdavBackupPassword = draft.backupPassword;
  webdavBackupPasswordEdited = draft.backupPasswordEdited;
  webdavBackupPasswordEnc = draft.backupPasswordEnc;
  webdavAllowInsecure = draft.allowInsecure;
  webdavAutoBackup = draft.autoBackup;
  webdavAutoBackupDays = draft.autoBackupDays;
}

function openDialog() {
  dialogDraft = captureForm();
  dialogOpen = true;
}

function formatSyncDate(ts: number): string {
  const ms = ts < 1e11 ? ts * 1000 : ts;
  return formatLocalDateTime(
    ms,
    { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
    ts
  );
}

/** Load persisted settings into the master flag + form fields. */
async function reloadForm() {
  try {
    const s = await loadWebDAVSettings();
    enabled = s.enabled === true || (s.enabled === undefined && !!s.url);
    webdavUrl = s.url;
    webdavUsername = s.username || '';
    webdavAllowInsecure = s.allowInsecureHttp === true;
    webdavAutoBackup = s.autoBackup === true;
    webdavAutoBackupDays = s.autoBackupIntervalDays || 1;
    lastSyncAt = await getLastWebDAVSyncAt();
    webdavPasswordEnc = s.passwordEnc;
    const auth = await decryptSecret(s.passwordEnc || '');
    webdavPassword = auth || '';
    webdavPasswordEdited = false;
    webdavBackupPasswordEnc = s.backupPasswordEnc;
    const backup = await decryptSecret(s.backupPasswordEnc || '');
    webdavBackupPassword = backup || '';
    webdavBackupPasswordEdited = false;
  } catch {
    /* ignore */
  }
}

onMount(() => {
  void reloadForm();
  // Keep the last-sync indicator live when a background auto-backup fires.
  const onWebDAVSync = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    if (changes.lastWebDAVSyncAt) {
      const v = changes.lastWebDAVSyncAt.newValue;
      lastSyncAt = typeof v === 'number' && v > 0 ? v : null;
    }
  };
  browser.storage.onChanged.addListener(onWebDAVSync);
  return () => browser.storage.onChanged.removeListener(onWebDAVSync);
});

/** Current form as a persistable settings object (passwords stay plaintext). */
function formSettings(): WebDAVSettings & { password?: string; backupPassword?: string } {
  return {
    url: webdavUrl.trim(),
    username: webdavUsername.trim() || undefined,
    password: webdavPasswordEdited ? webdavPassword : undefined,
    passwordEnc: webdavPasswordEdited ? undefined : webdavPasswordEnc,
    backupPassword: webdavBackupPasswordEdited ? webdavBackupPassword : undefined,
    backupPasswordEnc: webdavBackupPasswordEdited ? undefined : webdavBackupPasswordEnc,
    allowInsecureHttp: webdavAllowInsecure,
    autoBackup: webdavAutoBackup,
    autoBackupIntervalDays: webdavAutoBackupDays,
    enabled,
  };
}

/** Request the configured server origin from a user-initiated WebDAV action. */
function requestWebDAVHostPermission(url: string): Promise<boolean> {
  try {
    const origin = new URL(url).origin;
    if (origin === 'null') return Promise.resolve(true);
    // WebDAV requests need the server origin; the SSRF guard also queries DoH.
    // Both are optional permissions requested only from this user-initiated UI.
    return browser.permissions.request({
      origins: [`${origin}/*`, 'https://dns.google/*'],
    });
  } catch {
    // Let buildDraftConfig show its localized URL validation error.
    return Promise.resolve(true);
  }
}

/** Build a transport config from the current draft without persisting it. */
async function buildDraftConfig(): Promise<WebDAVConfig | null> {
  const url = webdavUrl.trim();
  if (!url) {
    toastStore.error($t('webdav.urlRequired'));
    return null;
  }
  try {
    return await buildWebDAVConfig(formSettings(), webdavPassword || undefined);
  } catch (e) {
    logError(
      'Saving WebDAV settings failed',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
    toastStore.error($t('webdav.actionFailed'));
    return null;
  }
}

/**
 * Master toggle flow:
 * - ON opens the editor; the enabled state is not persisted until Save is pressed.
 * - OFF persists the current details with the feature disabled and closes any
 *   open editor. This keeps credentials/details available for the next enable.
 */
async function handleMasterToggle(next: boolean) {
  if (busy) return;
  if (next) {
    openedFromDisabledState = !enabled;
    openDialog();
    enabled = true;
    return;
  }

  busy = true;
  try {
    await saveWebDAVSettings(withWebDAVDisabled(formSettings()));
    enabled = false;
    dialogOpen = false;
    openedFromDisabledState = false;
  } catch (e) {
    logError(
      'Disabling WebDAV backup failed',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
    toastStore.error($t('webdav.actionFailed'));
  } finally {
    busy = false;
  }
}

async function runWebDAVAction(fn: (config: WebDAVConfig) => Promise<void>) {
  if (busy) return;
  // Call request() before awaiting config/decryption so the browser can honor
  // the user gesture. The DNS resolver is covered by the manifest permission.
  const permission = requestWebDAVHostPermission(webdavUrl.trim());
  if (!(await permission)) {
    toastStore.error($t('errors.permissionDenied'));
    return;
  }
  const config = await buildDraftConfig();
  if (!config) return;
  busy = true;
  try {
    await fn(config);
  } catch (e) {
    logError('WebDAV action failed', undefined, e instanceof Error ? e : new Error(String(e)));
    toastStore.error($t('webdav.actionFailed'));
  } finally {
    busy = false;
  }
}

function testWebDAV() {
  void runWebDAVAction(async (config) => {
    const res = await testWebDAVConnection(config);
    if (res.success) toastStore.success($t('webdav.testSuccess'));
    else {
      toastStore.error(translateResultMessage(res.message, $t) || $t('webdav.testFailed'));
    }
  });
}

function uploadWebDAV() {
  void runWebDAVAction(async (config) => {
    const res = await uploadBackupToWebDAV(config, webdavBackupPassword || undefined);
    if (res.success) {
      lastSyncAt = Date.now();
      toastStore.success($t('webdav.uploadSuccess'));
    } else {
      toastStore.error(translateResultMessage(res.error, $t) || $t('webdav.uploadFailed'));
    }
  });
}

function downloadRestoreWebDAV() {
  void runWebDAVAction(async (config) => {
    const res = await downloadAndRestoreWebDAV(
      config,
      webdavBackupPassword || undefined,
      loadAddresses
    );
    if (res.success) {
      const n = res.summary?.importedAddresses ?? 0;
      toastStore.success($t('webdav.downloadSuccess', { values: { n } }));
    } else {
      toastStore.error(translateResultMessage(res.error, $t) || $t('webdav.downloadFailed'));
    }
  });
}

/** Dialog Save: persist (requires a URL) and close. */
async function saveAndClose() {
  if (busy) return;
  const permission = requestWebDAVHostPermission(webdavUrl.trim());
  if (!(await permission)) {
    toastStore.error($t('errors.permissionDenied'));
    return;
  }
  const config = await buildDraftConfig();
  if (!config) return;
  try {
    const settings = await saveWebDAVSettings(formSettings());
    webdavPasswordEnc = settings.passwordEnc;
    webdavPasswordEdited = false;
    webdavBackupPasswordEnc = settings.backupPasswordEnc;
    webdavBackupPasswordEdited = false;
  } catch (e) {
    logError(
      'Saving WebDAV settings failed',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
    toastStore.error($t('webdav.actionFailed'));
    return;
  }
  enabled = true;
  openedFromDisabledState = false;
  dialogDraft = null;
  dialogOpen = false;
}

/** Close without committing draft edits; a first-time enable remains off. */
function closeDialog() {
  if (busy) return;
  if (dialogDraft) restoreForm(dialogDraft);
  dialogDraft = null;
  dialogOpen = false;
  if (openedFromDisabledState) {
    enabled = false;
    openedFromDisabledState = false;
  }
}
</script>

<!-- Compact card: header + master toggle; status row when enabled -->
<SettingCard
  variant="row"
  icon="globe"
  title={$t('webdav.title')}
  description={$t('webdav.hint')}
>
  {#snippet action()}
    <Toggle
      size="sm"
      checked={enabled}
      ariaLabel={$t('webdav.enabledAria')}
      onChange={(next) => void handleMasterToggle(next)}
    />
  {/snippet}
  {#if enabled}
    <div class="flex items-center justify-between gap-2 mt-1 pt-1.5 border-t border-md-outline-variant/15">
      <span class="text-xs text-md-on-surface/50 truncate">
        {#if lastSyncAt}
          {$t('webdav.lastSyncAt', { values: { date: formatSyncDate(lastSyncAt) } })}
        {:else}
          {$t('webdav.lastSyncNever')}
        {/if}
      </span>
      <button
        type="button"
        class="flex items-center gap-1 text-xs text-md-primary hover:text-md-primary/80 shrink-0 px-1.5 py-0.5 rounded-lg hover:bg-md-primary/10 active:bg-md-primary/30 transition-colors"
        onclick={openDialog}
        aria-label={$t('common.edit')}
      >
        <Icon name="edit" class="w-3.5 h-3.5" />
        <span class="whitespace-nowrap">{$t('common.edit')}</span>
      </button>
    </div>
  {/if}
</SettingCard>

<!-- Full connection form (opens when the master toggle is switched ON) -->
<ModalDialog
  open={dialogOpen}
  title={$t('webdav.title')}
  subtitle={$t('webdav.hint')}
  maxWidth="sm"
  onClose={closeDialog}
>
  <div class="dialog-content-stack">
    <InputField
      type="url"
      label={$t('webdav.serverUrl')}
      bind:value={webdavUrl}
    />
    <div class="dialog-field-grid">
      <InputField
        type="text"
        label={$t('webdav.username')}
        autocomplete="off"
        bind:value={webdavUsername}
      />
      <InputField
        type="password"
        label={$t('webdav.password')}
        autocomplete="off"
        bind:value={webdavPassword}
        oninput={() => (webdavPasswordEdited = true)}
      />
    </div>
    <div class="dialog-field">
    <InputField
      type="password"
      label={$t('webdav.backupPassword')}
      autocomplete="off"
      bind:value={webdavBackupPassword}
      oninput={() => (webdavBackupPasswordEdited = true)}
    />
    <p class="text-xs text-md-on-surface-variant">{$t('webdav.backupPasswordHint')}</p>
    </div>
    <div class="dialog-section">
    <label class="flex items-center justify-between gap-3 text-sm text-md-on-surface cursor-pointer select-none">
      <span class="min-w-0">{$t('webdav.autoBackup')}</span>
      <Checkbox class="shrink-0" bind:checked={webdavAutoBackup} />
    </label>
    {#if webdavAutoBackup}
      <label class="flex items-center justify-between gap-3 text-sm text-md-on-surface-variant">
        <span class="min-w-0">{$t('webdav.autoBackupIntervalDays')}</span>
        <div class="flex items-center gap-1.5 shrink-0">
          <input
            type="number"
            min="1"
            max="90"
            class="w-16 min-w-0 px-2 py-1.5 text-sm rounded-lg bg-md-surface border border-md-outline-variant/40 text-right"
            aria-label={$t('webdav.autoBackupIntervalDays')}
            bind:value={webdavAutoBackupDays}
          />
          <span class="whitespace-nowrap text-md-on-surface/50">{$t('webdav.days')}</span>
        </div>
      </label>
      <p class="text-xs text-md-on-surface-variant">{$t('webdav.autoBackupHint')}</p>
    {/if}
    </div>
    <label class="flex items-center gap-3 text-sm text-md-on-surface-variant cursor-pointer select-none">
      <Checkbox class="shrink-0" bind:checked={webdavAllowInsecure} />
      <span>{$t('webdav.allowInsecureHttp')}</span>
    </label>
    <div class="flex items-center justify-between gap-2 pt-1.5 border-t border-md-outline-variant/15">
      <span class="text-xs text-md-on-surface/50 truncate">
        {#if lastSyncAt}
          {$t('webdav.lastSyncAt', { values: { date: formatSyncDate(lastSyncAt) } })}
        {:else}
          {$t('webdav.lastSyncNever')}
        {/if}
      </span>
      <Icon name="globe" class="w-3.5 h-3.5 text-md-on-surface/40 shrink-0" />
    </div>
    <!-- §8 action row: tier S and single-line; the shared responsive fitting fits the row. -->
    <div class="flex flex-nowrap gap-3 pt-1" use:responsiveButtonLayout data-action-tier="S">
      <Btn
        variant="outline"
        size="md"
        class="flex-1"
        disabled={busy}
        onclick={testWebDAV}
      >{$t('webdav.test')}</Btn>
      <Btn
        variant="outline"
        size="md"
        class="flex-1"
        disabled={busy}
        onclick={uploadWebDAV}
      >{$t('webdav.upload')}</Btn>
      <Btn
        variant="outline"
        size="md"
        class="flex-1"
        disabled={busy}
        onclick={downloadRestoreWebDAV}
      >{$t('webdav.download')}</Btn>
    </div>
  </div>

  {#snippet footer()}
    <Btn variant="outline" size="sm" onclick={closeDialog} disabled={busy}>
      {$t('common.cancel')}
    </Btn>
    <Btn variant="primary" size="sm" onclick={() => void saveAndClose()} disabled={busy}>
      {$t('common.save')}
    </Btn>
  {/snippet}
</ModalDialog>
