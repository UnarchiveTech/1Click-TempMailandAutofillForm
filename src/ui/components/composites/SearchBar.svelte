<script module lang="ts">
export const INBOX_SEARCH_SHELL_CLASS =
  'w-full relative flex items-center flex-wrap ps-8 pe-16 py-1.5 text-sm rounded-xl bg-md-surface-container-high border border-md-outline-variant/40 focus-within:border-md-primary transition-colors min-h-[32px]';

export const SETTINGS_SEARCH_INPUT_CLASS =
  'flex-1 bg-transparent border-0 outline-none text-sm text-md-on-surface placeholder:text-md-on-surface-variant/60 min-w-[80px] py-0.5 ps-0 pe-0';

export type SearchShortcut = {
  prefix: string;
  label: string;
  description: string;
  /** Optional grouping for the shortcuts panel - 'exclude' entries render under
   * a dedicated "Exclude" section with error-tinted chips. Anything else is
   * treated as a regular (include) shortcut. */
  group?: string;
};

/** A live search result row rendered below the input while typing. */
export type SearchBarResult = {
  id: string;
  title: string;
  description?: string;
  /** Category / section badge shown before the title. */
  badge?: string;
};
</script>

<script lang="ts">
/**
 * Unified SearchBar component combining search input, search history chips,
 * animated rotating placeholders, voice search, and shortcuts panel.
 */
import type { Snippet } from 'svelte';
import { onDestroy, onMount, tick, untrack } from 'svelte';
import { t } from 'svelte-i18n';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { anchoredFlyout, flyoutContains } from '@/utils/ui/anchored-flyout.js';
import { PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import { rowSurface } from '@/utils/ui/row-surface.js';
import { reconcileStoredBooleanPref } from '@/utils/storage/stored-prefs-sync.js';
import { logWarn } from '@/utils/logger.js';
import { toastStore } from '@/utils/ui/toastStore.js';
import { browser } from 'wxt/browser';
import Icon from '@/ui/components/icons/Icon.svelte';
import {
  getSearchHistory,
  pushSearchHistory,
  removeSearchHistoryItem,
} from '@/utils/search/search-history.js';

let {
  scope = 'default',
  value = $bindable(''),
  placeholder = undefined as string | undefined,
  ariaLabel = undefined as string | undefined,
  settingsStyle = true,
  class: className = '',
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
  onkeydown = undefined as ((e: KeyboardEvent) => void) | undefined,
  onInputRef = undefined as ((el: HTMLInputElement | null) => void) | undefined,
  results = [] as SearchBarResult[],
  emptyResultsLabel = '',
  onResultSelect = (_r: SearchBarResult) => {},
  resultTrailing = undefined as Snippet<[SearchBarResult]> | undefined,
}: {
  scope?: string;
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  settingsStyle?: boolean;
  class?: string;
  inputClass?: string;
  onChange?: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSubmit?: (v: string) => void;
  trailing?: Snippet;
  filterControl?: Snippet;
  shortcuts?: SearchShortcut[];
  showSlashButton?: boolean;
  /** Localized search targets, inserted unchanged into the locale's sentence template. */
  animatedPlaceholders?: string[];
  showVoiceSearch?: boolean;
  prefixContent?: Snippet;
  inputId?: string;
  onkeydown?: (e: KeyboardEvent) => void;
  onInputRef?: (el: HTMLInputElement | null) => void;
  /** Live result rows shown below the input while typing (mutually exclusive
   * with the history chips, which only render when the field is empty). */
  results?: SearchBarResult[];
  /** When set, an empty-state panel renders when the query matches nothing. */
  emptyResultsLabel?: string;
  /** Called when a result row is clicked or selected with Enter. */
  onResultSelect?: (r: SearchBarResult) => void;
  /** Optional per-row trailing content (e.g. a quick-action toggle). */
  resultTrailing?: Snippet<[SearchBarResult]>;
} = $props();

let history = $state<string[]>([]);
let open = $state(false);
let searchRoot = $state<HTMLElement | null>(null);
let focused = $state(false);
let slashIconPref = $state(true);

// Anti-flash: sync-first via the shared prefs mirror - the slash icon state
// is correct at first paint when the mirror is warm (previously it popped
// in/out after the async storage read). The onChanged listener is still
// registered so toggling the pref in another view updates the icon live.
reconcileStoredBooleanPref('showSearchSlashIcon', (v) => {
  slashIconPref = v;
}, true);
onMount(() => {
  const onCh = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !changes.showSearchSlashIcon) return;
    slashIconPref = changes.showSearchSlashIcon.newValue !== false;
  };
  try {
    browser.storage.onChanged.addListener(onCh);
  } catch {
    /* ignore */
  }
  return () => {
    try {
      browser.storage.onChanged.removeListener(onCh);
    } catch {
      /* ignore */
    }
  };
});

let showSlashUi = $derived(showSlashButton && slashIconPref);
let shortcutsOpen = $state(false);
let shortcutsDismissed = $state(false);
let blurTimer: ReturnType<typeof setTimeout> | null = null;
let inputEl = $state<HTMLInputElement | null>(null);
let historyRoot = $state<HTMLDivElement | null>(null);

$effect(() => {
  if (onInputRef) {
    onInputRef(inputEl);
  }
});

type SpeechRecLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal?: boolean; 0?: { transcript?: string } }>;
      }) => void)
    | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecCtor = new () => SpeechRecLike;

let voiceSearchEnabled = $state(true);
let voiceSupported = $state(false);
let listening = $state(false);
let recognition: SpeechRecLike | null = null;
const expectedVoiceStops = new WeakSet<SpeechRecLike>();

function getSpeechRecognitionCtor(): SpeechRecCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

let showMic = $derived(showVoiceSearch && voiceSearchEnabled && voiceSupported);
let voiceInterimTimer: ReturnType<typeof setTimeout> | null = null;

function applyVoiceTranscript(text: string, isFinal: boolean) {
  value = text;
  if (isFinal) {
    if (voiceInterimTimer) {
      clearTimeout(voiceInterimTimer);
      voiceInterimTimer = null;
    }
    onChange(text);
    return;
  }
  if (voiceInterimTimer) clearTimeout(voiceInterimTimer);
  voiceInterimTimer = setTimeout(() => {
    onChange(text);
    voiceInterimTimer = null;
  }, 280);
}

function startVoiceSearch() {
  if (!voiceSupported) return;
  if (listening) {
    if (recognition) expectedVoiceStops.add(recognition);
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }
    listening = false;
    return;
  }
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    voiceSupported = false;
    return;
  }
  const rec = new Ctor();
  recognition = rec;
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = document.documentElement.lang || navigator.language || 'en-US';
  rec.onstart = () => {
    listening = true;
  };
  rec.onend = () => {
    listening = false;
  };
  rec.onerror = (event) => {
    listening = false;
    if (event.error === 'aborted' && expectedVoiceStops.has(rec)) return;
    logWarn('Voice search recognition failed', { error: event.error });
    toastStore.error($t('diagnostics.voiceFail'));
  };
  rec.onresult = (event) => {
    let transcript = '';
    let isFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const row = event.results[i];
      transcript += row[0]?.transcript || '';
      if (row.isFinal) isFinal = true;
    }
    const text = transcript.trim();
    if (text) applyVoiceTranscript(text, isFinal);
  };
  try {
    rec.start();
  } catch (error) {
    logWarn('Voice search could not start', { error: String(error) });
    toastStore.error($t('diagnostics.voiceFail'));
    listening = false;
  }
}

async function refresh() {
  history = await getSearchHistory(scope);
}

onMount(() => {
  void refresh();
  voiceSupported = typeof window !== 'undefined' && !!getSpeechRecognitionCtor();
  // Anti-flash: sync-first via the shared prefs mirror (falls back to the
  // async read when the mirror is cold); the mic icon no longer pops after
  // mount. onChanged still keeps the icon live across views.
  reconcileStoredBooleanPref('voiceSearchEnabled', (v) => {
    voiceSearchEnabled = v;
  }, true);
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !changes.voiceSearchEnabled) return;
    const v = changes.voiceSearchEnabled.newValue;
    voiceSearchEnabled = v !== false;
  };
  browser.storage.onChanged.addListener(onStorage);
  return () => {
    browser.storage.onChanged.removeListener(onStorage);
    if (voiceInterimTimer) clearTimeout(voiceInterimTimer);
    if (recognition) expectedVoiceStops.add(recognition);
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }
  };
});

let showSlashPanel = $derived(
  (showSlashButton || shortcuts.length > 0) &&
    (shortcutsOpen || (!shortcutsDismissed && focused && (value.trim() === '/' || value.trim().startsWith('/'))))
);

let activeResultIndex = $state(-1);

let resultsPanelVisible = $derived(
  !!value.trim() && (results.length > 0 || !!emptyResultsLabel)
);

// Reset the highlight index whenever the query or the result list changes.
$effect(() => {
  void value;
  void results;
  activeResultIndex = -1;
});

let includeShortcuts = $derived(shortcuts.filter((s: SearchShortcut) => (s.group || 'include') !== 'exclude'));
let excludeShortcuts = $derived(shortcuts.filter((s: SearchShortcut) => (s.group || 'include') === 'exclude'));

function handleFocus() {
  if (blurTimer) clearTimeout(blurTimer);
  focused = true;
  open = true;
  onFocus();
  // Keep the caret pinned to the start of the input while the rotating
  // placeholder overlay is visible, so it never floats mid-overlay.
  if (!value && inputEl) {
    try {
      inputEl.setSelectionRange(0, 0);
    } catch {
      /* ignore */
    }
  }
}

function handleBlur() {
  if (blurTimer) clearTimeout(blurTimer);
  blurTimer = setTimeout(() => {
    if (flyoutContains(searchRoot, document.activeElement)) return;
    focused = false;
    open = false;
    shortcutsOpen = false;
    onBlur();
  }, 180);
}

onDestroy(() => {
  if (blurTimer) clearTimeout(blurTimer);
  if (voiceInterimTimer) clearTimeout(voiceInterimTimer);
});

function handleInput(e: Event) {
  shortcutsDismissed = false;
  const target = e.target as HTMLInputElement;
  value = target.value;
  onChange(value);
}

async function commit() {
  const trimmed = value.trim();
  if (trimmed) {
    history = await pushSearchHistory(scope, trimmed);
  }
  onSubmit(trimmed);
  open = false;
  shortcutsOpen = false;
}

async function handlePick(item: string) {
  value = item;
  onChange(item);
  history = await pushSearchHistory(scope, item);
  onSubmit(item);
  open = false;
}

async function handleResultPick(item: SearchBarResult) {
  open = false;
  shortcutsOpen = false;
  activeResultIndex = -1;
  const trimmed = value.trim();
  if (trimmed) {
    history = await pushSearchHistory(scope, trimmed);
  }
  onResultSelect(item);
}

/** Shared input key handling for both the settings and plain shell variants. */
function handleInputKeydown(e: KeyboardEvent) {
  if (onkeydown) onkeydown(e);
  if (e.defaultPrevented) return;

  // The history is body-portaled, so its DOM tab order is no longer next to
  // the input. Bridge that boundary before blur dismisses the suggestions.
  if (e.key === 'Tab' && !e.shiftKey && historyRoot) {
    const first = historyRoot.querySelector<HTMLButtonElement>('button');
    if (first) {
      e.preventDefault();
      first.focus();
      return;
    }
  }

  // Arrow keys navigate the live results panel when one is visible.
  if (resultsPanelVisible && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    if (results.length === 0) return;
    if (activeResultIndex === -1) {
      activeResultIndex = e.key === 'ArrowDown' ? 0 : results.length - 1;
    } else if (e.key === 'ArrowDown') {
      activeResultIndex = (activeResultIndex + 1) % results.length;
    } else {
      activeResultIndex = (activeResultIndex - 1 + results.length) % results.length;
    }
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    if (resultsPanelVisible) {
      // With a results panel open, Enter always picks: the highlighted row
      // when one exists, otherwise the first result (standard combobox
      // behavior). With no matches there is nothing to select - do nothing.
      if (results.length > 0) {
        const idx =
          activeResultIndex >= 0 && activeResultIndex < results.length ? activeResultIndex : 0;
        void handleResultPick(results[idx]);
      }
      return;
    }
    void commit();
  } else if (e.key === 'Escape') {
    open = false;
    shortcutsOpen = false;
    activeResultIndex = -1;
    inputEl?.blur();
  }
}

function handleHistoryKeydown(e: KeyboardEvent) {
  if (e.key !== 'Tab' || !historyRoot || !inputEl) return;
  const buttons = historyRoot.querySelectorAll<HTMLButtonElement>('button');
  if (e.shiftKey && e.target === buttons[0]) {
    e.preventDefault();
    inputEl.focus();
  } else if (!e.shiftKey && e.target === buttons[buttons.length - 1]) {
    // Resume the ordinary tab sequence after the input, rather than wrapping
    // around the document from the portal at the end of body.
    inputEl.focus();
    open = false;
  }
}

async function handleRemove(e: MouseEvent, item: string) {
  e.stopPropagation();
  const focused = document.activeElement;
  history = await removeSearchHistoryItem(scope, item);
  await tick();
  if (focused instanceof HTMLElement && !focused.isConnected && document.activeElement === document.body) inputEl?.focus();
}

/** Normalizes a shortcut prefix for display/insert: guarantees a single
 * trailing ':' (callers may pass either 'from' or 'from:'). */
function colon(prefix: string): string {
  return prefix.endsWith(':') ? prefix : `${prefix}:`;
}

function applyShortcut(prefix: string) {
  shortcutsOpen = false;
  const p = colon(prefix);
  if (!value || value === '/') {
    value = p;
  } else if (!value.toLowerCase().includes(p.toLowerCase())) {
    value = `${value.trim()} ${p}`;
  }
  onChange(value);
  inputEl?.focus();
}

// Rotating placeholder shows regardless of focus (no separate "typing" placeholder).
// When animated placeholder words exist and there's no typed value, hide the static
// input placeholder entirely so ONLY the upward animation is visible.
const placeholderTargets = $derived(
  animatedPlaceholders.filter((target: string) => target.length > 0)
);
const displayPlaceholder = $derived(
  value?.trim() || placeholderTargets.length > 0 ? '' : (placeholder ?? $t('common.search'))
);
const resolvedAriaLabel = $derived(ariaLabel ?? $t('common.search'));

// ── Animated rotating placeholder (merged from RotatingPlaceholder.svelte) ──
// Each locale controls the text before and after the rotating target. Never
// strip or split translated sentences to manufacture a search target.
let animIdx = $state(0);
let animPhase = $state<'enter' | 'hold' | 'exit'>('enter');

const placeholderFrame = $derived.by(() => {
  const marker = '\uFFFC';
  const sentence = $t('searchPlaceholder.template', { values: { target: marker } });
  const index = sentence.indexOf(marker);
  return {
    prefix: index < 0 ? '' : sentence.slice(0, index),
    suffix: index < 0 ? '' : sentence.slice(index + marker.length),
  };
});
// The animation parks while the field is focused (the caret should not move
// under the user's eye) and whenever the OS asks for reduced motion.
let reducedMotion = $state(false);

onMount(() => {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = mq.matches;
  const onMqChange = (e: MediaQueryListEvent) => {
    reducedMotion = e.matches;
  };
  mq.addEventListener('change', onMqChange);
  return () => mq.removeEventListener('change', onMqChange);
});

// A locale change or a new target list must not leave an index from the old list.
$effect(() => {
  void placeholderTargets;
  animIdx = 0;
});

$effect(() => {
  if (!!value || !placeholderTargets.length) return;
  // Park the animation while the field is focused or the OS asks for reduced
  // motion: hold the current word fully visible (no motion next to the caret,
  // no timer churn) and resume with a fresh enter on unpause.
  if (focused || reducedMotion) {
    untrack(() => {
      animPhase = 'hold';
    });
    return;
  }

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = () => {
    if (cancelled) return;
    if (animPhase === 'enter') {
      animPhase = 'hold';
      timer = setTimeout(tick, 2000);
    } else if (animPhase === 'hold') {
      animPhase = 'exit';
      timer = setTimeout(tick, 300);
    } else if (animPhase === 'exit') {
      untrack(() => {
        animIdx = (animIdx + 1) % placeholderTargets.length;
      });
      animPhase = 'enter';
      timer = setTimeout(tick, 300);
    }
  };

  animPhase = 'enter';
  timer = setTimeout(tick, 300);

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
});
</script>

<div bind:this={searchRoot} class="flex items-center gap-1 w-full min-w-0 {className}" onfocusout={handleBlur}>
  <div class="relative flex-1 min-w-0">
    {#if settingsStyle}
      <div
        class="{INBOX_SEARCH_SHELL_CLASS} {trailing || showSlashButton || showMic
          ? 'pe-[4.5rem]'
          : ''} {inputClass}"
      >
        <Icon
          name="search"
          class="w-4 h-4 text-md-on-surface-variant absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none z-[1]"
        />
        {@render rotatingPlaceholder()}
        {#if prefixContent}
          {@render prefixContent()}
        {/if}
        <input
          id={inputId}
          data-app-search
          bind:this={inputEl}
          type="text"
          inputmode="search"
          enterkeyhint="search"
          class="{SETTINGS_SEARCH_INPUT_CLASS} search-no-native-clear"
          placeholder={displayPlaceholder}
          aria-label={resolvedAriaLabel}
          value={value}
          oninput={handleInput}
          onfocus={handleFocus}
          onblur={handleBlur}
          onkeydown={handleInputKeydown}
        />
        <div class="absolute end-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-[2]">
          {#if value}
            <button
              type="button"
              class="p-1 text-md-on-surface-variant/60 hover:text-md-on-surface rounded-full hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 transition-colors"
              aria-label={$t('common.clearSearch')}
              onclick={() => {
                value = '';
                onChange('');
                inputEl?.focus();
              }}
            >
              <Icon name="close" class="w-3.5 h-3.5" />
            </button>
          {/if}
          {#if showSlashUi}
            <button
              type="button"
              class="px-1.5 py-0.5 text-label-sm font-mono font-bold rounded bg-transparent text-md-on-surface-variant/80 hover:text-md-primary transition-colors cursor-pointer"
              title={$t('inbox.searchFilterShortcutsTooltip')}
              aria-label={$t('inbox.searchFilterShortcuts')}
              onclick={(e) => {
                e.stopPropagation();
                if (blurTimer) clearTimeout(blurTimer);
                shortcutsOpen = !shortcutsOpen;
                if (shortcutsOpen) {
                  open = false;
                }
                inputEl?.focus();
              }}
            >
              /
            </button>
          {/if}
          {#if showMic}
            <button
              type="button"
              class="p-1 rounded-full transition-colors cursor-pointer {listening
                ? 'text-md-error bg-md-error-container/60 animate-pulse'
                : 'text-md-on-surface-variant/60 hover:text-md-primary hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60'}"
              title={listening
                ? $t('inbox.voiceListening')
                : $t('inbox.voiceSearchTooltip')}
              aria-label={$t('inbox.voiceSearch')}
              onclick={(e) => {
                e.stopPropagation();
                startVoiceSearch();
              }}
            >
              <Icon name="mic" class="w-3.5 h-3.5" />
            </button>
          {/if}
          {#if trailing}
            {@render trailing()}
          {/if}
        </div>
      </div>
    {:else}
      <div class="relative">
        <Icon
          name="search"
          class="w-4 h-4 text-md-on-surface-variant absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none"
        />
        {@render rotatingPlaceholder()}
        <input
          id={inputId}
          data-app-search
          bind:this={inputEl}
          type="text"
          inputmode="search"
          enterkeyhint="search"
          class="w-full ps-9 pe-8 py-2 text-sm rounded-xl bg-md-surface-container-high border border-md-outline-variant/40 focus:border-md-primary focus:outline-none text-md-on-surface placeholder:text-md-on-surface-variant/60 transition-colors {inputClass}"
          placeholder={displayPlaceholder}
          aria-label={resolvedAriaLabel}
          value={value}
          oninput={handleInput}
          onfocus={handleFocus}
          onblur={handleBlur}
          onkeydown={handleInputKeydown}
        />
        {#if value}
          <button
            type="button"
            class="absolute end-2 top-1/2 -translate-y-1/2 p-1 text-md-on-surface-variant/60 hover:text-md-on-surface rounded-lg"
            aria-label={$t('common.clearSearch')}
            onclick={() => {
              value = '';
              onChange('');
              inputEl?.focus();
            }}
          >
            <Icon name="close" class="w-3.5 h-3.5" />
          </button>
        {/if}
      </div>
    {/if}

    {#if open && history.length > 0 && !value && !shortcutsOpen}
      <div
        bind:this={historyRoot}
        role="presentation"
        onkeydown={handleHistoryKeydown}
        onfocusout={handleBlur}
        use:anchoredFlyout={{ anchor: () => searchRoot, matchWidth: true, onClose: () => { open = false; } }}
        class="absolute start-0 end-0 top-full mt-1.5 p-2 rounded-xl bg-md-surface-container-high border border-md-outline-variant/40 {ELEVATION.level2} {PORTAL_Z_CLASS.menu} flex flex-wrap gap-1.5 max-h-36 overflow-y-auto"
      >
        <span class="w-full text-xs font-bold text-md-on-surface-variant/70 px-1 mb-0.5">
          {$t('searchHistory.recent')}
        </span>
        {#each history as item (item)}
          <div
            class="inline-flex max-w-full items-center gap-1 rounded-lg bg-md-surface text-xs font-medium text-md-on-surface hover:bg-md-primary/10 transition-colors group"
          >
            <button
              type="button"
              class="inline-flex min-w-0 items-center gap-1.5 px-2 py-1.5 rounded-s-lg text-start cursor-pointer"
              onclick={() => void handlePick(item)}
            >
              <Icon name="schedule" class="w-3 h-3 shrink-0 text-md-on-surface-variant/60 group-hover:text-md-primary" />
              <span class="truncate">{item}</span>
            </button>
            <button
              type="button"
              class="p-1 me-1 rounded-full hover:bg-md-outline-variant/30 active:bg-md-outline-variant/50 text-md-on-surface-variant/40 group-hover:text-md-on-surface"
              aria-label={$t('common.removeSearch')}
              onclick={(e) => void handleRemove(e, item)}
            >
              <Icon name="close" class="w-3 h-3" />
            </button>
          </div>
        {/each}
      </div>
    {/if}

    {#if resultsPanelVisible}
      <div
        use:anchoredFlyout={{ anchor: () => searchRoot, matchWidth: true }}
        class="absolute start-0 end-0 top-full mt-1.5 p-1.5 rounded-xl bg-md-surface-container-high border border-md-outline-variant/40 {ELEVATION.level2} {PORTAL_Z_CLASS.menu} space-y-1 max-h-64 overflow-y-auto"
        role="listbox"
        aria-label={resolvedAriaLabel}
      >
        {#each results as item, idx (item.id)}
          <div class="flex items-center gap-2 rounded-lg">
            <button
              type="button"
              role="option"
              aria-selected={activeResultIndex === idx}
              class="min-w-0 flex-1 flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border-0 text-start {rowSurface({ active: activeResultIndex === idx })}"
              onclick={() => void handleResultPick(item)}
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  {#if item.badge}
                    <span class="text-xs font-semibold text-md-primary bg-md-primary/10 px-1.5 py-0.5 rounded shrink-0">
                      {item.badge}
                    </span>
                  {/if}
                  <span class="text-sm font-medium text-md-on-surface truncate">{item.title}</span>
                </div>
                {#if item.description}
                  <div class="text-xs text-md-on-surface/60 truncate ps-0.5 mt-0.5">{item.description}</div>
                {/if}
              </div>
            </button>
            {#if resultTrailing}
              {@render resultTrailing(item)}
            {/if}
          </div>
        {/each}
        {#if results.length === 0 && emptyResultsLabel}
          <div class="text-xs text-md-on-surface/60 py-3 text-center">{emptyResultsLabel}</div>
        {/if}
      </div>
    {/if}

    {#if showSlashPanel}
      <div
        use:anchoredFlyout={{ anchor: () => searchRoot, matchWidth: true, onClose: () => { shortcutsOpen = false; shortcutsDismissed = true; } }}
        class="absolute start-0 end-0 top-full mt-1.5 p-2 rounded-xl bg-md-surface-container-high border border-md-outline-variant/50 {ELEVATION.level2} {PORTAL_Z_CLASS.menu} space-y-1 max-h-48 overflow-y-auto"
      >
        <div class="text-xs font-bold text-md-primary px-1 pb-1 border-b border-md-outline-variant/20 flex items-center justify-between">
          <span>{$t('inbox.searchFilterShortcuts')}</span>
          <span class="text-md-on-surface-variant/50 font-normal">{$t('inbox.searchFilterHint')}</span>
        </div>
        {#each includeShortcuts as sc (sc.prefix)}
          <button
            type="button"
            class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-md-primary/15 active:bg-md-primary/35 text-start transition-colors cursor-pointer group"
            onclick={() => applyShortcut(sc.prefix)}
          >
            <div class="flex items-center gap-2 min-w-0">
              <span class="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-md-primary/20 text-md-primary group-hover:bg-md-primary group-hover:text-md-on-primary transition-colors">
                {colon(sc.prefix)}
              </span>
              <span class="text-sm font-medium text-md-on-surface truncate">{sc.label}</span>
            </div>
              <span class="text-xs text-md-on-surface-variant/70 truncate shrink-0">{sc.description}</span>
          </button>
        {/each}
        {#if excludeShortcuts.length > 0}
          <div
            class="text-xs font-bold text-md-error px-1 pt-2 pb-0.5 mt-1 border-t border-md-outline-variant/20 flex items-center gap-1.5"
            aria-hidden="true"
          >
            <Icon name="close" class="w-3 h-3" />
            {$t('inbox.searchShortcut.excludeGroup')}
          </div>
          {#each excludeShortcuts as sc (sc.prefix)}
            <button
              type="button"
              class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-md-error/15 active:bg-md-error/35 text-start transition-colors cursor-pointer group"
              onclick={() => applyShortcut(sc.prefix)}
            >
              <div class="flex items-center gap-2 min-w-0">
                <span class="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-md-error/15 text-md-error group-hover:bg-md-error group-hover:text-md-on-error transition-colors">
                  {colon(sc.prefix)}
                </span>
                <span class="text-sm font-medium text-md-on-surface truncate">{sc.label}</span>
              </div>
              <span class="text-xs text-md-on-surface-variant/70 truncate shrink-0">{sc.description}</span>
            </button>
          {/each}
        {/if}
        {#if scope === 'inbox'}
        <p class="px-1 pt-1.5 text-xs text-md-on-surface-variant/70 border-t border-md-outline-variant/20 leading-relaxed">
          {$t('inbox.searchHelp.negateDesc')}
        </p>
        <p class="px-1 pt-1 text-xs text-md-on-surface-variant/70">
          {$t('inbox.searchHelp.savedFilters')}
        </p>
        {/if}
      </div>
    {/if}
  </div>

  {#if filterControl}
    <div class="shrink-0 flex items-center">
      {@render filterControl()}
    </div>
  {/if}
</div>

{#snippet rotatingPlaceholder()}
  {#if !value && placeholderTargets.length > 0}
    <div
      class="absolute inset-y-0 start-9 end-14 flex items-center pointer-events-none overflow-hidden"
      data-search-placeholder
      aria-hidden="true"
    >
      {#if placeholderFrame.prefix}
        <!-- Static prefix sits dim (/40); each rotating word lands at that same
             tone, then eases brighter (/75) while it holds, so the changing part
             pops against the prefix instead of matching it. -->
        <span class="text-sm text-md-on-surface-variant/40 whitespace-pre shrink-0">{placeholderFrame.prefix}</span>
      {/if}
      <div class="relative h-[20px] flex items-center overflow-hidden min-w-0">
        {#if reducedMotion}
          <!-- Reduced motion: the first tip renders statically - no slide, no timer.
               Tone matches the animated hold state so both paths agree. -->
          <span class="truncate text-sm text-md-on-surface-variant/75">{placeholderTargets[0]}</span>
        {:else}
          {#each placeholderTargets as word, i (i)}
            {#if i === animIdx}
              <span
                class="flex h-full min-w-0 items-center transition-all duration-300"
                style="transform: translateY({animPhase === 'enter' ? '20px' : animPhase === 'exit' ? '-20px' : '0'}); opacity: {animPhase === 'hold' ? '1' : '0'};"
              >
                <!-- Hold emphasis: the word arrives at the prefix's dim tone and
                     brightens over the first 700ms of the 2000ms hold - a soft
                     fade-in pop once it is stationary, not during the slide. -->
                <span
                  class="truncate w-full text-sm transition-colors duration-700 {animPhase === 'hold'
                    ? 'text-md-on-surface-variant/75'
                    : 'text-md-on-surface-variant/40'}"
                >{word}</span>
              </span>
            {/if}
          {/each}
        {/if}
      </div>
      {#if placeholderFrame.suffix}
        <span class="text-sm text-md-on-surface-variant/40 whitespace-pre shrink-0">{placeholderFrame.suffix}</span>
      {/if}
    </div>
  {/if}
{/snippet}
