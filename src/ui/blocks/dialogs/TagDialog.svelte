<script lang="ts">
import { untrack } from 'svelte';
import { t } from 'svelte-i18n';
import ColorPicker from '@/ui/components/composites/ColorPicker.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn, IconButton, InputField } from '@/ui/components/primitives';
import TagPill from '@/ui/components/primitives/TagPill.svelte';
import {
  DEFAULT_TAG_COLOR,
  tagColorFor,
  tagReachCount,
  tagUsageInfo,
} from '@/utils/address/address-tags.js';
import { localizedErrorMessageOrFallback } from '@/utils/errors.js';
import { getContrastColor } from '@/utils/theme/color-utils.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { validateTextInput } from '@/utils/validation.js';

interface Props {
  open: boolean;
  currentTag: string | null;
  currentTagColor: string | null;
  /** Multi-tag: currently assigned tags on the address */
  currentTags?: Array<{ name: string; color: string }>;
  existingTags: string[];
  /** `buildTagColors(...)`: one color per tag, keyed by the LOWER-CASED name. */
  tagColors: Record<string, string>;
  /**
   * Lower-cased tag name → the address emails that use it, for the hover info on
   * each existing tag ("which mail addresses is this tag on?"). Keyed the same
   * way `existingTagNames` de-dupes, so a hover can never miss on casing.
   */
  tagAddresses?: Record<string, string[]>;
  onClose: () => void;
  onManageTags?: () => void;
  /** Save the FULL selected tag list (multi-tag aware). Returning false (or a
   * promise of false) keeps the dialog open so the user sees the error toast
   * instead of a silently-dropped save. */
  onSaveTags: (tags: Array<{ name: string; color: string }>) => unknown;
  portal?: boolean;
}
let {
  open,
  currentTag,
  currentTagColor,
  currentTags = [],
  existingTags,
  tagColors,
  tagAddresses = {},
  onClose,
  onManageTags,
  onSaveTags,
  portal = true,
}: Props = $props();

let tagInput = $state('');
let selectedExistingTag = $state<string | null>(null);
/**
 * The color the tag in play is saved with: the tag's OWN color when the dialog
 * opened on one, the picked swatch after a pick, and `null` while neither exists -
 * a brand-new tag the user has not colored yet has no color to show here, and the
 * palette must not pretend otherwise (a typed tag takes `DEFAULT_TAG_COLOR` unless
 * a swatch is picked).
 */
let selectedColor = $state<string | null>(null);
let selectedTags = $state<Array<{ name: string; color: string }>>([]);
let validationError = $state('');
let saving = $state(false);
let dialogRef = $state<HTMLElement | null>(null);
let seededForOpen = false;

/** Swatch palette offered when typing a new tag (first entry mirrors the
 * DEFAULT_TAG_COLOR fallback in address-tags). */
const DEFAULT_TAG_COLORS = [
  '#6366F1', // Indigo
  '#EC4899', // Pink
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#EF4444', // Red
  '#06B6D4', // Cyan
] as const;

/** Localized swatch names, index-aligned with DEFAULT_TAG_COLORS. */
const TAG_COLOR_NAMES = [
  'tagManagement.colorIndigo',
  'tagManagement.colorPink',
  'tagManagement.colorEmerald',
  'tagManagement.colorAmber',
  'tagManagement.colorBlue',
  'tagManagement.colorPurple',
  'tagManagement.colorRed',
  'tagManagement.colorCyan',
] as const;

// Initialize with current tag(s) when dialog opens
$effect(() => {
  if (!open) {
    seededForOpen = false;
    return;
  }
  if (seededForOpen) return;
  seededForOpen = true;

  // Props can change while this dialog is open (for example a background tag
  // refresh). Seed once per opening, without subscribing to those props or the
  // editable state, so an update cannot erase the user's in-progress choices.
  untrack(() => {
    validationError = '';
    if (currentTags.length > 0) {
      // Through the shared lookup, like the single-tag branch below: the address may
      // store a color the tag does not have, and the chips outside already paint the
      // tag's one color, so seeding from the row would make the dialog disagree.
      selectedTags = currentTags.map((tag) => ({
        ...tag,
        color: tagColorFor(tagColors, tag.name) ?? tag.color,
      }));
      tagInput = '';
      selectedExistingTag = null;
      // The swatch shows the color of the tag it would change.
      selectedColor = selectedTags[0]?.color ?? DEFAULT_TAG_COLOR;
    } else if (currentTag) {
      // The tag's ONE color wins over the color stored on this address, through the
      // shared case-insensitive lookup: the chip behind the dialog already paints
      // that color, so seeding the swatch from a per-address one would show - and
      // then write back - a second color for a tag that is supposed to have one.
      const color = tagColorFor(tagColors, currentTag) ?? currentTagColor ?? DEFAULT_TAG_COLOR;
      selectedTags = [{ name: currentTag, color }];
      tagInput = '';
      selectedExistingTag = currentTag;
      selectedColor = color;
    } else {
      selectedTags = [];
      tagInput = '';
      selectedExistingTag = null;
      selectedColor = null;
    }
  });
});

/**
 * The palette entry equal to `color`, compared case-INSENSITIVELY - a tag stored as
 * `#6366f1` is the swatch `#6366F1` - or `null` when the color is not one of the
 * eight. A custom hex has no swatch to mark, and marking some other one instead
 * would claim a color the tag does not have.
 */
function swatchFor(color: string | null | undefined): string | null {
  const wanted = color?.trim().toLowerCase();
  if (!wanted) return null;
  return DEFAULT_TAG_COLORS.find((c) => c.toLowerCase() === wanted) ?? null;
}

/**
 * The swatch marked as CHOSEN: the one equal to the tag's current color - and the
 * picked one once a pick happens, since a pick is what will be written.
 *
 * The mark is a TICK, and `null` means no tick anywhere, which is a real answer
 * rather than a gap: the palette shows which color the tag has, so a tag with none
 * in this palette (a custom hex, or a new tag not colored yet) reads as "nothing
 * chosen" instead of marking a default. A bare ring could not carry that meaning -
 * it reads equally well as hover or keyboard focus, so it never said whether this
 * tag had a color here at all.
 */
const chosenSwatch = $derived(swatchFor(selectedColor));

/**
 * How many addresses carry this tag, and the hover that names them - from the
 * shared helper, so this list's count and text are the same facts every other
 * tag chip shows. `null` when nothing carries the tag, which is also what makes
 * the hover fall back to no tooltip (never an empty "Used by:").
 */
function usageOf(tag: string) {
  return tagUsageInfo($t, tagAddresses, tag);
}

function toggleTag(name: string, color: string) {
  const idx = selectedTags.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
  if (idx >= 0) {
    selectedTags = selectedTags.filter((_, i) => i !== idx);
  } else {
    selectedTags = [...selectedTags, { name, color }];
  }
}

/**
 * Pick the color of the tag being edited.
 *
 * The palette is the TAG's color, not a default for the next typed tag: a pick
 * recolors every tag in the current selection, and the save hands those colors to
 * the background, which writes each one to EVERY address carrying that tag (a tag
 * is one tag, so its color is the tag's). Before this a pick reached nothing but a
 * tag the user was about to type - changing an existing tag's color was impossible.
 */
function pickColor(color: string) {
  selectedColor = color;
  if (selectedTags.length === 0) return;
  selectedTags = selectedTags.map((tag) => ({ ...tag, color }));
}

function handleColorKeydown(event: KeyboardEvent, index: number) {
  const button = event.currentTarget as HTMLButtonElement;
  const rtl = getComputedStyle(button).direction === 'rtl';
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = DEFAULT_TAG_COLORS.length - 1;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    next = index + (event.key === 'ArrowRight' && rtl ? -1 : 1);
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = index + (event.key === 'ArrowLeft' && rtl ? 1 : -1);
  } else return;
  event.preventDefault();
  event.stopPropagation();
  next = (next + DEFAULT_TAG_COLORS.length) % DEFAULT_TAG_COLORS.length;
  pickColor(DEFAULT_TAG_COLORS[next]);
  button.parentElement?.querySelectorAll<HTMLButtonElement>('[data-tag-swatch]')[next]?.focus();
}

/**
 * The selected tags that ALREADY exist - the ones a pick reaches beyond this
 * dialog. A tag typed in here exists on no address yet, so it moves nothing.
 */
const recoloringTagNames = $derived.by(() => {
  const existing = new Set(existingTags.map((tag) => tag.toLowerCase()));
  return selectedTags
    .filter((selected) => existing.has(selected.name.toLowerCase()))
    .map((selected) => selected.name);
});

/**
 * True while the selection holds a tag that already exists - i.e. while a pick
 * would change the tag on OTHER addresses too, which is what the hint discloses.
 */
const recolorsExistingTag = $derived(recoloringTagNames.length > 0);

/**
 * How many addresses the pick would move: the union over those existing tags,
 * counted once per address (an address carrying two of them moves once). The hint
 * renders this, so its disclosure of the reach is a NUMBER, not only a sentence
 * the user has to imagine the size of.
 */
const recoloredAddressCount = $derived(tagReachCount(tagAddresses, recoloringTagNames));

/** Available tags stay below the preview; selected names are shown only once. */
const availableExistingTags = $derived(
  existingTags.filter(
    (tag) => !selectedTags.some((selected) => selected.name.toLowerCase() === tag.toLowerCase())
  )
);

function handleAddTypedTag() {
  const trimmed = tagInput.trim();
  if (!trimmed) return;

  const names = trimmed
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (addTagNames(names)) tagInput = '';
}

function addTagNames(names: string[]): boolean {
  if (names.length === 0) return true;
  try {
    // Validate the whole batch before changing selection, and add idempotently
    // so repeated names never toggle a tag off.
    const sanitized = names.map((name) => validateTextInput(name, $t('common.addTag'), 32));
    validationError = '';
    // A tag typed without a pick still needs a color: the palette's default,
    // exactly as before - picking is what overrides it.
    const next = [...selectedTags];
    for (const name of sanitized) {
      if (next.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) continue;
      next.push({
        name,
        color: tagColorFor(tagColors, name) ?? selectedColor ?? DEFAULT_TAG_COLOR,
      });
    }
    selectedTags = next;
    return true;
  } catch (err) {
    validationError = localizedErrorMessageOrFallback(err, $t, 'errors.validationError');
    return false;
  }
}

function handleTagInput(value: string) {
  if (!value.includes(',')) {
    tagInput = value;
    return;
  }

  const segments = value.split(',');
  const completedNames = segments
    .slice(0, -1)
    .map((name) => name.trim())
    .filter(Boolean);
  if (addTagNames(completedNames)) {
    tagInput = (segments[segments.length - 1] ?? '').trimStart();
  } else {
    // Keep the invalid portion editable so the user can correct it.
    tagInput = value;
  }
}

function handleTagInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleAddTypedTag();
  } else if (
    event.key === 'Backspace' &&
    (event.currentTarget as HTMLInputElement).value === '' &&
    selectedTags.length > 0
  ) {
    event.preventDefault();
    selectedTags = selectedTags.slice(0, -1);
    validationError = '';
  }
}

async function handleSave() {
  if (saving) return;
  validationError = '';
  try {
    if (tagInput.trim()) {
      handleAddTypedTag();
      if (validationError) return;
    }
    // Always hand the FULL selected list to the caller. Never fall back to
    // saving only the first tag - that silently discarded tags 2..N behind a
    // success-close (multi-select-integrity violation).
    saving = true;
    const saved = (await onSaveTags(selectedTags.map((tag) => ({ ...tag })))) !== false;
    // Keep the dialog open when the save was rejected (returns false) so the
    // user sees the error toast instead of a silently-dropped tag.
    if (saved) onClose();
  } catch (err) {
    // The save crosses into storage; keep the dialog open and name the tag
    // failure instead of showing a raw DOMException/storage message.
    validationError = localizedErrorMessageOrFallback(err, $t, 'toasts.tagSaveFailed');
  } finally {
    saving = false;
  }
}

function requestClose() {
  if (!saving) onClose();
}
</script>

<ModalDialog
  {open}
  activityDialogKey="dialog:tag"
  title={$t('tagManagement.setTags')}
  subtitle={$t('tagManagement.setTagsHint')}
  maxWidth="sm"
  compact
  onClose={requestClose}
  bind:dialogRef
>
  {#if onManageTags}
    {#snippet headerActions()}
      <IconButton
        icon="settings"
        size="sm"
        disabled={saving}
        ariaLabel={$t('nav.tagManagement')}
        title={$t('nav.tagManagement')}
        onclick={() => {
          onClose();
          onManageTags();
        }}
      />
    {/snippet}
  {/if}
  <div class="dialog-form" inert={saving} aria-busy={saving}>
  <!-- Type new tag -->
  <div class="dialog-field">
    <label for="input-tag-name" class="dialog-field-label">{$t('tagManagement.tagName')}</label>
    <div class="flex items-start gap-2">
      <InputField
        id="input-tag-name"
        placeholder={$t('tagManagement.tagNamePlaceholder')}
        bind:value={tagInput}
        error={validationError}
        class="flex-1 min-w-0"
        oninput={(e) => handleTagInput(e.currentTarget.value)}
        onkeydown={handleTagInputKeydown}
      />
      <Btn
        variant="tonal"
        onclick={handleAddTypedTag}
      >
        {$t('common.add')}
      </Btn>
    </div>

  </div>

  <!-- Color selector -->
  <div class="dialog-section">
    <p id="tag-color-label" class="dialog-field-label">{$t('tagManagement.tagColor')}</p>
    <div class="flex items-start gap-2">
    <div class="tag-palette grid grid-cols-[repeat(4,48px)] shrink-0" role="radiogroup" aria-labelledby="tag-color-label">
      {#each DEFAULT_TAG_COLORS as c, i (c)}
        <!--
          The chosen swatch carries a TICK, and no other swatch does. The tick is
          ink ON the swatch's own color, so it takes the absolute contrast helper:
          the contrast helper gives the tick ink that stays legible on each
          swatch, including the dark-theme palette.

          It is decorative - `aria-checked` already carries the state, so the glyph
          must not be announced a second time - and `data-chosen` marks it for the
          real-extension probe (`scripts/tag-merge-shot.ts`).
        -->
        <button
          type="button"
          role="radio"
          aria-checked={chosenSwatch === c}
          tabindex={chosenSwatch === c || (!chosenSwatch && i === 0) ? 0 : -1}
          data-tag-swatch={c}
          data-chosen={chosenSwatch === c ? 'true' : undefined}
          class="md-action w-12 h-12 rounded-full shrink-0 inline-flex items-center justify-center text-md-on-surface"
          onclick={(e) => { e.stopPropagation(); pickColor(c); }}
          onkeydown={(e) => handleColorKeydown(e, i)}
          aria-label={$t(TAG_COLOR_NAMES[i])}
        >
          <span class="w-8 h-8 rounded-full inline-flex items-center justify-center" style="background-color: {c}; color: {getContrastColor(c)}">
            {#if chosenSwatch === c}
              <Icon name="check" class="w-5 h-5" />
            {/if}
          </span>
        </button>
      {/each}
    </div>
    <div class="flex min-w-0 flex-col items-center gap-1">
      <ColorPicker
        value={selectedColor || ''}
        presets={[]}
        allowClear={false}
        disabled={saving}
        triggerSize="touch"
        triggerIcon="edit"
        ariaLabel={$t('tagManagement.customColor')}
        onChange={pickColor}
      />
      <span class="text-xs text-md-on-surface-variant text-center break-words max-w-full">{$t('tagManagement.customColor')}</span>
    </div>
    </div>
    {#if recolorsExistingTag}
      <p class="text-xs text-md-on-surface-variant">
        {$t('tagManagement.tagColorHint', { values: { n: recoloredAddressCount } })}
      </p>
    {/if}
  </div>

  <!-- One preview of the tags that will be saved. Selected existing tags move
       out of the available list below, so no name is printed twice. -->
  {#if selectedTags.length > 0}
    <div class="dialog-section">
      <p class="dialog-field-label">{$t('tagManagement.preview')}</p>
      <div class="flex flex-wrap items-center gap-2">
        {#each selectedTags as selected (selected.name)}
          <TagPill
            tag={selected.name}
            tagColor={selected.color}
            usage={usageOf(selected.name)}
            onClick={() => toggleTag(selected.name, selected.color)}
            showIcon={true}
            removable={true}
          />
        {/each}
      </div>
    </div>
  {/if}

  <!-- Existing tags list -->
  {#if availableExistingTags.length > 0}
    <div class="dialog-section">
      <p class="dialog-field-label">{$t('tagManagement.existingTags')}</p>
      <div class="flex flex-wrap gap-2">
        {#each availableExistingTags as tag (tag)}
          {@const color = tagColorFor(tagColors, tag) || DEFAULT_TAG_COLOR}
          {@const usage = usageOf(tag)}
          <TagPill
            tag={tag}
            tagColor={color}
            {usage}
            onClick={() => toggleTag(tag, color)}
            showIcon={true}
            addable={true}
          />
        {/each}
      </div>
    </div>
  {/if}
  </div>

  {#snippet footer()}
    <div class="w-full flex flex-nowrap items-center gap-2" use:responsiveButtonLayout data-action-tier="S">
      <button
        type="button"
        id="button-cancel-tag"
        disabled={saving}
        class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-transparent text-md-on-surface transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
        onclick={(e) => { e.stopPropagation(); requestClose(); }}
      >
        <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.cancel')}</span>
      </button>
      <button
        type="button"
        id="button-save-tag"
        disabled={saving}
        aria-busy={saving}
        class="md-action flex-1 min-w-0 h-10 px-2.5 rounded-xl bg-md-primary text-md-on-primary transition-colors inline-flex items-center justify-center gap-1.5 font-bold tracking-wide whitespace-nowrap overflow-visible"
        onclick={(e) => { e.stopPropagation(); handleSave(); }}
      >
        <span class="btn-label leading-tight self-center whitespace-nowrap overflow-visible">{$t('common.save')}</span>
      </button>
    </div>
  {/snippet}
</ModalDialog>
