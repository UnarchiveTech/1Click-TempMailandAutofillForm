<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import {
  DEFAULT_TOOLBAR_BUTTON_VISIBILITY as defaultVisibility,
  parseToolbarButtonVisibility,
  type ToolbarButtonVisibility,
} from '@/features/settings/toolbar-visibility.js';
import SubpageShell from '@/ui/components/composites/SubpageShell.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import { Toggle } from '@/ui/components/primitives';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

let {
  onBack = () => {},
  showToast = (_msg: string) => {},
}: {
  onBack?: () => void;
  showToast?: (msg: string) => void;
} = $props();

let visibility = $state<ToolbarButtonVisibility>({ ...defaultVisibility });

onMount(() => {
  void browser.storage.local.get(['toolbarButtonVisibility']).then((res) => {
    if (res.toolbarButtonVisibility && typeof res.toolbarButtonVisibility === 'object') {
      visibility = parseToolbarButtonVisibility(res.toolbarButtonVisibility);
    }
  });
});

async function toggleButton(key: keyof ToolbarButtonVisibility) {
  visibility[key] = !visibility[key];
  await writeWithRetry({ toolbarButtonVisibility: $state.snapshot(visibility) });
  showToast($t('common.saved'));
}

async function resetAll() {
  visibility = { ...defaultVisibility };
  await writeWithRetry({ toolbarButtonVisibility: defaultVisibility });
  showToast($t('common.reset'));
}

const buttonsList: Array<{
  key: keyof ToolbarButtonVisibility;
  labelKey: string;
  icon: KnownIconName;
}> = [
  { key: 'star', labelKey: 'inbox.emailActions.star', icon: 'star' },
  { key: 'archive', labelKey: 'common.archive', icon: 'archive' },
  { key: 'delete', labelKey: 'common.delete', icon: 'delete' },
  { key: 'download', labelKey: 'inbox.emailActions.download', icon: 'download' },
  { key: 'forward', labelKey: 'inbox.emailActions.forward', icon: 'mail' },
  { key: 'markUnread', labelKey: 'inbox.emailActions.markUnread', icon: 'mark_email_unread' },
  { key: 'print', labelKey: 'inbox.emailActions.print', icon: 'print' },
];
</script>

<SubpageShell
  onBack={onBack}
  title={$t('settings.toolbarButtonsTitle')}
  hint={$t('settings.toolbarButtonsHint')}
  resetLabel={$t('common.reset')}
  onReset={resetAll}
>
    <!-- Message Detail Toolbar section -->
    <div class="space-y-2">
      <div class="flex items-center gap-2 mb-1">
        <Icon name="gridView" class="w-4 h-4 text-md-primary" />
        <span role="heading" aria-level="2" class="text-sm font-medium text-md-on-surface">{$t('settings.mailViewToolbar')}</span>
      </div>
      <div class="grid gap-2">
      {#each buttonsList as btn (btn.key)}
        <label class="flex items-center justify-between bg-md-surface-container-low rounded-xl px-3 py-3 border border-md-outline-variant/20 cursor-pointer">
          <div class="flex items-center gap-2.5">
            <Icon name={btn.icon} class="w-4 h-4 text-md-primary" />
            <span class="text-sm font-medium text-md-on-surface">{$t(btn.labelKey) || btn.key}</span>
          </div>
          <Toggle
            checked={visibility[btn.key]}
            onChange={() => void toggleButton(btn.key)}
          />
        </label>
      {/each}
    </div>
  </div>

</SubpageShell>
