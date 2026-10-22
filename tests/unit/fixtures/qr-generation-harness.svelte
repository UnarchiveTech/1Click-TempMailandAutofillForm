<script lang="ts">
import type { Writable } from 'svelte/store';
import QrDialog from '@/ui/blocks/dialogs/QrDialog.svelte';

let {
  scenario,
  onDownload,
  onCopyImage,
}: {
  scenario: Writable<{ open: boolean; email: string }>;
  onDownload: () => void;
  onCopyImage: () => void;
} = $props();
</script>

<QrDialog open={$scenario.open} selectedEmail={$scenario.email} onClose={() => scenario.update((value) => ({ ...value, open: false }))} {onDownload} {onCopyImage} />
