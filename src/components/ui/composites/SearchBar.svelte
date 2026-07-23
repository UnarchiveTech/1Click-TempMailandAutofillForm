<script lang="ts">
/**
 * Reusable SearchBar composite — mailbox-aligned search with optional:
 * - history chips, / shortcuts (via SearchWithHistory)
 * - filter control snippet
 * - voice search button inside the bar (after "/" operators)
 */
import type { Snippet } from 'svelte';
import SearchWithHistory, { type SearchShortcut } from '@/components/ui/SearchWithHistory.svelte';

let {
  scope = 'default',
  value = $bindable(''),
  placeholder = 'Search…',
  ariaLabel = 'Search',
  settingsStyle = true,
  inputClass = '',
  onChange = (_v: string) => {},
  onFocus = () => {},
  onBlur = () => {},
  onSubmit = (_v: string) => {},
  trailing = undefined as Snippet | undefined,
  filterControl = undefined as Snippet | undefined,
  shortcuts = [] as SearchShortcut[],
  showSlashButton = false,
  animatedPlaceholders = [] as string[],
  showVoiceSearch = true,
  prefixContent = undefined as Snippet | undefined,
  inputId = undefined as string | undefined,
} = $props<{
  scope?: string;
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  settingsStyle?: boolean;
  inputClass?: string;
  onChange?: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSubmit?: (v: string) => void;
  trailing?: Snippet;
  filterControl?: Snippet;
  shortcuts?: SearchShortcut[];
  showVoiceSearch?: boolean;
  showSlashButton?: boolean;
  animatedPlaceholders?: string[];
  prefixContent?: Snippet;
  inputId?: string;
}>();
</script>

<div class="search-bar-composite w-full min-w-0">
  <SearchWithHistory
    {scope}
    bind:value
    {placeholder}
    {ariaLabel}
    {settingsStyle}
    {inputClass}
    {onChange}
    {onFocus}
    {onBlur}
    {onSubmit}
    {trailing}
    {filterControl}
    {shortcuts}
    {showSlashButton}
    {animatedPlaceholders}
    {showVoiceSearch}
    {prefixContent}
    {inputId}
  />
</div>
