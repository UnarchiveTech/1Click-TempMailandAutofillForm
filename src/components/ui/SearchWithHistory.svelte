<script lang="ts">
/**
 * Shared page search bar (mailbox-aligned):
 * - MD3 body-small / label styles (text-sm shell)
 * - Recent history as chips when focused & empty
 * - Optional "/" shortcuts button + typing /
 * - Optional external filter control via `filterControl` snippet (rendered beside the bar)
 */
import type { Snippet } from 'svelte';
import { onMount, untrack } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import {
  getSearchHistory,
  pushSearchHistory,
  removeSearchHistoryItem,
} from '@/utils/search-history.js';

/** Inbox-matching shell — MD3 body-small (text-sm = 14) for primary controls */
export const INBOX_SEARCH_SHELL_CLASS =
  'w-full flex items-center flex-wrap gap-1 ps-8 pe-16 py-1.5 text-sm rounded-xl bg-md-surface-container-high border border-md-outline-variant/40 focus-within:border-md-primary transition-colors min-h-[32px]';

export const SETTINGS_SEARCH_INPUT_CLASS =
  'flex-1 bg-transparent border-0 outline-none text-sm text-md-on-surface placeholder:text-md-on-surface-variant/60 min-w-[80px] py-0.5';

export type SearchShortcut = { prefix: string; label: string; description: string };

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
  /** Legacy trailing inside the bar (prefer filterControl outside) */
  trailing = undefined as Snippet | undefined,
  /** Rendered immediately after the search field (e.g. Filter button) */
  filterControl = undefined as Snippet | undefined,
  /** When set, enables / shortcuts panel (mailbox-style) */
  shortcuts = [] as SearchShortcut[],
  showSlashButton = false,
  animatedPlaceholders = [] as string[],
  /** When true, show mic after "/" if user enabled voice search + API exists */
  showVoiceSearch = true,
  /** Optional chips/pills rendered inside the shell before the text input (mailbox-style) */
  prefixContent = undefined as Snippet | undefined,
  /** Optional id for the input element */
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
  showSlashButton?: boolean;
  animatedPlaceholders?: string[];
  showVoiceSearch?: boolean;
  prefixContent?: Snippet;
  inputId?: string;
}>();

let history = $state<string[]>([]);
let open = $state(false);
let focused = $state(false);
let shortcutsOpen = $state(false);
let blurTimer: ReturnType<typeof setTimeout> | null = null;
let inputEl = $state<HTMLInputElement | null>(null);
let placeholderTyped = $state('');

type SpeechRecLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ 0?: { transcript?: string } }>;
      }) => void)
    | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecCtor = new () => SpeechRecLike;

/** Default ON — user can disable in Settings → Search */
let voiceSearchEnabled = $state(true);
let voiceSupported = $state(false);
let listening = $state(false);
let recognition: SpeechRecLike | null = null;

function getSpeechRecognitionCtor(): SpeechRecCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

let showMic = $derived(showVoiceSearch && voiceSearchEnabled && voiceSupported);

function startVoiceSearch() {
  if (!voiceSupported || listening) {
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }
    listening = false;
    return;
  }
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return;
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
  rec.onerror = () => {
    listening = false;
  };
  rec.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0]?.transcript || '';
    }
    const text = transcript.trim();
    if (text) {
      value = text;
      onChange(text);
    }
  };
  try {
    rec.start();
  } catch {
    listening = false;
  }
}

async function refresh() {
  history = await getSearchHistory(scope);
}

onMount(() => {
  void refresh();
  voiceSupported = !!getSpeechRecognitionCtor();
  void browser.storage.local.get(['voiceSearchEnabled']).then((res) => {
    const v = (res as { voiceSearchEnabled?: boolean }).voiceSearchEnabled;
    // Default true when unset; only hide when user explicitly disabled
    voiceSearchEnabled = v !== false;
  });
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !changes.voiceSearchEnabled) return;
    const v = changes.voiceSearchEnabled.newValue;
    voiceSearchEnabled = v !== false;
  };
  browser.storage.onChanged.addListener(onStorage);
  return () => {
    browser.storage.onChanged.removeListener(onStorage);
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }
  };
});

// Animated placeholder — depend only on a stable key string, never on placeholderTyped.
// Parent often passes a fresh array each render; join() keeps dependency stable.
let placeholderLabelsKey = $derived((animatedPlaceholders || []).join('\0'));
$effect(() => {
  const busy = !!value?.trim();
  const key = placeholderLabelsKey;
  const labels = key ? key.split('\0') : [];
  if (busy || !labels.length) {
    // untrack: reading placeholderTyped must NOT subscribe this effect to it
    untrack(() => {
      if (placeholderTyped !== '') placeholderTyped = '';
    });
    return;
  }
  let cancelled = false;
  let idx = 0;
  let typed = '';
  let phase: 'type' | 'hold' | 'delete' = 'type';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    if (cancelled) return;
    const full = labels[idx % labels.length] || '';
    if (phase === 'type') {
      if (typed.length < full.length) {
        typed = full.slice(0, typed.length + 1);
        placeholderTyped = typed;
        timer = setTimeout(tick, 45);
      } else {
        phase = 'hold';
        timer = setTimeout(tick, 1400);
      }
    } else if (phase === 'hold') {
      phase = 'delete';
      timer = setTimeout(tick, 30);
    } else if (typed.length > 0) {
      typed = typed.slice(0, -1);
      placeholderTyped = typed;
      timer = setTimeout(tick, 28);
    } else {
      idx = (idx + 1) % labels.length;
      phase = 'type';
      timer = setTimeout(tick, 200);
    }
  };
  typed = '';
  untrack(() => {
    if (placeholderTyped !== '') placeholderTyped = '';
  });
  timer = setTimeout(tick, 400);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
});

let showSlashPanel = $derived(
  (showSlashButton || shortcuts.length > 0) &&
    (shortcutsOpen || (focused && (value.trim() === '/' || value.trim().startsWith('/'))))
);

let filteredShortcuts = $derived.by(() => {
  if (!shortcuts.length) return [];
  const q = value.trim().toLowerCase();
  if (!q || q === '/') return shortcuts;
  const needle = q.startsWith('/') ? q.slice(1) : q;
  return shortcuts.filter(
    (s: SearchShortcut) =>
      s.prefix.toLowerCase().includes(needle) || s.label.toLowerCase().includes(needle)
  );
});

function handleInput(e: Event) {
  const v = (e.currentTarget as HTMLInputElement).value;
  value = v;
  onChange(v);
  if (v.trim().startsWith('/')) shortcutsOpen = true;
  else if (!v.trim()) shortcutsOpen = false;
}

function handleFocus() {
  open = true;
  focused = true;
  onFocus();
  void refresh();
}

function handleBlur() {
  blurTimer = setTimeout(() => {
    open = false;
    focused = false;
    shortcutsOpen = false;
    onBlur();
  }, 180);
}

async function pick(item: string) {
  if (blurTimer) clearTimeout(blurTimer);
  value = item;
  onChange(item);
  open = false;
  shortcutsOpen = false;
  await pushSearchHistory(scope, item);
  await refresh();
  onSubmit(item);
}

async function removeItem(item: string, e: Event) {
  e.stopPropagation();
  e.preventDefault();
  history = await removeSearchHistoryItem(scope, item);
}

async function commit() {
  const q = value.trim();
  if (q) {
    await pushSearchHistory(scope, q);
    await refresh();
    onSubmit(q);
  }
  open = false;
  shortcutsOpen = false;
}

function applyShortcut(s: SearchShortcut) {
  if (blurTimer) clearTimeout(blurTimer);
  value = s.prefix === 'is:otp' ? 'is:otp ' : s.prefix;
  onChange(value);
  shortcutsOpen = false;
  inputEl?.focus();
}

const displayPlaceholder = $derived(value?.trim() ? '' : placeholderTyped || placeholder);
</script>

<div class="flex items-center gap-1 w-full min-w-0">
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
        {#if prefixContent}
          {@render prefixContent()}
        {/if}
        <input
          id={inputId}
          bind:this={inputEl}
          type="text"
          inputmode="search"
          enterkeyhint="search"
          class="{SETTINGS_SEARCH_INPUT_CLASS} search-no-native-clear"
          placeholder={displayPlaceholder}
          aria-label={ariaLabel}
          value={value}
          oninput={handleInput}
          onfocus={handleFocus}
          onblur={handleBlur}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            } else if (e.key === 'Escape') {
              open = false;
              shortcutsOpen = false;
            }
          }}
          autocomplete="off"
        />
        <div class="absolute end-1.5 top-1/2 -translate-y-1/2 z-[1] flex items-center gap-0.5">
          {#if value}
            <button
              type="button"
              class="w-6 h-6 flex items-center justify-center rounded-lg text-md-on-surface/40 hover:text-md-on-surface"
              aria-label={$t('common.clear') || $t('common.close')}
              onclick={() => {
                value = '';
                onChange('');
              }}
            >
              <Icon name="x" class="w-3.5 h-3.5" />
            </button>
          {/if}
          {#if showSlashButton || shortcuts.length > 0}
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-lg text-sm font-bold font-mono transition-colors {showSlashPanel
                ? 'text-md-primary bg-md-primary/10'
                : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-variant'}"
              aria-label={$t('inbox.searchShortcutsButton')}
              title={$t('inbox.searchShortcutsButton')}
              onmousedown={(e) => {
                e.preventDefault();
                shortcutsOpen = !shortcutsOpen;
                open = true;
                focused = true;
                inputEl?.focus();
              }}
            >
              /
            </button>
          {/if}
          {#if showMic}
            <button
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-lg transition-colors
                {listening
                  ? 'text-md-error bg-md-error/15'
                  : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-variant'}"
              aria-label={listening ? $t('common.stopListening') : $t('common.voiceSearch')}
              title={listening ? $t('common.stopListening') : $t('common.voiceSearch')}
              aria-pressed={listening}
              onmousedown={(e) => {
                e.preventDefault();
                startVoiceSearch();
              }}
            >
              <Icon name="mic" class="w-3.5 h-3.5 {listening ? 'animate-pulse' : ''}" />
            </button>
          {/if}
          {#if trailing}
            {@render trailing()}
          {/if}
        </div>
      </div>
    {:else}
      <input
        bind:this={inputEl}
        type="text"
        inputmode="search"
        enterkeyhint="search"
        class="{inputClass ||
          'w-full bg-md-surface-container-low border border-md-outline-variant/40 focus:border-md-outline rounded-lg px-3 py-1.5 text-sm outline-none placeholder:text-md-on-surface/40'} search-no-native-clear"
        placeholder={displayPlaceholder}
        aria-label={ariaLabel}
        value={value}
        oninput={handleInput}
        onfocus={handleFocus}
        onblur={handleBlur}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            open = false;
          }
        }}
        autocomplete="off"
      />
    {/if}

    <!-- Focused empty: history chips only -->
    {#if open && focused && !showSlashPanel && !value.trim() && history.length > 0}
      <div
        class="absolute inset-x-0 top-full mt-1 z-[300] bg-md-surface-container-high rounded-xl border border-md-outline-variant/40 shadow-lg p-2 max-h-40 overflow-y-auto"
        role="listbox"
        aria-label={$t('searchHistory.recent')}
      >
        <div class="px-1 pb-1.5 text-xs font-semibold uppercase tracking-wide text-md-on-surface/45">
          {$t('searchHistory.recent')}
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#each history as item (item)}
            <div
              class="inline-flex items-center gap-0.5 max-w-full ps-2.5 pe-1 py-0.5 rounded-full text-xs font-medium bg-md-surface border border-md-outline-variant/40 text-md-on-surface"
              role="option"
              aria-selected="false"
            >
              <button
                type="button"
                class="inline-flex items-center gap-1 min-w-0 border-0 bg-transparent p-0 text-inherit font-inherit cursor-pointer hover:text-md-primary"
                onclick={() => void pick(item)}
              >
                <Icon name="clock" class="w-3 h-3 opacity-50 shrink-0" />
                <span class="truncate max-w-[10rem]">{item}</span>
              </button>
              <button
                type="button"
                class="w-5 h-5 flex items-center justify-center rounded-full text-md-on-surface/40 hover:text-md-error border-0 bg-transparent p-0"
                aria-label={$t('searchHistory.remove')}
                onclick={(e) => void removeItem(item, e)}
              >
                <Icon name="x" class="w-3 h-3" />
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- / shortcuts -->
    {#if showSlashPanel && filteredShortcuts.length > 0}
      <div
        class="absolute inset-x-0 top-full mt-1 z-[300] bg-md-surface rounded-xl border border-md-outline-variant/40 shadow-lg p-1.5 max-h-56 overflow-y-auto"
        role="listbox"
      >
        <div class="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-md-on-surface/45">
          {$t('inbox.searchShortcut.sectionTitle')}
        </div>
        {#each filteredShortcuts as s (s.prefix)}
          <button
            type="button"
            class="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-start hover:bg-md-primary/10"
            onmousedown={(e) => {
              e.preventDefault();
              applyShortcut(s);
            }}
          >
            <span class="text-sm font-mono font-semibold text-md-primary">{s.label}</span>
            <span class="text-xs text-md-on-surface/55 text-end">{s.description}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if filterControl}
    <div class="shrink-0">
      {@render filterControl()}
    </div>
  {/if}
</div>

<style>
  /* Hide WebKit/Blink native search clear (we render our own) */
  :global(.search-no-native-clear::-webkit-search-cancel-button),
  :global(.search-no-native-clear::-webkit-search-decoration) {
    -webkit-appearance: none;
    appearance: none;
    display: none;
  }
</style>
