<script lang="ts">
import { onMount } from 'svelte';
import { locale, t } from 'svelte-i18n';
import ButtonGroup from '@/ui/components/composites/ButtonGroup.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import SearchFilterHeader from '@/ui/components/composites/SearchFilterHeader.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import Btn from '@/ui/components/primitives/Btn.svelte';
import Checkbox from '@/ui/components/primitives/Checkbox.svelte';
import Dropdown from '@/ui/components/primitives/Dropdown.svelte';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import InputField from '@/ui/components/primitives/InputField.svelte';
import Skeleton from '@/ui/components/primitives/Skeleton.svelte';
import {
  ACTIVITY_DETAIL_LIMIT,
  type ActivityHistory,
  type ActivityPeriod,
  activityPeriodBounds,
  activityWebsiteHost,
  isActivityFailure,
  matchesActivityEvent,
} from '@/utils/activity/activity-history.js';
import { formatFullDateTime } from '@/utils/time/time-format.js';
import type { ActivityEvent } from '@/utils/types.js';

interface Props {
  events: ActivityEvent[];
  history: ActivityHistory | null;
  loading: boolean;
  chartDay?: string | null;
  chartHour?: number | null;
  chartType?: string;
  chartQuery?: string;
  onClearChart: () => void;
  onOpen?: (
    event: ActivityEvent,
    target: 'inbox' | 'message' | 'login' | 'settings'
  ) => Promise<void>;
  titleFor: (type: ActivityEvent['type'], data: ActivityEvent['data']) => string;
  subtitleFor: (type: ActivityEvent['type'], data: ActivityEvent['data']) => string | undefined;
  iconFor: (type: ActivityEvent['type']) => KnownIconName;
  timeFor: (timestamp: number) => string;
  onCopy: (otp: string) => Promise<void>;
}
let {
  events,
  history,
  loading,
  chartDay = null,
  chartHour = null,
  chartType = 'all',
  chartQuery = '',
  onClearChart,
  onOpen,
  titleFor,
  subtitleFor,
  iconFor,
  timeFor,
  onCopy,
}: Props = $props();
let query = $state('');
let type = $state('all');
let address = $state('all');
let period = $state<string | number>('all');
let from = $state<string | number>('');
let to = $state<string | number>('');
let failures = $state(false);
let details = $state<ActivityEvent | null>(null);
let busy = $state(false);
let skeletonList = $state<HTMLElement | null>(null);
let skeletonCount = $state(3);
let now = $state(Date.now());
onMount(() => {
  const timer = setInterval(() => {
    now = Date.now();
  }, 60000);
  return () => clearInterval(timer);
});
$effect(() => {
  const list = skeletonList;
  const viewport = list?.closest<HTMLElement>('.scroll-body');
  if (!loading || !list || !viewport) return;
  const measure = () => {
    const visibleHeight = Math.max(
      0,
      Math.min(viewport.getBoundingClientRect().bottom, window.innerHeight) -
        Math.max(viewport.getBoundingClientRect().top, list.getBoundingClientRect().top)
    );
    skeletonCount = Math.max(1, Math.ceil(visibleHeight / 76));
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(viewport);
  observer.observe(list);
  viewport.addEventListener('scroll', measure, { passive: true });
  return () => {
    observer.disconnect();
    viewport.removeEventListener('scroll', measure);
  };
});
const bounds = $derived(
  activityPeriodBounds(period as ActivityPeriod, String(from), String(to), now)
);
const invalidDates = $derived(!!bounds.from && !!bounds.to && bounds.from > bounds.to);
const addresses = $derived(
  Array.from(
    new Set(events.map((event) => event.data.address).filter((value): value is string => !!value))
  ).sort()
);
const rows = $derived.by(() => {
  const filters = {
    query: query.toLocaleLowerCase($locale || 'en'),
    type,
    chartType,
    address,
    failures,
    ...bounds,
    hour: chartHour,
    day: chartDay,
  };
  return invalidDates
    ? []
    : events.filter(
        (event) =>
          matchesActivityEvent(
            event,
            filters,
            `${titleFor(event.type, event.data)} ${subtitleFor(event.type, event.data) || ''}`
          ) &&
          (!chartQuery || activityWebsiteHost(event.data.website || '') === chartQuery)
      );
});
const days = $derived(
  (history?.days ?? [])
    .filter(
      (day) => (!bounds.from || day.day >= bounds.from) && (!bounds.to || day.day <= bounds.to)
    )
    .reverse()
);
const chartCategoryKeys: Record<string, string> = {
  address_created: 'activity.chartCreated',
  received: 'activity.chartReceived',
  auto_fill: 'activity.chartAutofilled',
  notification: 'activity.notifications',
};
async function open(event: ActivityEvent, target: 'inbox' | 'message' | 'login' | 'settings') {
  if (busy || !onOpen) return;
  busy = true;
  try {
    await onOpen(event, target);
  } finally {
    busy = false;
  }
}
function actionGroups(event: ActivityEvent) {
  const actions: { target: 'inbox' | 'message' | 'login' | 'settings'; labelKey: string }[] = [];
  if (!onOpen) return [];
  if (event.data.address && event.type !== 'account_deleted')
    actions.push({ target: 'inbox', labelKey: 'activityExplorer.openInbox' });
  if (event.data.emailId && event.data.address)
    actions.push({ target: 'message', labelKey: 'activityExplorer.openMessage' });
  if (event.data.website) actions.push({ target: 'login', labelKey: 'activityExplorer.openLogin' });
  if (event.data.toastType === 'error' || event.data.outcome === 'failure')
    actions.push({ target: 'settings', labelKey: 'diagnostics.title' });
  // Keep long translations readable at popup width without changing button fitting.
  return Array.from({ length: Math.ceil(actions.length / 2) }, (_, index) =>
    actions.slice(index * 2, index * 2 + 2)
  );
}
</script>

<div class="space-y-3" data-activity-explorer>
  <SearchFilterHeader bind:value={query} placeholder={$t('activityExplorer.search')} ariaLabel={$t('activityExplorer.search')} scope="activity" paddingClass="p-0" borderBottom={false} totalCount={events.length} filteredCount={rows.length} />
  <div class="flex flex-wrap items-end gap-2">
    <Dropdown label={$t('activityExplorer.period')} bind:value={period} options={[
      { value: 'all', label: $t('common.all') }, { value: 'today', label: $t('time.today') },
      { value: 'week', label: $t('activityExplorer.week') }, { value: 'month', label: $t('activityExplorer.month') },
      { value: 'custom', label: $t('activityExplorer.custom') },
    ]} />
    <Dropdown label={$t('activity.actionLabel')} ariaLabel={$t('activity.filterByActionType')} bind:value={type} options={[
      { value: 'all', label: $t('common.all') }, { value: 'email_received', label: $t('activity.emails') },
      { value: 'otp_detected', label: $t('activity.otps') }, { value: 'address_created', label: $t('activity.newAddress') },
      { value: 'account_deleted', label: $t('common.delete') }, { value: 'auto_fill', label: $t('nav.autofill') },
      { value: 'auto_extend', label: $t('activity.autoExtend') }, { value: 'notification_sent', label: $t('activity.notifications') },
      { value: 'toast_notification', label: $t('activity.notification') }, { value: 'hard_reset', label: $t('activity.hardReset') },
    ]} />
    <Dropdown label={$t('activity.filterByEmailAddress')} bind:value={address} options={[{ value: 'all', label: $t('common.all') }, ...addresses.map((value) => ({ value, label: value }))]} class="min-w-0 max-w-full" />
    <label class="flex items-center ui-label"><Checkbox bind:checked={failures} />{$t('activityExplorer.failures')}</label>
  </div>
  {#if period === 'custom'}
    <div class="flex flex-wrap gap-2">
      <InputField type="date" label={$t('activityExplorer.from')} bind:value={from} />
      <InputField type="date" label={$t('activityExplorer.to')} bind:value={to} error={invalidDates ? $t('activityExplorer.invalidDates') : ''} />
    </div>
  {/if}
  {#if chartDay || chartHour !== null || chartType !== 'all' || chartQuery}
    <div class="flex flex-wrap items-center gap-2">
      <Btn variant="tonal" onclick={onClearChart}>{$t('activityExplorer.clearChart')}</Btn>
      <span class="ui-support text-md-on-surface-variant" role="status">
        {#if chartDay}{new Date(`${chartDay}T12:00:00`).toLocaleDateString($locale || 'en')}{/if}
        {#if chartHour !== null}{new Date(2000, 0, 1, chartHour).toLocaleTimeString($locale || 'en', { hour: 'numeric' })}{/if}
        {#if chartCategoryKeys[chartType]}{$t(chartCategoryKeys[chartType])}{/if}
        {chartQuery}
      </span>
    </div>
  {/if}
  {#if history}
    <p class="ui-support text-md-on-surface-variant">{$t('activityExplorer.coverage', { values: { date: formatFullDateTime(history.startedAt) } })} {$t('activityExplorer.limit', { values: { limit: ACTIVITY_DETAIL_LIMIT } })}</p>
    <details class="rounded-xl border border-md-outline-variant/30 p-3">
      <summary class="ui-label cursor-pointer">{$t('activityExplorer.daily')}</summary>
      <p class="ui-support text-md-on-surface-variant my-2">{$t('activityExplorer.dailyHint')}</p>
      <div class="daily-grid max-h-52 overflow-y-auto gap-2">
        {#each days as day (day.day)}
          <div class="rounded-lg bg-md-surface-container-low p-2 ui-support">
            <time datetime={day.day}>{new Date(`${day.day}T12:00:00`).toLocaleDateString($locale || 'en')}</time>
            <div>{$t('activity.total')}: {Object.values(day.counts).reduce((sum, count) => sum + (count ?? 0), 0)}</div>
            <div>{$t('diagnostics.checks.errors')}: {day.failures}</div>
          </div>
        {:else}<p class="ui-support">{$t('activity.noMatchingActivity')}</p>{/each}
      </div>
    </details>
  {/if}
  {#if loading}
    <div bind:this={skeletonList} class="space-y-2">{#each Array(skeletonCount) as _, index (index)}<Skeleton height="4.25rem" />{/each}</div>
  {:else if !rows.length}
    <p class="rounded-xl bg-md-surface-container-low px-4 py-6 text-center ui-support text-md-on-surface-variant" role="status">{events.length ? $t('activity.noMatchingActivity') : $t('activity.noActivity')}</p>
  {:else}
    <div class="space-y-2">
      {#each rows as event (event.id)}
        <article class="rounded-2xl border border-md-outline-variant/25 bg-md-surface-container-low p-3" data-activity-event={event.id}>
          <div class="flex items-start gap-3">
            <Icon name={iconFor(event.type)} class="w-5 h-5 shrink-0 mt-1 {isActivityFailure(event) ? 'text-md-error' : 'text-md-primary'}" />
            <div class="flex-1 min-w-0">
              <div class="ui-row-primary break-words">{titleFor(event.type, event.data)}</div>
              <p class="ui-support text-md-on-surface-variant break-words">{subtitleFor(event.type, event.data) || ''}</p>
              <time class="ui-support text-md-on-surface-variant" datetime={new Date(event.timestamp).toISOString()} title={formatFullDateTime(event.timestamp)}>{timeFor(event.timestamp)}</time>
            </div>
            <IconButton icon="info" ariaLabel={$t('activityExplorer.details')} onclick={() => { details = event; }} />
          </div>
          {#if event.type === 'otp_detected' && event.data.otp}
            <div class="flex items-center gap-2 mt-2"><code aria-label={$t('activity.code')}>{event.data.otp}</code>{#if !event.data.otp.includes('•')}<Btn variant="ghost" title={$t('activity.copyOtp')} onclick={() => void onCopy(event.data.otp || '')}>{$t('common.copy')}</Btn>{/if}</div>
          {/if}
          {#each actionGroups(event) as actions, index (index)}
            <ButtonGroup class="mt-2 gap-2">
              {#each actions as action (action.target)}<Btn variant="ghost" disabled={busy} onclick={() => void open(event, action.target)}>{$t(action.labelKey)}</Btn>{/each}
            </ButtonGroup>
          {/each}
        </article>
      {/each}
    </div>
  {/if}
</div>
<ModalDialog open={details !== null} title={$t('activityExplorer.details')} onClose={() => { details = null; }}>
  {#if details}
    <div class="dialog-section break-words">
      <p class="ui-row-primary">{titleFor(details.type, details.data)}</p>
      <p class="ui-support">{formatFullDateTime(details.timestamp)}</p>
      {#if details.data.address}<p>{details.data.address}</p>{/if}
      {#if details.data.website}<p>{details.data.website}</p>{/if}
      {#if details.data.provider}<p>{details.data.provider}</p>{/if}
      {#if details.data.subject}<p>{details.data.subject}</p>{/if}
      {#if details.data.message}<p>{details.data.message}</p>{/if}
      {#if details.data.errorCode}<code>{details.data.errorCode}</code>{/if}
    </div>
  {/if}
</ModalDialog>
<style>.daily-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); }</style>
