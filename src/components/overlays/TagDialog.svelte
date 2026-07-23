<script lang="ts">
import { onDestroy, tick } from 'svelte';
import Icon from '@/components/icons/Icon.svelte';
import { getErrorMessage } from '@/utils/errors.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { validateTextInput } from '@/utils/validation.js';

interface Props {
  open: boolean;
  currentTag: string | null;
  currentTagColor: string | null;
  /** Multi-tag: currently assigned tags on the address */
  currentTags?: Array<{ name: string; color: string }>;
  existingTags: string[];
  tagColors: Record<string, string>;
  onClose: () => void;
  onSave: (tag: string, color: string) => void;
  /** Preferred multi-tag save (full list) */
  onSaveTags?: (tags: Array<{ name: string; color: string }>) => void;
  /**
   * When true (default), portal overlay to document.body.
   * When false, keep overlay inside the parent (use for split-view panes).
   */
  portal?: boolean;
}
let {
  open,
  currentTag,
  currentTagColor,
  currentTags = [],
  existingTags,
  tagColors,
  onClose,
  onSave,
  onSaveTags,
  portal = true,
}: Props = $props();

let tagInput = $state('');
let selectedExistingTag = $state<string | null>(null);
let selectedColor = $state('#6366F1');
/** Multi-select assigned tags */
let selectedTags = $state<Array<{ name: string; color: string }>>([]);
let validationError = $state('');
let dialogRef = $state<HTMLElement | null>(null);
let overlayEl = $state<HTMLElement | null>(null);
let cleanupFocusTrap: (() => void) | null = null;

/** Portal to document.body so AccountSelector (and other transformed parents) never cover us */
$effect(() => {
  if (!open || !overlayEl || !portal) return;
  if (overlayEl.parentElement !== document.body) {
    document.body.appendChild(overlayEl);
  }
  return () => {
    try {
      if (overlayEl?.parentElement === document.body) overlayEl.remove();
    } catch {
      /* ignore */
    }
  };
});

onDestroy(() => {
  try {
    if (portal && overlayEl?.parentElement === document.body) overlayEl.remove();
  } catch {
    /* ignore */
  }
});

/** Position mode: body portal uses fixed; in-pane (split/mainview) uses absolute */
let overlayPositionClass = $derived(
  portal ? 'fixed inset-0 z-[10000]' : 'absolute inset-0 z-[10000]'
);

// Initialize with current tag(s) when dialog opens
$effect(() => {
  if (!open) return;
  validationError = '';
  if (currentTags && currentTags.length > 0) {
    selectedTags = currentTags.map((t) => ({ name: t.name, color: t.color || '#6366F1' }));
    tagInput = '';
    selectedExistingTag = null;
    selectedColor = selectedTags[0]?.color || '#6366F1';
  } else if (currentTag) {
    selectedTags = [{ name: currentTag, color: currentTagColor || '#6366F1' }];
    tagInput = currentTag;
    selectedExistingTag = currentTag;
    selectedColor = currentTagColor || '#6366F1';
  } else {
    selectedTags = [];
    tagInput = '';
    selectedExistingTag = null;
    selectedColor = '#6366F1';
  }
});

let previousActiveElement = $state<HTMLElement | null>(null);

// Setup focus trap when dialog opens
$effect(() => {
  let prevOverflow = '';
  if (open) {
    previousActiveElement = document.activeElement as HTMLElement;
    // Only lock body scroll when portaled (full-surface dialog)
    if (portal) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    // Small delay to ensure DOM is updated
    void tick().then(() => {
      if (dialogRef) {
        cleanupFocusTrap = setupFocusTrap(dialogRef);
      }
    });
  }
  return () => {
    if (cleanupFocusTrap) {
      cleanupFocusTrap();
      cleanupFocusTrap = null;
    }
    if (portal && prevOverflow !== '') {
      document.body.style.overflow = prevOverflow;
    }
    if (previousActiveElement) {
      previousActiveElement.focus();
      previousActiveElement = null;
    }
  };
});

function handleSave() {
  // Flush pending typed tag into multi-list
  let pending = (selectedExistingTag || tagInput).trim();
  let next = [...selectedTags];
  if (pending) {
    try {
      pending = validateTextInput(pending, 'Tag', 32);
    } catch (error) {
      validationError = getErrorMessage(error);
      return;
    }
    const colorToSave =
      selectedExistingTag && tagColors[selectedExistingTag]
        ? tagColors[selectedExistingTag]
        : selectedColor;
    if (!next.some((t) => t.name.toLowerCase() === pending.toLowerCase())) {
      next = [...next, { name: pending, color: colorToSave }];
    }
  }
  if (onSaveTags) {
    onSaveTags(next);
    return;
  }
  // Legacy single-tag save
  const first = next[0];
  if (!first) {
    onSave('', '');
    return;
  }
  onSave(first.name, first.color);
}

function selectExistingTag(tag: string) {
  // Toggle in multi-select list
  const color = tagColors[tag] || selectedColor;
  const idx = selectedTags.findIndex((t) => t.name.toLowerCase() === tag.toLowerCase());
  if (idx >= 0) {
    selectedTags = selectedTags.filter((_, i) => i !== idx);
  } else {
    selectedTags = [...selectedTags, { name: tag, color }];
  }
  selectedExistingTag = tag;
  tagInput = tag;
  selectedColor = color;
}

function clearSelection() {
  selectedExistingTag = null;
  tagInput = '';
  selectedTags = [];
}

function removeSelectedTag(name: string) {
  selectedTags = selectedTags.filter((t) => t.name !== name);
}
</script>

{#if open}
  <!-- portal=true → body fixed; portal=false → absolute inside parent (mainview/split) -->
  <div
    bind:this={overlayEl}
    class="{overlayPositionClass} flex items-center justify-center"
    role="dialog"
    aria-modal="true"
    data-tag-dialog-overlay
  >
    <div
      class="absolute inset-0 bg-md-scrim/40 backdrop-blur-sm"
      role="button"
      tabindex="-1"
      onclick={(e) => { e.stopPropagation(); onClose(); }}
      onkeydown={(e) => e.key === 'Escape' && onClose()}
    ></div>

    <button
      id="button-close-dialog"
      class="absolute top-4 end-4 z-10 w-9 h-9 rounded-full bg-md-surface-container hover:bg-md-surface-variant flex items-center justify-center shadow-md transition-colors"
      aria-label="Close dialog"
      onclick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <Icon name="x" class="w-4 h-4 text-md-on-surface/70" />
    </button>

    <div
      class="relative z-10 bg-md-surface-container rounded-xl px-4 py-2 shadow-2xl"
      tabindex="-1"
      bind:this={dialogRef}
    >
      <div>
        <h3 class="font-bold text-base mb-1">Set Tags</h3>
        <p class="text-xs text-md-on-surface/60">Add multiple tags — toggle existing or type a new one</p>
      </div>

      {#if selectedTags.length > 0}
        <div class="flex flex-wrap gap-1.5 mb-1">
          {#each selectedTags as st (st.name)}
            <button
              type="button"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-md-primary/15 text-md-primary border border-md-primary/25"
              onclick={(e) => { e.stopPropagation(); removeSelectedTag(st.name); }}
              title="Remove {st.name}"
            >
              <span class="w-2 h-2 rounded-full" style:background-color={st.color}></span>
              {st.name}
              <Icon name="x" class="w-3 h-3 opacity-70" />
            </button>
          {/each}
        </div>
      {/if}

      <!-- Input field -->
      <div class="flex items-center gap-2">
        <input
          id="input-tag-name"
          type="text"
          class="flex-1 px-3 py-2 rounded-lg border border-md-outline-variant text-sm bg-md-surface-container-low outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
          placeholder="Enter tag name..."
          aria-label="Tag name"
          maxlength="12"
          bind:value={tagInput}
          oninput={() => {
            validationError = '';
            if (selectedExistingTag && (tagInput !== selectedExistingTag || tagInput === '')) {
              selectedExistingTag = null;
            }
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              // Add typed tag to multi list without closing
              const pending = tagInput.trim();
              if (pending) {
                try {
                  const v = validateTextInput(pending, 'Tag', 32);
                  if (!selectedTags.some((t) => t.name.toLowerCase() === v.toLowerCase())) {
                    selectedTags = [...selectedTags, { name: v, color: selectedColor }];
                  }
                  tagInput = '';
                  selectedExistingTag = null;
                } catch (error) {
                  validationError = getErrorMessage(error);
                }
              } else {
                handleSave();
              }
            } else if (e.key === 'Escape') onClose();
          }}
        />
        {#if validationError}
          <p class="text-xs text-md-error">{validationError}</p>
        {/if}
        {#if selectedExistingTag || tagInput || selectedTags.length}
          <button
            id="button-clear-tag"
            class="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors"
            aria-label="Clear"
            onclick={(e) => { e.stopPropagation(); clearSelection(); }}
          >
            <Icon name="x" class="w-4 h-4 text-md-on-surface/60" />
          </button>
        {/if}
      </div>

      <!-- Color picker -->
      <div>
        <p class="text-xs font-semibold text-md-on-surface/50 uppercase tracking-wider mb-2">Tag Color</p>
        <div class="flex items-center gap-2 flex-wrap">
          {#each ['#6366F1', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#64748B'] as color}
            <button
              id="button-color-{color.replace('#', '')}"
              class="w-6 h-6 rounded-full border-2 {selectedColor === color ? 'border-md-secondary-container scale-110' : 'border-transparent'} transition-all"
              style:background-color={color}
              onclick={(e) => { e.stopPropagation(); selectedColor = color; }}
              aria-label={`Select color ${color}`}
            ></button>
          {/each}
        </div>
      </div>

      <!-- Existing tags -->
      {#if existingTags.length > 0}
        <div>
          <p class="text-xs font-semibold text-md-on-surface/50 uppercase tracking-wider mb-2">Existing Tags</p>
          <div class="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {#each existingTags as tag}
              {@const isOn = selectedTags.some((t) => t.name.toLowerCase() === tag.toLowerCase())}
              <button
                id="button-select-tag-{tag}"
                class="px-2 py-1 text-xs rounded-full flex items-center gap-1 {isOn ? 'bg-md-primary text-md-on-primary' : 'bg-transparent hover:bg-md-surface-variant'} transition-colors"
                onclick={(e) => { e.stopPropagation(); selectExistingTag(tag); }}
                aria-label="Select tag {tag}"
                aria-pressed={isOn}
              >
                {#if tagColors[tag]}
                  <span class="w-3 h-3 rounded-full" style:background-color={tagColors[tag]}></span>
                {/if}
                {tag}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Action buttons -->
      <div class="flex gap-2 pt-2">
        <button
          id="button-cancel-tag"
          class="flex-1 px-3 py-1.5 text-sm rounded-xl bg-md-secondary text-md-on-secondary hover:bg-md-secondary/90 transition-colors"
          aria-label="Cancel"
          onclick={(e) => { e.stopPropagation(); onClose(); }}
        >
          Cancel
        </button>
        <button
          id="button-save-tag"
          class="flex-1 px-3 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors"
          aria-label="Save tag"
          onclick={(e) => { e.stopPropagation(); handleSave(); }}
        >
          Save
        </button>
      </div>
    </div>
  </div>
{/if}
