<script lang="ts">
import IconX from '@/components/icons/IconX.svelte';
import { getErrorMessage } from '@/utils/errors.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { validateTextInput } from '@/utils/validation.js';

interface Props {
  open: boolean;
  currentTag: string | null;
  currentTagColor: string | null;
  existingTags: string[];
  tagColors: Record<string, string>;
  onClose: () => void;
  onSave: (tag: string, color: string) => void;
}
let { open, currentTag, currentTagColor, existingTags, tagColors, onClose, onSave }: Props =
  $props();

let tagInput = $state('');
let selectedExistingTag = $state<string | null>(null);
let selectedColor = $state('#6366F1');
let validationError = $state('');
let dialogRef = $state<HTMLElement | null>(null);
let cleanupFocusTrap: (() => void) | null = null;

// Initialize with current tag when dialog opens
$effect(() => {
  if (open && currentTag) {
    tagInput = currentTag;
    selectedExistingTag = currentTag;
    if (currentTagColor) {
      selectedColor = currentTagColor;
    }
  } else if (open) {
    tagInput = '';
    selectedExistingTag = null;
  }
  validationError = '';
});

// Setup focus trap when dialog opens
$effect(() => {
  if (open && dialogRef) {
    // Small delay to ensure DOM is updated
    setTimeout(() => {
      if (dialogRef) {
        cleanupFocusTrap = setupFocusTrap(dialogRef);
      }
    }, 50);
  }
  return () => {
    if (cleanupFocusTrap) {
      cleanupFocusTrap();
      cleanupFocusTrap = null;
    }
  };
});

function handleSave() {
  let tagToSave = selectedExistingTag || tagInput.trim();
  if (!tagToSave) {
    onSave('', '');
    return;
  }
  try {
    tagToSave = validateTextInput(tagToSave, 'Tag', 32);
  } catch (error) {
    validationError = getErrorMessage(error);
    return;
  }
  const colorToSave =
    selectedExistingTag && tagColors[selectedExistingTag]
      ? tagColors[selectedExistingTag]
      : selectedColor;
  onSave(tagToSave, colorToSave);
}

function selectExistingTag(tag: string) {
  selectedExistingTag = tag;
  tagInput = tag;
  if (tagColors[tag]) {
    selectedColor = tagColors[tag];
  }
}

function clearSelection() {
  selectedExistingTag = null;
  tagInput = '';
}
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
    <div
      class="absolute inset-0 bg-md-surface/30 backdrop-blur-sm"
      role="button"
      tabindex="-1"
      onclick={onClose}
      onkeydown={(e) => e.key === 'Escape' && onClose()}
    ></div>

    <button
      id="button-close-dialog"
      class="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-md-surface hover:bg-md-surface-variant flex items-center justify-center shadow-md transition-colors"
      aria-label="Close dialog"
      onclick={onClose}
    >
      <IconX class="w-4 h-4 text-md-on-surface/70" />
    </button>

    <div
      class="relative bg-md-surface rounded-xl px-4 py-2"
      tabindex="-1"
      bind:this={dialogRef}
    >
      <div>
        <h3 class="font-bold text-base mb-1">Set Tag</h3>
        <p class="text-xs text-md-on-surface/60">Enter a custom tag or select an existing one</p>
      </div>

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
            // Clear selected existing tag when user types in input or clears it
            if (selectedExistingTag && (tagInput !== selectedExistingTag || tagInput === '')) {
              selectedExistingTag = null;
            }
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') handleSave();
            else if (e.key === 'Escape') onClose();
          }}
        />
        {#if validationError}
          <p class="text-xs text-md-error">{validationError}</p>
        {/if}
        {#if selectedExistingTag || tagInput}
          <button
            id="button-clear-tag"
            class="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors"
            aria-label="Clear"
            onclick={clearSelection}
          >
            <IconX class="w-4 h-4 text-md-on-surface/60" />
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
              style="background-color: {color};"
              onclick={() => selectedColor = color}
              aria-label={`Select color ${color}`}
            ></button>
          {/each}
        </div>
      </div>

      <!-- Existing tags -->
      {#if existingTags.length > 0}
        <div>
          <p class="text-xs font-semibold text-md-on-surface/50 uppercase tracking-wider mb-2">Existing Tags</p>
          <div class="flex flex-wrap gap-2 max-h-40 overflow-y-auto" style="scrollbar-width: thin; scrollbar-color: var(--md-primary) transparent;">
            {#each existingTags as tag}
              <button
                id="button-select-tag-{tag}"
                class="px-2 py-1 text-xs rounded-full flex items-center gap-1 {selectedExistingTag === tag ? 'bg-md-primary text-md-on-primary' : 'bg-transparent hover:bg-md-surface-variant'} transition-colors"
                onclick={() => selectExistingTag(tag)}
                aria-label="Select tag {tag}"
              >
                {#if tagColors[tag]}
                  <span class="w-3 h-3 rounded-full" style="background-color: {tagColors[tag]};"></span>
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
          onclick={onClose}
        >
          Cancel
        </button>
        <button
          id="button-save-tag"
          class="flex-1 px-3 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors"
          aria-label="Save tag"
          onclick={handleSave}
        >
          Save
        </button>
      </div>
    </div>
  </div>
{/if}
