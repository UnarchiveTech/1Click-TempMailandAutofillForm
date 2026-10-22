<script lang="ts">
import { t } from 'svelte-i18n';
import ButtonGroup from '@/ui/components/composites/ButtonGroup.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import Btn from '@/ui/components/primitives/Btn.svelte';

interface Props {
  confirmDialog: {
    message: string;
    onConfirm: () => void;
    title?: string;
    confirmLabel?: string;
    secondaryLabel?: string;
    onSecondary?: () => void;
    note?: string;
    destructive?: boolean;
  } | null;
  confirmDialogRef?: HTMLElement | null;
  onClose: () => void;
}
let { confirmDialog, confirmDialogRef = $bindable(null), onClose }: Props = $props();
</script>

{#if confirmDialog}
  <ModalDialog
    open={!!confirmDialog}
    activityDialogKey="dialog:confirm"
    title={confirmDialog.title ?? $t('common.confirmAction')}
    maxWidth="xs"
    showCloseButton={false}
    {onClose}
    bind:dialogRef={confirmDialogRef}
  >
    <div class="dialog-content-stack">
    <p class="text-sm text-md-on-surface">{confirmDialog.message}</p>
    {#if confirmDialog.note}
      <p class="text-xs text-md-on-surface-variant bg-md-surface-container-high rounded-lg px-3 py-2">{confirmDialog.note}</p>
    {/if}
    {#if confirmDialog.onSecondary && confirmDialog.secondaryLabel}
      <Btn
        variant="outline"
        size="md"
        class="w-full text-md-primary border-md-primary justify-start"
        aria-label={confirmDialog.secondaryLabel}
        onclick={() => confirmDialog.onSecondary?.()}
      >
        {confirmDialog.secondaryLabel}
      </Btn>
    {/if}
    </div>

    {#snippet footer()}
      <ButtonGroup>
        <Btn
          variant="ghost"
          label={$t('common.cancel')}
          aria-label={$t('common.cancel')}
          onclick={onClose}
        />
        <Btn
          variant={confirmDialog.destructive ? 'danger' : 'primary'}
          label={confirmDialog.confirmLabel ?? $t('common.confirm')}
          aria-label={confirmDialog.confirmLabel ?? $t('common.confirm')}
          onclick={() => {
            const fn = confirmDialog.onConfirm;
            fn();
            onClose();
          }}
        />
      </ButtonGroup>
    {/snippet}
  </ModalDialog>
{/if}
