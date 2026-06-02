<script lang="ts">
import Icon from '@/components/icons/Icon.svelte';

let {
  tag = null,
  tagColor = null,
  onClick = () => {},
  showIcon = true,
} = $props<{
  tag?: string | null;
  tagColor?: string | null;
  onClick?: () => void;
  showIcon?: boolean;
}>();

const buttonClass = $derived.by(() => {
  const base =
    'text-[11px] font-semibold tracking-wider px-2 py-0.5 rounded-full w-fit text-left transition-all duration-200 flex items-center gap-1.5 cursor-pointer';

  if (tagColor) {
    return `${base} text-white ${showIcon ? 'border border-md-outline-variant' : ''}`;
  }

  if (tag) {
    return `${base} bg-md-surface-variant/10 text-md-on-surface/70 hover:bg-md-surface-variant/20 ${showIcon ? 'border border-md-outline-variant bg-md-surface-variant' : ''}`;
  }

  return `${base} bg-md-surface-variant/5 text-md-on-surface/40 italic hover:bg-md-surface-variant/10 ${showIcon ? 'border border-md-outline-variant bg-md-surface-variant' : ''}`;
});

const iconClass = $derived.by(() => {
  return tagColor ? 'w-3 h-3 text-white/70' : 'w-3 h-3 text-md-on-surface/50';
});

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onClick();
  }
}
</script>

<button
  class={buttonClass}
  style:background-color={tagColor}
  style:transition="background-color 0.2s ease"
  onclick={onClick}
  onkeydown={handleKeyDown}
  aria-label={tag ? 'Edit tag' : 'Add a tag'}
  title={tag ? `Tag: ${tag}` : 'Add a tag'}
>
  {#if showIcon}
    <Icon name="tag" class={iconClass} />
  {/if}
  {tag || 'Add a tag'}
</button>
