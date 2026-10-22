<script lang="ts">
import { tick } from 'svelte';
import { t } from 'svelte-i18n';
import { messageTabDomId, type OpenedMessageTab } from '@/features/address/message-tabs.js';
import Dropdown from '@/ui/components/primitives/Dropdown.svelte';
import FaviconImage from '@/ui/components/primitives/FaviconImage.svelte';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import { avatarInitial } from '@/utils/theme/avatar-initials.js';
import { enableHorizontalWheelScroll } from '@/utils/ui/horizontal-wheel-scroll.js';
import { controlSurface } from '@/utils/ui/row-surface.js';

let {
  tabs,
  activeKey,
  idPrefix,
  onSelect,
  onClose,
}: {
  tabs: OpenedMessageTab[];
  activeKey: string;
  idPrefix: string;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
} = $props();

const label = (tab: OpenedMessageTab) => tab.thread[0]?.subject?.trim() || $t('activity.noSubject');
const options = $derived(
  tabs.map((tab) => ({ value: tab.key, label: label(tab), hint: tab.mailboxAddress }))
);

async function focusTab(key: string) {
  await tick();
  const tab = document.getElementById(messageTabDomId(idPrefix, key));
  tab?.focus({ preventScroll: true });
  tab?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
}

function select(key: string) {
  onSelect(key);
  void focusTab(key);
}

async function close(key: string) {
  onClose(key);
  await tick();
  const next = tabs.find((tab) => tab.key === activeKey) || tabs[0];
  if (next) await focusTab(next.key);
  else document.getElementById(`${idPrefix}-panel`)?.focus({ preventScroll: true });
}

function handleKey(event: KeyboardEvent, key: string) {
  const index = tabs.findIndex((tab) => tab.key === key);
  const rtl = getComputedStyle(event.currentTarget as HTMLElement).direction === 'rtl';
  let next = index;
  if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = (index + 1) % tabs.length;
  else if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft'))
    next = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    event.stopPropagation();
    void close(key);
    return;
  } else return;
  event.preventDefault();
  event.stopPropagation();
  const tab = tabs[next];
  if (tab) select(tab.key);
}
</script>

<div class="flex min-w-0 shrink-0 items-center gap-1 border-b border-md-outline-variant/30" data-message-tabs>
  <div class="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label={$t('inbox.messageTabsLabel')} aria-orientation="horizontal" use:enableHorizontalWheelScroll>
    {#each tabs as tab (tab.key)}
      {@const active = tab.key === activeKey}
      <div class="flex shrink-0 items-center text-md-on-surface-variant {controlSurface(active, 'underline')}" role="presentation">
        <button
          type="button"
          role="tab"
          id={messageTabDomId(idPrefix, tab.key)}
          aria-controls={`${idPrefix}-panel`}
          aria-selected={active}
          aria-label={label(tab)}
          tabindex={active || (!activeKey && tab === tabs[0]) ? 0 : -1}
          title={`${label(tab)} · ${tab.mailboxAddress}`}
          class="flex h-10 min-w-0 max-w-[192px] items-center gap-2 px-2 text-sm font-semibold text-inherit focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-[-2px]"
          onclick={() => select(tab.key)}
          onkeydown={(event) => handleKey(event, tab.key)}
          onauxclick={(event) => { if (event.button === 1) { event.preventDefault(); void close(tab.key); } }}
        >
          <FaviconImage email={tab.thread[0]?.from || ''} size="xs" fallbackLetter={avatarInitial(tab.thread[0]?.from_name || tab.thread[0]?.from)} />
          <span class="min-w-0 truncate">{label(tab)}</span>
        </button>
        <IconButton icon="close" size="sm" ariaLabel={$t('inbox.closeMessageTab', { values: { subject: label(tab) } })} tabindex={active ? 0 : -1} onclick={() => { void close(tab.key); }} />
      </div>
    {/each}
  </div>
  <Dropdown
    value={activeKey}
    {options}
    size="button"
    variant="elevated"
    triggerLabel=""
    ariaLabel={$t('inbox.messageTabsLabel')}
    class="w-10 shrink-0"
    onchange={(value) => select(String(value))}
  />
</div>
