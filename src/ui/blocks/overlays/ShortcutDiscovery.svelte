<script lang="ts">
import { t } from 'svelte-i18n';
import type { View } from '@/features/types/view-types.js';
import type { Keybinding, Keybindings } from '@/utils/types.js';
import { PORTAL_Z_CLASS, portalFlyoutAction } from '@/utils/ui/portal-layers.js';

let {
  currentView,
  keybindings,
  hasMessages,
  hasEmail,
  hasOtp,
  hasSelectableRows,
}: {
  currentView: View;
  keybindings: Keybindings;
  hasMessages: boolean;
  hasEmail: boolean;
  hasOtp: boolean;
  hasSelectableRows: boolean;
} = $props();
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
function caps(binding: Keybinding): string {
  return [
    binding.ctrlKey || binding.metaKey ? (isMac ? '⌘' : 'Ctrl') : '',
    binding.altKey ? 'Alt' : '',
    binding.shiftKey ? 'Shift' : '',
    binding.key.toUpperCase(),
  ]
    .filter(Boolean)
    .join(' + ');
}
const rows = $derived([
  { labelKey: 'keyboardShortcuts.focusSearch', keys: '/' },
  { labelKey: 'keyboardShortcuts.fixedCommandPalette', keys: `${isMac ? '⌘' : 'Ctrl'} + K` },
  { labelKey: 'keyboardShortcuts.createAddress', keys: caps(keybindings.createAddress) },
  ...(hasEmail
    ? [{ labelKey: 'keyboardShortcuts.copyEmail', keys: caps(keybindings.copyEmail) }]
    : []),
  ...(hasOtp ? [{ labelKey: 'keyboardShortcuts.copyOtp', keys: caps(keybindings.copyOtp) }] : []),
  ...(['mailbox', 'mailView', 'addresses', 'addressView'].includes(currentView)
    ? [{ labelKey: 'keyboardShortcuts.refreshMailbox', keys: caps(keybindings.refreshMailbox) }]
    : []),
  ...(['mailbox', 'mailView'].includes(currentView) && hasMessages
    ? [
        { labelKey: 'keyboardShortcuts.fixedNextMessage', keys: 'J' },
        { labelKey: 'keyboardShortcuts.fixedPreviousMessage', keys: 'K' },
      ]
    : []),
  ...(hasSelectableRows
    ? [
        { labelKey: 'keyboardShortcuts.fixedSelectRow', keys: 'X' },
        { labelKey: 'keyboardShortcuts.fixedMoveRow', keys: '↑ / ↓' },
      ]
    : []),
]);
</script>

<section use:portalFlyoutAction class="fixed inset-x-3 bottom-20 mx-auto max-w-sm max-h-[75vh] overflow-y-auto rounded-2xl bg-md-surface-container-high border border-md-outline-variant p-4 {PORTAL_Z_CLASS.menu} pointer-events-none" aria-label={$t('shortcutDiscovery.title')} data-shortcut-discovery>
  <h2 class="text-sm font-medium text-md-on-surface">{$t('shortcutDiscovery.title')}</h2>
  <p class="text-xs text-md-on-surface-variant mt-1">{$t('shortcutDiscovery.hint')}</p>
  <dl class="space-y-2 mt-3">
    {#each rows as row (row.labelKey)}
      <div class="flex items-center justify-between gap-3"><dt class="text-xs text-md-on-surface">{$t(row.labelKey)}</dt><dd class="shrink-0 text-xs font-mono text-md-on-surface-variant"><kbd>{row.keys}</kbd></dd></div>
    {/each}
  </dl>
</section>
