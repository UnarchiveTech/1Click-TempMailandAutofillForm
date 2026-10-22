<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { t } from 'svelte-i18n';
import CopyButton from '@/ui/components/composites/CopyButton.svelte';
import { generateTOTP } from '@/utils/otp/totp.js';

let {
  secret = '',
  staticOtp = '',
  compact = false,
  class: className = '',
}: {
  secret?: string;
  staticOtp?: string;
  compact?: boolean;
  class?: string;
} = $props();

let code = $state('');
let secondsRemaining = $state(30);
let timerId: ReturnType<typeof setInterval> | undefined;

async function updateTotp() {
  if (secret && secret.trim().length > 0) {
    const res = await generateTOTP(secret);
    if (res.code) {
      code = res.code;
      secondsRemaining = res.secondsRemaining;
      return;
    }
  }
  // Fallback to static OTP if secret is invalid or missing
  code = staticOtp || '';
  secondsRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
}

onMount(() => {
  void updateTotp();
  timerId = setInterval(() => {
    void updateTotp();
  }, 1000);
});

onDestroy(() => {
  if (timerId) clearInterval(timerId);
});

// Format code into 2 groups of 3 (e.g., "123 456")
const formattedCode = $derived.by(() => {
  if (!code) return '------';
  const clean = code.replace(/\s+/g, '');
  if (clean.length === 6) {
    return `${clean.slice(0, 3)} ${clean.slice(3)}`;
  }
  return clean;
});

// SVG ring math (r=9, circumference = 2 * PI * 9 ≈ 56.548)
const circumference = 56.548;
const strokeDashoffset = $derived(circumference * (1 - secondsRemaining / 30));
</script>

<div class="inline-flex items-center gap-2 rounded-xl bg-md-surface-variant/40 border border-md-outline-variant/30 px-2.5 py-1 text-xs select-none {className}">
  <!-- Radial SVG Ring -->
  <div class="relative w-5 h-5 flex items-center justify-center shrink-0" title={$t('time.secondsRemaining', { values: { n: secondsRemaining } })}>
    <svg class="w-5 h-5 -rotate-90 text-md-outline-variant/30" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" class="opacity-30" />
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-dasharray={circumference}
        stroke-dashoffset={strokeDashoffset}
        stroke-linecap="round"
        class="transition-all duration-300 ease-linear {secondsRemaining <= 5 ? 'text-md-error' : 'text-md-primary'}"
      />
    </svg>
    <span class="absolute inset-0 flex items-center justify-center text-label-sm font-bold font-mono text-md-on-surface/70">
      {secondsRemaining}
    </span>
  </div>

  <!-- Formatted TOTP Code -->
  <span class="font-mono font-bold tracking-widest text-md-primary text-xs">
    {formattedCode}
  </span>

  {#if !compact}
    <!-- Copy Button -->
    <CopyButton
      text={code.replace(/\s+/g, '')}
      sensitive
      size="sm"
      tooltip={$t('contentAutofill.copyTotpCodeTooltip')}
    />
  {/if}
</div>
