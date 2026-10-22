<script lang="ts">
import { loadLazyComponent } from '@/ui/blocks/layout/lazy-view.svelte.js';
import ViewFallback from '@/ui/blocks/layout/ViewFallback.svelte';
import type { Email } from '@/utils/types.js';

type DetailMode = 'split' | 'page';

let {
  mode,
  context,
  selectedThread,
  hasPrev,
  hasNext,
  mailboxAddress,
  messageScrollKey = '',
  scrollTop = 0,
  onScrollTopChange = () => {},
  onBack,
  onPrev,
  onNext,
  onCreateRule,
  onMarkUnread,
  onArchive,
  onDelete,
  onSearchText,
  onManageLabels = () => {},
  showToast,
}: {
  mode: DetailMode;
  context: 'popup' | 'sidepanel' | 'app';
  selectedThread: Email[];
  hasPrev: boolean;
  hasNext: boolean;
  mailboxAddress: string;
  messageScrollKey?: string;
  scrollTop?: number;
  onScrollTopChange?: (key: string, scrollTop: number) => void;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCreateRule: (from?: string) => void;
  onMarkUnread: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onSearchText: (query: string) => void;
  onManageLabels?: () => void;
  showToast: (message: string) => void;
} = $props();

const mailView = loadLazyComponent(() => import('@/ui/views/mailbox/MailView.svelte'));
</script>

{#if mailView.component}
  {@const MailViewCmp = mailView.component}
  <MailViewCmp
    {context}
    {selectedThread}
    {hasPrev}
    {hasNext}
    {mailboxAddress}
    {messageScrollKey}
    {scrollTop}
    {onScrollTopChange}
    showToolbarLabels={mode === 'split'}
    onBack={onBack}
    onPrev={onPrev}
    onNext={onNext}
    onCreateRule={onCreateRule}
    onMarkUnread={onMarkUnread}
    onArchive={onArchive}
    onDelete={onDelete}
    showToast={showToast}
    onSearchText={onSearchText}
    onManageLabels={onManageLabels}
  />
{:else}
  <ViewFallback failed={mailView.failed} />
{/if}
