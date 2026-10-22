<script lang="ts">
import { t } from 'svelte-i18n';
import {
  groupVerificationItems,
  type VerificationItem,
} from '@/features/address/verification-items.js';
import ButtonGroup from '@/ui/components/composites/ButtonGroup.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn, IconButton } from '@/ui/components/primitives';
import FaviconImage from '@/ui/components/primitives/FaviconImage.svelte';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard/clipboard.js';
import { logError } from '@/utils/logger.js';
import { formatRemaining } from '@/utils/otp/otp-magic-expiry.js';
import { avatarInitial } from '@/utils/theme/avatar-initials.js';
import { formatFullDateTime, timeAgo } from '@/utils/time/time-format.js';
import type { Email } from '@/utils/types.js';
import { controlSurface } from '@/utils/ui/row-surface.js';

let {
  items,
  mode,
  currentAddress,
  now,
  loading = false,
  error = false,
  saving = false,
  onMode,
  onOpenLink,
  onOpenMessage,
  onToast,
  onChoose,
}: {
  items: VerificationItem[];
  mode: 'address' | 'website';
  currentAddress: string;
  now: number;
  loading?: boolean;
  error?: boolean;
  saving?: boolean;
  onMode: (mode: 'address' | 'website') => void;
  onOpenLink: (url: string, address?: string) => void;
  onOpenMessage: (email: Email) => void;
  onToast: (message: string, type?: 'error' | 'success') => void;
  onChoose?: (item: VerificationItem) => void;
} = $props();
const groups = $derived(groupVerificationItems(items, mode, currentAddress));
let showHistory = $state(false);
function isCurrent(item: VerificationItem): boolean {
  return item.status === 'current' && item.expiresAt > now;
}
async function copy(item: VerificationItem) {
  try {
    const ok = await copyToClipboardAndSchedulePurge(item.value);
    onToast($t(ok ? 'common.copied' : 'inbox.copyFailed'), ok ? 'success' : 'error');
  } catch (error) {
    logError('Failed to copy verification history item', error);
    onToast($t('inbox.copyFailed'), 'error');
  }
}
</script>

<div class="px-3 py-2 space-y-3" data-verification-groups>
  <div class="flex rounded-full border border-md-outline-variant overflow-hidden" role="group" aria-label={$t('verification.groupBy')}>
    <button type="button" class="flex-1 min-h-10 px-3 ui-label {controlSurface(mode === 'address')}" aria-pressed={mode === 'address'} disabled={saving} onclick={() => onMode('address')}>{$t('verification.byAddress')}</button>
    <button type="button" class="flex-1 min-h-10 px-3 ui-label {controlSurface(mode === 'website')}" aria-pressed={mode === 'website'} disabled={saving} onclick={() => onMode('website')}>{$t('verification.byWebsite')}</button>
  </div>
  {#if items.length}
    <Btn variant={showHistory ? 'tonal' : 'ghost'} size="sm" aria-pressed={showHistory} label={showHistory ? $t('verification.hideHistory') : $t('verification.showHistory')} onclick={() => { showHistory = !showHistory; }} />
  {/if}
  {#if loading}<p class="ui-support text-md-on-surface-variant" role="status">{$t('common.loading')}</p>{/if}
  {#if error}<p class="ui-support text-md-error" role="alert">{$t('toasts.operationFailed')}</p>{/if}
  {#if !loading && groups.length === 0}<p class="ui-support text-md-on-surface-variant">{$t('inbox.noOtps')}</p>{/if}
  {#each groups as group (group.key)}
    <details open={showHistory || group.sections.some((section) => section.items.some(isCurrent))} class="group rounded-xl border border-md-outline-variant overflow-hidden" data-verification-group>
      <summary class="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 ui-row-primary bg-md-surface-container-high break-all {controlSurface(false)}">
        {#if mode === 'website' && group.key}<FaviconImage domain={group.key} size="sm" fallbackLetter={avatarInitial(group.key)} />{/if}
        <span class="min-w-0 flex-1">{group.key || $t('verification.unknownWebsite')}</span>
        <span class="ui-support shrink-0" aria-label={$t('verification.itemCount', { values: { count: group.count } })}>{group.count}</span>
        <Icon name="chevronDown" class="w-4 h-4 shrink-0 -rotate-90 group-open:rotate-0" />
      </summary>
      {#if !showHistory && !group.sections.some((section) => section.items.some(isCurrent))}
        <p class="px-3 py-2 ui-support text-md-on-surface-variant">{$t('verification.noCurrentItems')}</p>
      {/if}
      {#each group.sections as section (section.key)}
        {@const visibleItems = showHistory ? section.items : section.items.filter(isCurrent)}
        {#if visibleItems.length}
        <div class="border-t border-md-outline-variant">
          <h4 class="flex items-center gap-2 px-3 py-2 ui-label text-md-on-surface-variant break-all">
            {#if mode === 'address' && section.key}<FaviconImage domain={section.key} size="sm" fallbackLetter={avatarInitial(section.key)} />{/if}
            <span class="min-w-0 flex-1">{section.key || $t('verification.unknownWebsite')}</span>
            <span class="ui-support shrink-0">{section.items.length}</span>
          </h4>
          <div class="divide-y divide-md-outline-variant/40">
            {#each visibleItems as item (item.id)}
              {@const status = item.expiresAt <= now ? 'expired' : item.status}
              <div class="px-3 py-2 space-y-1" data-verification-item data-status={status}>
                <div class="flex items-center gap-2 min-w-0">
                  <span class="ui-support text-md-on-surface-variant">{item.kind === 'otp' ? $t('inbox.otpLabel') : $t('inbox.magicLinkDetected')}</span>
                  {#if onChoose}
                    <button type="button" class="min-h-8 ui-row-primary break-all min-w-0 rounded-lg text-start {controlSurface(false)}" onclick={() => onChoose?.(item)}>{item.kind === 'otp' ? item.value : item.website}</button>
                  {:else}
                    <span class="ui-row-primary break-all min-w-0">{item.kind === 'otp' ? item.value : item.website}</span>
                  {/if}
                  <IconButton icon="contentCopy" size="sm" class="ms-auto shrink-0" ariaLabel={$t('common.copy')} onclick={() => void copy(item)} />
                  <IconButton icon="mail" size="sm" class="shrink-0" ariaLabel={$t('verification.openMessage')} onclick={() => onOpenMessage(item.email)} />
                </div>
                <div class="flex flex-wrap items-center gap-x-2 ui-support {status === 'expired' ? 'text-md-error' : 'text-md-on-surface-variant'}">
                  <span title={formatFullDateTime(item.email.received_at)}>{timeAgo(item.email.received_at, now)}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                  {#if status === 'expired'}{$t('verification.timeLimitReached')}
                  {:else if status === 'earlier'}{$t('verification.earlier')}
                  {:else}{$t('inbox.expiresIn', { values: { t: formatRemaining(item.expiresAt, now) } })}{/if}
                  </span>
                </div>
                {#if item.kind === 'link'}<ButtonGroup tier="XS"><Btn size="sm" variant="tonal" onclick={() => onOpenLink(item.value, item.address)}>{$t('inbox.openMagicLink')}</Btn></ButtonGroup>{/if}
              </div>
            {/each}
          </div>
        </div>
        {/if}
      {/each}
    </details>
  {/each}
</div>
