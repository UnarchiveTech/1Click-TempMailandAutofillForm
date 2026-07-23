<script lang="ts">
import { toastStore } from '@/utils/toastStore';
import type { Toast } from './Toast.svelte';
import ToastComponent from './Toast.svelte';

let toasts = $state<Toast[]>([]);
let visibleToasts = $derived(toasts.slice(-3));

$effect(() => {
  return toastStore.subscribe((newToasts) => {
    toasts = newToasts;
  });
});

function handleClose(id: string) {
  toastStore.remove(id);
}
</script>

<!--
  Bottom-right of the email list area (above floating nav + multi-row strips).
  Avoid full-width so toasts never cover the bottom strip stack.
-->
<div
  class="fixed end-2 z-[9000] flex flex-col items-end gap-1.5 pointer-events-none max-w-[min(320px,calc(100%-1rem))]"
  style="bottom: max(7.5rem, calc(env(safe-area-inset-bottom, 0px) + 6.5rem));"
>
  {#each visibleToasts as toast (toast.id)}
    <ToastComponent {toast} onClose={handleClose} />
  {/each}
</div>
