<script lang="ts">
import { t } from 'svelte-i18n';
import ButtonGroup from '@/ui/components/composites/ButtonGroup.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import Btn from '@/ui/components/primitives/Btn.svelte';
import Checkbox from '@/ui/components/primitives/Checkbox.svelte';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import {
  type ActivityCardId,
  type ActivityCardPreference,
  normalizeActivityCards,
} from '@/utils/activity/activity-history.js';

interface Props {
  open: boolean;
  cards: ActivityCardPreference[];
  saving: boolean;
  onClose: () => void;
  onChange: (cards: ActivityCardPreference[]) => Promise<void>;
}
let { open, cards, saving, onClose, onChange }: Props = $props();
const labels: Record<ActivityCardId, string> = {
  timeSaved: 'activity.timeSaved',
  expiry: 'activity.expiryOutlook',
  timeline: 'activity.activityTimeline',
  breakdown: 'activity.eventBreakdown',
  sites: 'activity.topWebsites',
  latency: 'activity.fetchLatencyMs',
  hours: 'activity.heatmapTitle',
};
function move(index: number, delta: number) {
  const next = [...cards];
  const [card] = next.splice(index, 1);
  if (!card || index + delta < 0 || index + delta >= cards.length) return;
  next.splice(index + delta, 0, card);
  void onChange(next);
}
</script>
<ModalDialog {open} title={$t('activityExplorer.dashboard')} {onClose}>
  <div class="dialog-section">
    {#each cards as card, index (card.id)}
      <div class="flex items-center gap-2 min-w-0">
        <Checkbox checked={card.visible} disabled={saving} ariaLabel={$t(labels[card.id])} onchange={(event) => { void onChange(cards.map((item) => item.id === card.id ? { ...item, visible: event.currentTarget.checked } : item)); }} />
        <span class="flex-1 min-w-0 ui-label">{$t(labels[card.id])}</span>
        <IconButton icon="chevronUp" ariaLabel={$t('common.moveUp')} disabled={saving || index === 0} onclick={() => move(index, -1)} />
        <IconButton icon="chevronDown" ariaLabel={$t('common.moveDown')} disabled={saving || index === cards.length - 1} onclick={() => move(index, 1)} />
      </div>
    {/each}
  </div>
  {#snippet footer()}
    <ButtonGroup class="gap-2">
      <Btn variant="ghost" disabled={saving} onclick={() => void onChange(normalizeActivityCards(null))}>{$t('common.resetToDefaults')}</Btn>
      <Btn variant="primary" disabled={saving} onclick={onClose}>{$t('common.done')}</Btn>
    </ButtonGroup>
  {/snippet}
</ModalDialog>
