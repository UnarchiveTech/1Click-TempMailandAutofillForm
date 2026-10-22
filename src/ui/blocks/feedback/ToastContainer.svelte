<script lang="ts">
import { PORTAL_Z, PORTAL_Z_CLASS } from '@/utils/ui/portal-layers';
import { toastStore } from '@/utils/ui/toastStore';
import ToastComponent from './Toast.svelte';
import type { Toast } from './toast-types.js';

let toasts = $derived($toastStore);
let visibleToasts = $derived(toasts.slice(-3));

function handleClose(id: string) {
  toastStore.remove(id);
}
</script>

<!--
  Bottom-right of the email list area (above floating nav + multi-row strips).
  Avoid full-width so toasts never cover the bottom strip stack.
-->
<div
  class="fixed end-2 {PORTAL_Z_CLASS.toast} flex flex-col items-end gap-1.5 pointer-events-none max-w-[min(320px,calc(100%-1rem))]"
  style="bottom: max(7.5rem, calc(env(safe-area-inset-bottom, 0px) + 6.5rem));"
>
  {#each visibleToasts as toast (toast.id)}
    <ToastComponent {toast} onClose={handleClose} />
  {/each}
</div>
