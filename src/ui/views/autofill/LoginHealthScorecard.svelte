<script lang="ts">
/**
 * Saved Logins health scorecard - aggregate view over auditLoginHealth().
 * Renders the overall score + one tappable row per issue kind; tapping a row
 * toggles a list filter that shows only the affected logins.
 */
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import { rowSurface } from '@/utils/ui/row-surface.js';
import {
  healthChipClass,
  healthIconTint,
  LOGIN_HEALTH_KIND_ICON,
  LOGIN_HEALTH_KIND_LABEL_KEY,
  LOGIN_HEALTH_SEVERITY_TONE,
} from './login-health-ui.js';

type HealthIssueKind = 'expired_mailbox' | 'reused_password' | 'stale_login';
type HealthSeverity = 'high' | 'medium' | 'low';

type HealthSummaryItem = {
  kind: HealthIssueKind;
  severity: HealthSeverity;
  count: number;
};

type HealthSummary = {
  score: number;
  total: number;
  atRisk: number;
  kinds: HealthSummaryItem[];
};

let {
  summary = undefined as unknown as HealthSummary,
  activeKind = null as HealthIssueKind | null,
  onToggleKind = (_kind: HealthIssueKind) => {},
} = $props();

let expanded = $state(true);
const hasIssues = $derived(summary.kinds.length > 0);
const scoreTone = $derived.by((): 'error' | 'warning' | 'neutral' | 'good' => {
  if (summary.kinds.length === 0) return 'good';
  if (summary.kinds.some((k) => k.severity === 'high')) return 'error';
  if (summary.kinds.some((k) => k.severity === 'medium')) return 'warning';
  return 'neutral';
});
</script>

<div class="bg-md-surface-container-highest rounded-xl overflow-hidden">
  {#if hasIssues}
    <button
      type="button"
      class="w-full flex items-center gap-2.5 px-3 py-2.5 text-start hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 transition-colors"
      aria-expanded={expanded}
      onclick={() => {
        expanded = !expanded;
      }}
    >
      <span
        class="w-9 h-9 rounded-full flex items-center justify-center shrink-0 {healthChipClass(
          scoreTone
        )}"
        aria-hidden="true"
      >
        <Icon name="shield" class="w-5 h-5" />
      </span>
      <span class="flex-1 min-w-0">
        <span class="block text-xs font-bold text-md-on-surface">{$t('savedLoginInfo.healthScore')}</span>
        <span class="block text-label-sm text-md-on-surface/55">
          {$t('savedLoginInfo.healthAttention', {
            values: { count: summary.atRisk, total: summary.total },
          })}
        </span>
      </span>
      <span class="shrink-0 flex items-baseline gap-0.5 {healthIconTint(scoreTone)}">
        <span class="text-base font-extrabold leading-none">{summary.score}</span>
        <span class="text-label-sm">/100</span>
      </span>
      <Icon
        name="chevronDown"
        class="w-4 h-4 shrink-0 text-md-on-surface/40 {expanded ? 'rotate-180' : ''}"
      />
    </button>

    {#if expanded}
      <div class="px-2 pb-2 space-y-0.5">
        {#each summary.kinds as item (item.kind)}
          {@const tone = LOGIN_HEALTH_SEVERITY_TONE[item.severity]}
          {@const isActive = activeKind === item.kind}
          <button
            type="button"
            class="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl text-start {rowSurface({ active: isActive })}"
            aria-pressed={isActive}
            onclick={(e) => {
              e.stopPropagation();
              onToggleKind(item.kind);
            }}
          >
            <Icon
              name={LOGIN_HEALTH_KIND_ICON[item.kind]}
              class="w-4 h-4 shrink-0 {healthIconTint(tone)}"
            />
            <span class="flex-1 min-w-0 text-label-sm font-semibold text-md-on-surface">
              {$t(LOGIN_HEALTH_KIND_LABEL_KEY[item.kind])}
            </span>
            <span
              class="shrink-0 inline-flex px-1.5 py-0.5 rounded-md text-label-sm font-bold min-w-5 justify-center {healthChipClass(
                tone,
                isActive
              )}"
              >{item.count}</span
            >
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="flex items-center gap-2.5 px-3 py-2.5">
      <span class="w-9 h-9 rounded-full flex items-center justify-center shrink-0 {healthChipClass('good')}" aria-hidden="true">
        <Icon name="checkCircle" class="w-5 h-5" />
      </span>
      <span class="flex-1 min-w-0">
        <span class="block text-xs font-bold text-md-on-surface">{$t('savedLoginInfo.healthScore')}</span>
        <span class="block text-label-sm text-md-on-surface/55">{$t('savedLoginInfo.healthAllGood')}</span>
      </span>
      <span class="shrink-0 flex items-baseline gap-0.5 text-md-primary">
        <span class="text-base font-extrabold leading-none">{summary.score}</span>
        <span class="text-label-sm">/100</span>
      </span>
    </div>
  {/if}
</div>
