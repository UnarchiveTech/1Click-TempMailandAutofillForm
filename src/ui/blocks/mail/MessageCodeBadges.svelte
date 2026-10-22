<script lang="ts">
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import Badge from '@/ui/components/primitives/Badge.svelte';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard/clipboard.js';
import { logError } from '@/utils/logger.js';
import type { Email } from '@/utils/types.js';
import { toastStore } from '@/utils/ui/toastStore.js';

let {
  email,
  id,
  hideOtp = false,
  onCopyOtp,
}: {
  email: Email;
  id?: string;
  hideOtp?: boolean;
  onCopyOtp?: (code: string) => void;
} = $props();
const code = $derived(email.otp || email.otpCandidate);
const uncertain = $derived(!email.otp && !!email.otpCandidate);

async function copy(value: string, otp: boolean) {
  if (otp && onCopyOtp) {
    onCopyOtp(value);
    return;
  }
  try {
    const ok = await copyToClipboardAndSchedulePurge(value);
    if (ok) toastStore.success($t('common.copied'));
    else toastStore.error($t('inbox.copyFailed'));
  } catch (error) {
    logError('Failed to copy message code', error);
    toastStore.error($t('inbox.copyFailed'));
  }
}
</script>

{#if !hideOtp && code}
  <span
    id={id}
    data-otp-uncertain={uncertain || undefined}
    role="button"
    tabindex="0"
    class="inline-flex min-h-6 max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs {uncertain ? 'bg-md-warning/15 text-md-warning hover:bg-md-warning/25 active:bg-md-warning/35' : 'bg-md-primary/20 text-md-primary hover:bg-md-primary/30 active:bg-md-primary/50'} transition-colors"
    aria-label={uncertain ? $t('inbox.uncertainOtp', { values: { otp: code } }) : $t('common.otpValue', { values: { otp: code } })}
    title={uncertain ? $t('inbox.uncertainOtpHint') : $t('inbox.copyOtpAria')}
    onmousedown={(event) => event.stopPropagation()}
    onclick={(event) => { event.stopPropagation(); void copy(code, true); }}
    onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); void copy(code, true); } }}
  >
    {#if uncertain}<Icon name="warning" class="h-3.5 w-3.5 shrink-0" />{/if}
    <span class="truncate">{$t('loginInfo.otp')}: {code}</span>
  </span>
{/if}
{#if email.couponCode}
  <span
    data-coupon-badge
    role="button"
    tabindex="0"
    class="inline-flex min-h-6 max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-full bg-md-tertiary-container px-2 py-0.5 text-xs text-md-on-tertiary-container hover:bg-md-tertiary-container/80 active:bg-md-tertiary-container transition-colors"
    aria-label={$t('inbox.copyCoupon', { values: { code: email.couponCode } })}
    title={$t('inbox.copyCoupon', { values: { code: email.couponCode } })}
    onmousedown={(event) => event.stopPropagation()}
    onclick={(event) => { event.stopPropagation(); void copy(email.couponCode || '', false); }}
    onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); void copy(email.couponCode || '', false); } }}
  >
    <Icon name="localActivity" class="h-3.5 w-3.5 shrink-0" />
    <span class="truncate">{$t('inbox.couponLabel')}: {email.couponCode}</span>
  </span>
{/if}
{#if email.isReminder}
  <Badge variant="neutral" size="sm" icon="schedule" label={$t('inbox.reminderLabel')} />
{/if}
{#if email.isDeal}
  <Badge class="message-deal-badge" variant="success" size="sm" icon="localActivity" label={$t('inbox.dealLabel')} />
{/if}
