<script lang="ts">
import { t } from 'svelte-i18n';
import { useVerificationPreferences } from '@/features/address/use-verification-preferences.svelte.js';
import SettingCard from '@/ui/components/composites/SettingCard.svelte';
import InputField from '@/ui/components/primitives/InputField.svelte';
import { toastStore } from '@/utils/ui/toastStore.js';

const preferences = useVerificationPreferences(() =>
  toastStore.error($t('toasts.operationFailed'))
);
</script>

<SettingCard id="setting-verification-time-limit" title={$t('verification.timeLimit')} description={$t('verification.timeLimitHint')} descriptionClass="ui-support text-md-on-surface-variant" class="space-y-2">
  <InputField id="verification-time-limit" type="number" label={$t('verification.minutes')} value={preferences.value.maxAgeMinutes} min={1} max={1440} step={1} disabled={preferences.saving} onblur={(event) => {
    const input = event.currentTarget;
    if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) { input.value = String(preferences.value.maxAgeMinutes); return; }
    void preferences.save({ maxAgeMinutes: input.valueAsNumber });
  }} onkeydown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
</SettingCard>
