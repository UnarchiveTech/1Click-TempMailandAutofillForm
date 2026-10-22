<script lang="ts">
import type { Snippet } from 'svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import { ELEVATION } from '@/utils/ui/elevation.js';

let {
  variant = 'card',
  title = '',
  description = '',
  titleClass = '',
  descriptionClass = '',
  icon = undefined as KnownIconName | undefined,
  action,
  header,
  children,
  class: className = '',
  ...rest
}: {
  /** 'card' - elevated MD3 card. 'row' - flat settings-row surface. */
  variant?: 'card' | 'row';
  title?: string;
  description?: string;
  /** Override the variant's default title typography (e.g. group labels). */
  titleClass?: string;
  /** Override the variant's default description typography (e.g. label-sm hints). */
  descriptionClass?: string;
  icon?: KnownIconName;
  /** Rendered right of the title/description block. */
  action?: Snippet;
  /** Fully custom header - replaces the title/description/action block. */
  header?: Snippet;
  /** Rendered below the header. */
  children?: Snippet;
  class?: string;
} & Record<string, unknown> = $props();
</script>

<div
  class="{variant === 'row'
    ? 'bg-md-surface-container-low rounded-xl px-3 py-3 border border-md-outline-variant/20'
    : 'bg-md-surface-container rounded-2xl p-4 {ELEVATION.level1} border border-md-outline-variant/15 flex flex-col gap-3 transition-colors'} {className}"
  {...rest}
>
  {#if header}
    {@render header()}
  {:else if title || icon || action}
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2.5 min-w-0">
        {#if icon}
          <div class="w-8 h-8 rounded-xl bg-md-primary/10 text-md-primary flex items-center justify-center shrink-0">
            <Icon name={icon} class="w-4 h-4" />
          </div>
        {/if}
        <div class="min-w-0">
          {#if title}
            <div
              class="{titleClass ||
                (variant === 'row'
                  ? 'text-sm font-medium text-md-on-surface'
                  : 'text-sm font-bold text-md-on-surface truncate')}"
            >
              {title}
            </div>
          {/if}
          {#if description}
            <div
              class="{descriptionClass ||
                (variant === 'row'
                  ? 'text-xs text-md-on-surface/50'
                  : 'text-xs text-md-on-surface/60 truncate')}"
            >
              {description}
            </div>
          {/if}
        </div>
      </div>
      {#if action}
        <div class="shrink-0 flex items-center gap-2">
          {@render action()}
        </div>
      {/if}
    </div>
  {/if}

  {#if children}
    {@render children()}
  {/if}
</div>