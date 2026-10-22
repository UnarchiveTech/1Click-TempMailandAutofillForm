<script lang="ts">
/**
 * Declarative Floating Action component.
 *
 * Mount this component inside any page or view to dynamically register its
 * primary Floating Action Button (FAB) and Sidebar CTA without hardcoded switch-cases.
 */
import { onDestroy } from 'svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import type { SidebarFabKind } from '@/utils/ui/sidebar-fab.js';
import { type FloatingActionDescriptor, setActiveFabAction } from './fab-action-store.js';

let {
  kind = 'createAddress' as SidebarFabKind,
  icon = undefined as KnownIconName | undefined,
  labelKey = undefined as string | undefined,
  label = undefined as string | undefined,
  onclick = () => {},
}: {
  kind?: SidebarFabKind;
  icon?: KnownIconName;
  labelKey?: string;
  label?: string;
  onclick?: () => void;
} = $props();

$effect(() => {
  setActiveFabAction({
    kind,
    icon,
    labelKey,
    label,
    onclick,
  });
});

onDestroy(() => {
  setActiveFabAction(null);
});
</script>
