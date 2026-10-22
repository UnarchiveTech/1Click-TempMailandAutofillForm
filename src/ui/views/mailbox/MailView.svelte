<script lang="ts">
import { onDestroy, onMount, tick, untrack } from 'svelte';
import { get } from 'svelte/store';
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { generateSingleEMLContent } from '@/features/address/inbox-export.js';
import {
  DEFAULT_TOOLBAR_BUTTON_VISIBILITY,
  parseToolbarButtonVisibility,
} from '@/features/settings/toolbar-visibility.js';
import { isDarkThemeActive } from '@/features/theme/theme-actions.js';
import MessageCodeBadges from '@/ui/blocks/mail/MessageCodeBadges.svelte';
import MessageUnsubscribeBadge from '@/ui/blocks/mail/MessageUnsubscribeBadge.svelte';
import CopyButton from '@/ui/components/composites/CopyButton.svelte';
import EmailBody from '@/ui/components/composites/EmailBody.svelte';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import ModalDialog from '@/ui/components/composites/ModalDialog.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import Badge from '@/ui/components/primitives/Badge.svelte';
import Btn from '@/ui/components/primitives/Btn.svelte';
import FaviconImage from '@/ui/components/primitives/FaviconImage.svelte';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import {
  DETAIL_TOOLBAR_STRIP,
  DETAIL_TOOLBAR_TONE_ACCENT,
  DETAIL_TOOLBAR_TONE_DANGER,
  DETAIL_TOOLBAR_TONE_NEUTRAL,
  detailToolbarBtnClass,
} from '@/ui/detail-toolbar.js';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard/clipboard.js';
import type { EmailLabelDef } from '@/utils/email/email-label-catalog.js';
import {
  getEmailLabelCatalog,
  hashLabelColor,
  labelColorFor,
  mergeLabelsIntoCatalog,
  setEmailLabelCatalog,
} from '@/utils/email/email-label-catalog.js';
import { emailLabelKeyForEmail } from '@/utils/email/email-label-key.js';
import {
  type EmailLink,
  isSocialMediaLink,
  linkifyHtmlBareUrls,
  splitEmailLinks,
} from '@/utils/email/email-links.js';
import { isEmailStarred, toggleStarInSet } from '@/utils/email/email-star-key.js';
import { parseAnchors } from '@/utils/email/html-scan.js';
import { buildEmailPrintHtml, printHtmlDocument } from '@/utils/email/print-email.js';
import { escapeHtmlText, initSanitize, sanitizeHtml } from '@/utils/email/sanitize-html.js';
import { logError } from '@/utils/logger.js';
import { emailLabelsStore } from '@/utils/storage/email-labels-store.js';
import { parseStringList, updateStoredObject } from '@/utils/storage/rmw.js';
import { getStoredEmailsForAddress } from '@/utils/storage/storage-keys.js';
import { avatarInitial } from '@/utils/theme/avatar-initials.js';
import { hexToRgba } from '@/utils/theme/color-utils.js';
import { toMs } from '@/utils/time/time.js';
import { formatFullDateTime, timeAgo } from '@/utils/time/time-format.js';
import type { Address, Email } from '@/utils/types.js';
import { AVATAR_BOX } from '@/utils/ui/avatar-size.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import { observeResizeOnFrame } from '@/utils/ui/resize-observer.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';

let {
  onBack = () => {},
  selectedThread = [],
  onMarkUnread = () => {},
  onArchive = () => {},
  onDelete = () => {},
  hasPrev = false,
  hasNext = false,
  onPrev = () => {},
  onNext = () => {},
  onCreateRule = (_from = '') => {},
  mailboxAddress = '',
  messageScrollKey = '',
  scrollTop = 0,
  onScrollTopChange = () => {},
  /** When true (split view), toolbar buttons show icon + text label */
  showToolbarLabels = false,
  context = 'app',
  showToast = (_msg: string) => {},
  onSearchText = (_text: string) => {},
  onManageLabels = () => {},
}: {
  onBack?: () => void;
  selectedThread?: Email[];
  onMarkUnread?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  /** Called with the current message's sender address when the user taps “Create rule”. */
  onCreateRule?: (from?: string) => void;
  mailboxAddress?: string;
  messageScrollKey?: string;
  scrollTop?: number;
  onScrollTopChange?: (key: string, scrollTop: number) => void;
  showToolbarLabels?: boolean;
  context?: 'popup' | 'sidepanel' | 'app';
  showToast?: (msg: string, type?: 'error' | 'success' | 'warning' | 'info') => void;
  onSearchText?: (text: string) => void;
  onManageLabels?: () => void;
} = $props();

// The message action buttons target the latest message in the thread.
let currentMessage = $derived(selectedThread.length > 0 ? selectedThread[0] : null);
let messageBody = $state<HTMLElement | null>(null);
// The split pane keys this instance by tab. Capture its owner before teardown
// so a new tab's reactive props cannot receive the outgoing tab's scroll.
const mountedScrollKey = untrack(() => messageScrollKey);
const mountedScrollTop = untrack(() => scrollTop);
let scrollReady = false;
$effect(() => {
  const node = messageBody;
  const position = mountedScrollTop;
  if (!node || !mountedScrollKey) return;
  let disposed = false;
  let frame = 0;
  void tick().then(() => {
    if (disposed) return;
    // EmailBody populates its shadow root after mounting. Restore after that
    // layout, when the reader has its full height, rather than clamping against
    // the initially empty body.
    frame = requestAnimationFrame(() => {
      if (disposed) return;
      node.scrollTop = position;
      scrollReady = true;
    });
  });
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
  };
});
let isThread = $derived(selectedThread.length > 1);

let bodiesById = $state<Record<string, string>>({});
let emailLabelsMap = $state<Record<string, string[]>>({});
let labelCatalog = $state<EmailLabelDef[]>([]);

const labelColor = (name: string) => labelColorFor(labelCatalog, name);

async function loadLabelCatalog() {
  try {
    labelCatalog = await getEmailLabelCatalog();
  } catch {
    labelCatalog = [];
  }
}
/** All extracted http(s) links per message id (deduped, first-seen order). */
let classifiedLinksById = $derived.by(() => {
  const map: Record<string, ReturnType<typeof splitEmailLinks>> = {};
  for (const msg of selectedThread) {
    map[msg.id] = splitEmailLinks(msg);
  }
  return map;
});
let linksById = $derived(
  Object.fromEntries(Object.entries(classifiedLinksById).map(([id, value]) => [id, value.links]))
);
let mediaById = $derived(
  Object.fromEntries(Object.entries(classifiedLinksById).map(([id, value]) => [id, value.media]))
);
/** Rank destination domains by how many links each message sends to them. */
let currentMessageLinkDomains = $derived.by(() => {
  if (!currentMessage) return [] as Array<{ host: string; count: number }>;
  const counts = new Map<string, number>();
  for (const link of linksById[currentMessage.id] ?? []) {
    counts.set(link.host, (counts.get(link.host) ?? 0) + 1);
  }
  return Array.from(counts, ([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count);
});
let linksDialogMessageId = $state<string | null>(null);
let linksDialogIsMedia = $state(false);
let linksDialogMessage = $derived(
  selectedThread.find((message: Email) => message.id === linksDialogMessageId) ?? null
);
let linksDialogLinks = $derived(
  linksDialogMessage
    ? ((linksDialogIsMedia ? mediaById : linksById)[linksDialogMessage.id] ?? [])
    : []
);
const linksDialogGroups = $derived(
  linksDialogIsMedia
    ? [{ title: $t('inbox.mediaLinks'), links: linksDialogLinks }]
    : [
        {
          title: $t('inbox.websiteLinks'),
          links: linksDialogLinks.filter((link) => !isSocialMediaLink(link)),
        },
        { title: $t('inbox.socialMediaLinks'), links: linksDialogLinks.filter(isSocialMediaLink) },
      ].filter((group) => group.links.length > 0)
);
let perMessageImagesLoaded = $state<Set<string>>(new Set());
let labelDialogOpen = $state(false);
let labelDialogInput = $state('');
let labelDialogColor = $state('#6750a4');
let labelSaveBusy = $state(false);
/** False until the user edits the picker, so it can track the first new label. */
let labelDialogColorTouched = $state(false);

/** Labels typed in the dialog that are not yet in the catalog (drive the color picker). */
let dialogNewLabels = $derived.by(() => {
  if (!labelDialogOpen) return [] as string[];
  const known = new Set(labelCatalog.map((d) => d.name.toLowerCase()));
  return Array.from(
    new Set(
      labelDialogInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ).filter((name) => !known.has(name.toLowerCase()));
});

// Default the picker to the first new label's hash color until the user
// chooses their own, so new labels are distinct without any extra clicks.
$effect(() => {
  const firstNew = dialogNewLabels[0];
  if (firstNew && !labelDialogColorTouched) {
    labelDialogColor = hashLabelColor(firstNew);
  }
});
let downloadDialogOpen = $state(false);
let starredEmailIds = $state<Set<string>>(new Set());
let starBusy = $state(false);
let detailToolbarEl = $state<HTMLElement | null>(null);
let detailToolbarHeightPx = $state(0);

$effect(() => {
  const el = detailToolbarEl;
  if (!el || typeof ResizeObserver === 'undefined') {
    detailToolbarHeightPx = 0;
    return;
  }
  return observeResizeOnFrame(el, (entries) => {
    for (const entry of entries) {
      detailToolbarHeightPx = Math.ceil(entry.target.getBoundingClientRect().height);
    }
  });
});

let currentEmailLabels = $derived(
  currentMessage ? emailLabelsMap[emailLabelKeyForEmail(currentMessage, mailboxAddress)] || [] : []
);
let isStarred = $derived(
  currentMessage
    ? isEmailStarred(
        starredEmailIds,
        currentMessage.id,
        currentMessage.original_inbox || mailboxAddress
      )
    : false
);

let selectedText = $state('');
let selectionPopupPos = $state<{ x: number; y: number } | null>(null);

function handleSelectionChange() {
  if (typeof window === 'undefined') return;
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (text.length > 0 && text.length < 500) {
    selectedText = text;
    try {
      const range = sel?.getRangeAt(0);
      if (!range) return;
      const rect = range.getBoundingClientRect();
      if (rect.width > 0) {
        selectionPopupPos = {
          x: Math.max(16, rect.left + rect.width / 2),
          y: Math.max(40, rect.top - 36),
        };
        return;
      }
    } catch {
      /* ignore */
    }
  }
  selectedText = '';
  selectionPopupPos = null;
}
let bestMagicLink = $derived(
  currentMessage?.magicLinks && currentMessage.magicLinks.length > 0
    ? currentMessage.magicLinks[0]
    : null
);
let verificationExpanded = $state(true);
/** Per-sender counts for the hover tooltip (UX item #3): here = current mailbox, other = all other mailboxes. */
let senderHereCount = $state(0);
let senderOtherCount = $state(0);
let senderStatsGeneration = 0;

async function refreshSenderStats(msg: Email | null, addr: string): Promise<void> {
  const generation = ++senderStatsGeneration;
  const sender = msg?.from;
  if (!sender) {
    senderHereCount = 0;
    senderOtherCount = 0;
    return;
  }
  try {
    const currentMessages = await getStoredEmailsForAddress(undefined, addr);
    if (generation !== senderStatsGeneration) return;
    senderHereCount = currentMessages.filter((m) => m?.from === sender).length;
    // Sender counts outside the active mailbox intentionally remain unavailable
    // here; loading every mailbox would defeat active-mailbox performance.
    senderOtherCount = 0;
  } catch {
    /* ignore */
    if (generation !== senderStatsGeneration) return;
    senderHereCount = 0;
    senderOtherCount = 0;
  }
}

onDestroy(() => {
  senderStatsGeneration += 1;
});

// Recompute when the displayed message or mailbox changes. Read the tracked
// deriveds synchronously so the effect re-runs, then hand off to the async fetch.
$effect(() => {
  void refreshSenderStats(currentMessage, mailboxAddress);
});

/** Only allow http(s) download URLs - reject javascript:, data:, blob:, and malformed strings. */
function safeDownloadHref(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') return raw;
  } catch {
    /* drop */
  }
  return undefined;
}

async function openMagicLink(url: string, sourceMessage = currentMessage) {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      logError('Magic link blocked: unsupported protocol', { url: url.slice(0, 100) });
      return;
    }
    const stored = await browser.storage.local.get('addresses');
    const addressId = (stored.addresses as Address[] | undefined)?.find(
      (a) =>
        a.address.toLowerCase() === (sourceMessage?.original_inbox || mailboxAddress).toLowerCase()
    )?.id;
    const response = await browser.runtime.sendMessage({
      type: 'openSignupVerificationLink',
      url: parsed.toString(),
      addressId,
    });
    if (!response?.success) throw new Error('operation-failed');
  } catch (err) {
    logError(
      'Failed to open magic link',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
    showToast($t('toasts.operationFailed'), 'error');
  }
}

async function openMessageLink(url: string) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid-link');
    // Recognized verification links retain signup-progress tracking. All other
    // destinations are ordinary navigation, not verification assertions.
    const message = linksDialogMessage;
    if (!linksDialogIsMedia && message?.magicLinks?.some((link) => link.url === url)) {
      await openMagicLink(url, message);
    } else {
      await browser.tabs.create({ url: parsed.href });
    }
  } catch (error) {
    logError('Failed to open message link', error);
    showToast($t('toasts.operationFailed'), 'error');
  }
}

async function copyMagicLink(url: string) {
  try {
    const ok = await copyToClipboardAndSchedulePurge(url);
    showToast?.(get(t)(ok ? 'inbox.copyMagicLink' : 'inbox.copyFailed') as string);
  } catch (err) {
    logError(
      'Failed to copy magic link',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
  }
}

async function copyOtpFromMessage(otp: string | null | undefined) {
  if (!otp) return;
  try {
    const ok = await copyToClipboardAndSchedulePurge(otp);
    showToast?.(get(t)(ok ? 'inbox.otpCopied' : 'inbox.copyFailed') as string);
  } catch (err) {
    logError(
      'Failed to copy OTP from message',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
    showToast?.(get(t)('inbox.copyFailed') as string);
  }
}

/** Copy every link in a message (one per line) for quick sharing. */
async function copyAllLinks(links: EmailLink[]) {
  const text = links.map((l) => l.url).join('\n');
  try {
    await copyToClipboardAndSchedulePurge(text);
    showToast?.(get(t)('inbox.linksCopiedAll', { values: { n: links.length } }) as string);
  } catch (err) {
    logError(
      'Failed to copy all links',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
    showToast?.(get(t)('inbox.linksCopyFailed') as string);
  }
}

/** Contextual copy for subject & sender */
async function copySubject() {
  if (!currentMessage?.subject) return;
  try {
    await copyToClipboardAndSchedulePurge(currentMessage.subject);
    showToast?.(
      get(t)('inbox.subjectCopiedText', { values: { subject: currentMessage.subject } }) as string
    );
  } catch (err) {
    logError(
      'Failed to copy subject',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
  }
}

async function copySender() {
  if (!currentMessage?.from) return;
  try {
    await copyToClipboardAndSchedulePurge(currentMessage.from);
    showToast?.(
      get(t)('inbox.senderEmailCopiedText', { values: { email: currentMessage.from } }) as string
    );
  } catch (err) {
    logError(
      'Failed to copy sender',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
  }
}

function printEmail() {
  if (!currentMessage) return;
  // Popup / sidepanel cannot keep a print dialog alive (the popup closes the
  // moment the dialog steals focus, and panels have no reliable print support) -
  // open the full app page, which prints in its own user gesture.
  if (context !== 'app') {
    void openAppForPrint();
    return;
  }
  const rawBody =
    bodiesById[currentMessage.id] || currentMessage.body_html || currentMessage.body || '';
  const bodyContent = sanitizeHtml(rawBody);
  const html = buildEmailPrintHtml(currentMessage, bodyContent);
  printHtmlDocument(html, currentMessage.subject || get(t)('activity.noSubject'));
}

/** Open the full app page with a print intent for the current message. */
async function openAppForPrint() {
  if (!currentMessage) return;
  const runtime = browser.runtime as unknown as { getURL?: (p: string) => string };
  const appUrl = typeof runtime.getURL === 'function' ? runtime.getURL('/app.html') : '/app.html';
  const qs = new URLSearchParams({
    printInbox: currentMessage.original_inbox || mailboxAddress,
    printEmail: currentMessage.id,
  });
  const fullUrl = `${appUrl}?${qs.toString()}`;
  // Open with window.open INSIDE this click gesture: the newly opened tab then
  // has the best chance of carrying the user activation the app tab's print()
  // call needs to show a dialog (browser.tabs.create goes through the
  // background and never inherits a gesture). Fall back to tabs.create if the
  // opener was blocked.
  let opened = false;
  try {
    opened = !!window.open(fullUrl, '_blank');
  } catch {
    opened = false;
  }
  if (!opened) {
    try {
      await browser.tabs.create({ url: fullUrl });
      opened = true;
    } catch (error) {
      logError(
        'Failed to open app for printing',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
      showToast?.(get(t)('inbox.printOpenFailed') as string);
      return;
    }
  }
  // Only the sidepanel stays visible after the new tab steals focus - the
  // popup closes immediately, so a toast there would never be seen.
  if (opened && context === 'sidepanel') {
    showToast?.(get(t)('inbox.printOpenedApp') as string);
  }
}

function downloadAsMarkdown() {
  if (!currentMessage) return;
  const subject = currentMessage.subject || get(t)('activity.noSubject');
  const from = currentMessage.from || currentMessage.from_name || get(t)('activity.unknownSender');
  const dateStr =
    currentMessage.time ||
    new Date(toMs(currentMessage.received_at)).toLocaleString($locale || 'en');
  const rawHtml = currentMessage.body_html || currentMessage.body || '';

  let markdown = `# ${subject}\n\n- **${get(t)('activity.fromLabel')}:** ${from}\n- **${get(t)('activity.dateLabel')}:** ${dateStr}\n- **ID:** ${currentMessage.id}\n\n---\n\n`;
  markdown += convertHtmlToMarkdown(rawHtml || currentMessage.body || '');

  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const slug =
    subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'email';
  a.download = `${slug}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast?.(get(t)('inbox.markdownExported') as string);
}

/**
 * Rewrite `<a href="…">label</a>` as `[label](href)` in one LINEAR pass.
 *
 * This used to be `/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi`, which is
 * cubic on a body of unterminated `<a` tags: measured 7.6 s for an 18 KB body
 * (`'<a href="'.repeat(2000)`), inside an export the user can trigger on an
 * attacker-controlled message. `parseAnchors` binds each tag with a
 * quote-aware scan first, so the cost is linear. An anchor without an href is
 * left as markup (the trailing `<[^>]*>` strip removes its tags), exactly as
 * the old regex left it.
 */
function replaceAnchorsWithMarkdown(html: string): string {
  const anchors = parseAnchors(html);
  if (anchors.length === 0) return html;
  let out = '';
  let cursor = 0;
  for (const anchor of anchors) {
    out += html.slice(cursor, anchor.start);
    out += anchor.hasHref
      ? `[${anchor.innerHtml}](${anchor.href})`
      : html.slice(anchor.start, anchor.end);
    cursor = anchor.end;
  }
  return out + html.slice(cursor);
}

function convertHtmlToMarkdown(html: string): string {
  if (!html) return '';
  let text = html;
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  text = replaceAnchorsWithMarkdown(text);
  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)');
  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)');
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  text = text.replace(/<[^>]*>/g, '');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.trim();
}

onMount(async () => {
  await initSanitize();
  void sanitizeAll();
});

let showImages = $state(true);

function rawContentHasImages(msg: Email): boolean {
  const rawHtml = msg.body_html || '';
  const rawText = msg.body || msg.body_plain || '';
  const isHtmlText = !rawHtml && /<[a-z][\s\S]*>/i.test(rawText);
  const content = rawHtml || (isHtmlText ? rawText : '');
  return /<img[\s>]/i.test(content) || /res\.php\?r=1/i.test(content);
}

function shouldShowLoadImagesChip(msg: Email): boolean {
  if (showImages || perMessageImagesLoaded.has(msg.id)) return false;
  return rawContentHasImages(msg);
}

function loadImagesForMessage(msgId: string) {
  perMessageImagesLoaded = new Set([...perMessageImagesLoaded, msgId]);
  void sanitizeAll();
}

async function loadShowImages() {
  try {
    const { showImages: val } = (await browser.storage.local.get(['showImages'])) as {
      showImages?: boolean;
    };
    showImages = val !== false;
  } catch {
    /* ignore */
    showImages = true;
  }
}

let toolbarVisibility = $state({ ...DEFAULT_TOOLBAR_BUTTON_VISIBILITY });
let toolbarVisibilityRevision = 0;

async function loadToolbarVisibility() {
  const revision = toolbarVisibilityRevision;
  try {
    const stored = await browser.storage.local.get(['toolbarButtonVisibility']);
    if (revision === toolbarVisibilityRevision) {
      toolbarVisibility = parseToolbarButtonVisibility(stored.toolbarButtonVisibility);
    }
  } catch (error) {
    logError('Failed to load message toolbar visibility', error);
  }
}

onMount(() => {
  void loadToolbarVisibility();
  void loadShowImages();
  void loadStarred();
  void loadLabelCatalog();
  const unsubLabels = emailLabelsStore.subscribe((map) => {
    emailLabelsMap = map;
  });
  document.addEventListener('selectionchange', handleSelectionChange);
  const handleStorageChange = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;
    if (changes.toolbarButtonVisibility) {
      toolbarVisibilityRevision += 1;
      toolbarVisibility = parseToolbarButtonVisibility(changes.toolbarButtonVisibility.newValue);
    }
    if (changes.showImages) {
      showImages = changes.showImages.newValue !== false;
      void sanitizeAll();
    }
    if (changes.htmlRenderingSettings) {
      // This view's listener may run before the sanitizer's cache listener.
      // Reload first so the current body never reuses the replaced flags.
      void initSanitize()
        .then(sanitizeAll)
        .catch((error) => {
          logError('Failed to refresh email rendering settings', error);
        });
    }
    if (changes.starredEmails) void loadStarred();
    if (changes.emailLabelCatalog) void loadLabelCatalog();
  };

  // Re-sanitize when the resolved theme flips (covers both the settings toggle
  // and `system` mode following the OS). Sanitized bodies bake in the dark-mode
  // neutralization, so switching themes must re-derive them from the raw HTML.
  const themeObserver =
    typeof MutationObserver !== 'undefined' ? new MutationObserver(() => void sanitizeAll()) : null;
  themeObserver?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  browser.storage.onChanged.addListener(handleStorageChange);
  // Return the teardown from onMount - a nested onDestroy is ignored by
  // Svelte 5 (lifecycle functions must be called during component init), so
  // these listeners/subscriptions would leak on every unmount. The
  // selectionchange listener is also removed here (it was previously never
  // cleaned up at all).
  return () => {
    toolbarVisibilityRevision += 1;
    unsubLabels();
    themeObserver?.disconnect();
    document.removeEventListener('selectionchange', handleSelectionChange);
    browser.storage.onChanged.removeListener(handleStorageChange);
  };
});

$effect(() => {
  if (selectedThread.length > 0) {
    void sanitizeAll();
  }
});

function formatPlainTextEmail(text: string): string {
  if (!text) return '';
  const escaped = escapeHtmlText(text);
  const linked = escaped.replace(
    /(https?:\/\/[^\s<>'"]+)/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-md-primary underline font-medium">$1</a>'
  );
  return `<div class="plain-text-email" style="white-space: pre-wrap; word-break: break-word; font-family: inherit; line-height: 1.6; font-size: 0.875rem;">${linked}</div>`;
}

function sanitizeAll() {
  const next: Record<string, string> = {};
  for (const msg of selectedThread) {
    const rawHtml = msg.body_html || '';
    const rawText = msg.body || msg.body_plain || '';

    // Check if rawText contains HTML tags even if body_html was not set
    const isHtmlText = !rawHtml && /<[a-z][\s\S]*>/i.test(rawText);
    const contentToSanitize = rawHtml || (isHtmlText ? rawText : '');

    if (contentToSanitize) {
      const allowImages = showImages || perMessageImagesLoaded.has(msg.id);
      const sanitized = sanitizeHtml(contentToSanitize, {
        allowImages,
        // EmailBody renders into an OPEN shadow DOM, so sanitized <style>
        // blocks (safe CSS subset - layout/@media only) are scoped there and
        // can never restyle the app. Kept so responsive email styling works.
        allowStyleBlocks: true,
        // Neutralize hardcoded light backgrounds / dark text on dark themes so
        // emails stay readable; layout and the email's own colors are kept.
        darkMode: isDarkThemeActive(),
      });
      // Linkify bare http(s) URLs that the sender didn't wrap in an <a> tag so
      // they're clickable and visibly marked in the rendered body. Safe: only
      // http(s), hardcoded target/rel, applied AFTER sanitization.
      next[msg.id] = linkifyHtmlBareUrls(sanitized);
    } else {
      next[msg.id] = formatPlainTextEmail(rawText);
    }
  }
  bodiesById = next;
}

async function loadStarred() {
  const result = (await browser.storage.local.get(['starredEmails'])) as {
    starredEmails?: string[];
  };
  starredEmailIds = new Set(result.starredEmails || []);
}

async function toggleStar() {
  if (!currentMessage?.id || starBusy) return;
  starBusy = true;
  try {
    const addr = currentMessage.original_inbox || mailboxAddress;
    // Serialized RMW: base the toggle on the last landed write for the key so
    // a concurrent star change survives instead of being clobbered. The updater
    // returns the ARRAY stored shape (parse is array-shaped).
    const updated = new Set(
      await updateStoredObject<string[]>(
        'starredEmails',
        (current) => Array.from(toggleStarInSet(new Set(current), currentMessage.id, addr)),
        parseStringList
      )
    );
    starredEmailIds = updated;
  } catch (e) {
    logError('toggleStar failed', e);
    await loadStarred();
  } finally {
    starBusy = false;
  }
}

async function saveEmailLabelsToStorage(nextMap: Record<string, string[]> = emailLabelsMap) {
  const snapshot = $state.snapshot(nextMap) as Record<string, string[]>;
  await emailLabelsStore.replaceMap(snapshot);
}

function openLabelDialog() {
  if (!currentMessage) return;
  labelDialogInput = currentEmailLabels.join(', ');
  labelDialogColor = '#6750a4';
  labelDialogColorTouched = false;
  labelDialogOpen = true;
}

function closeLabelDialog() {
  labelDialogOpen = false;
  labelDialogInput = '';
  labelDialogColor = '#6750a4';
  labelDialogColorTouched = false;
}

async function saveEmailLabels() {
  if (!currentMessage || labelSaveBusy) return;
  labelSaveBusy = true;
  const labels = Array.from(
    new Set(
      labelDialogInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );
  const newMap: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(emailLabelsMap)) {
    if (Array.isArray(v)) newMap[k] = v.slice();
  }
  const labelKey = emailLabelKeyForEmail(currentMessage, mailboxAddress);
  if (labels.length === 0) {
    delete newMap[labelKey];
  } else {
    newMap[labelKey] = labels.slice();
  }
  const previousCatalog = labelCatalog;
  let catalogWritten = false;
  try {
    // Save the catalog first so a failed assignment cannot leave a new label
    // color looking saved only in this view. If the assignment then fails,
    // restore the catalog snapshot as a best-effort compensation.
    if (labels.length > 0) {
      const defs = mergeLabelsIntoCatalog(previousCatalog, labels);
      if (defs.length !== previousCatalog.length) {
        const known = new Set(previousCatalog.map((d) => d.name.toLowerCase()));
        const withColor = defs.map((d) =>
          known.has(d.name.toLowerCase()) ? d : { ...d, color: labelDialogColor }
        );
        await setEmailLabelCatalog(withColor);
        catalogWritten = true;
        labelCatalog = withColor;
      }
    }

    await saveEmailLabelsToStorage(newMap);
    // The store publishes its new map only after storage confirms the write.
    emailLabelsMap = newMap;
    closeLabelDialog();
  } catch (error) {
    logError('saveEmailLabels failed', error);
    if (catalogWritten) {
      try {
        await setEmailLabelCatalog(previousCatalog);
      } catch (rollbackError) {
        logError('saveEmailLabels: failed to roll back label catalog', rollbackError);
      }
      labelCatalog = previousCatalog;
    }
    showToast?.(get(t)('toasts.operationFailed') as string, 'error');
  } finally {
    labelSaveBusy = false;
  }
}

let allEmailLabels = $derived.by(() => {
  const set = new Set<string>();
  for (const labels of Object.values(emailLabelsMap)) {
    if (!Array.isArray(labels)) continue;
    for (const t of labels) set.add(t);
  }
  return Array.from(set).sort();
});

function _forwardMessage() {
  if (!currentMessage) return;

  const subject = encodeURIComponent(
    `${$t('inbox.emailActions.forwardSubjectPrefix')} ${currentMessage.subject || $t('notifications.noSubject')}`
  );
  const body = encodeURIComponent(
    `\n\n${$t('inbox.emailActions.forwardHeader')}\n` +
      `${$t('inbox.emailActions.forwardFromLabel')} ${currentMessage.from || $t('notifications.unknownSender')}\n` +
      `${$t('inbox.emailActions.forwardDateLabel')} ${currentMessage.time || $t('common.unknown')}\n` +
      `${$t('inbox.emailActions.forwardSubjectLabel')} ${currentMessage.subject || $t('notifications.noSubject')}\n\n` +
      `${currentMessage.body || $t('inbox.emailActions.forwardNoContent')}`
  );
  const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
  browser.tabs.create({ url: mailtoLink });
}

async function _downloadAsEML() {
  if (!currentMessage) return;

  try {
    const { activeAddressId, addresses = [] } = (await browser.storage.local.get([
      'activeAddressId',
      'addresses',
    ])) as {
      activeAddressId?: string;
      addresses?: Address[];
    };

    const currentAddress = addresses.find((record) => record.id === activeAddressId);
    if (!currentAddress) {
      logError('No current inbox found');
      return;
    }

    const emlContent = generateSingleEMLContent(currentAddress, currentMessage);
    const blob = new Blob([emlContent], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const subject = (currentMessage.subject || get(t)('activity.noSubject'))
      .replace(/[^a-zA-Z0-9\s]/g, '_')
      .substring(0, 50);
    a.download = `${subject}.eml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    logError(
      'Failed to download email as EML:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

const toolbarBtn = $derived(detailToolbarBtnClass(showToolbarLabels));
</script>

{#if currentMessage}
<div data-message-header class="sticky top-0 bg-md-surface z-10">
  <!-- Subject header -->
  <div class="bg-md-surface-container-low rounded-xl mx-0.5 mt-2 p-4" role="presentation" oncontextmenu={(e) => e.preventDefault()}>
      <div class="flex items-start justify-between gap-2">
        <div
          class="font-semibold text-base leading-snug cursor-pointer select-text min-w-0 line-clamp-2"
          role="button"
          tabindex="0"
          title={currentMessage.subject || $t('activity.noSubject')}
          ondblclick={copySubject}
          ontouchend={copySubject}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void copySubject(); } }}
        >{currentMessage.subject}</div>
        {#if toolbarVisibility.star}
        <button
          type="button"
          id="button-star-header"
          class="flex-shrink-0 w-8 h-8 -mt-0.5 flex items-center justify-center rounded-full transition-all active:scale-90 {isStarred ? 'text-md-tertiary hover:bg-md-secondary-container active:bg-md-secondary-container-pressed' : 'text-md-on-surface/35 hover:text-md-on-surface/70 hover:bg-md-surface-variant/60 active:bg-md-surface-variant/80'}"
          aria-label={$t('inbox.emailActions.star')}
          title={$t('inbox.emailActions.star')}
          aria-pressed={isStarred}
          onclick={(e) => {
            e.stopPropagation();
            void toggleStar();
          }}
        >
          <Icon name="star" class="w-5 h-5 shrink-0" filled={isStarred} />
        </button>
        {/if}
      </div>
      <div class="text-xs text-md-on-surface/60 mt-2 flex items-center gap-1.5">
        <div
          class="cursor-pointer select-text flex items-center gap-1.5"
          role="button"
          tabindex="0"
          title={$t('common.copy')}
          ondblclick={copySender}
          ontouchend={copySender}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void copySender(); } }}
        >
          {$t('activity.fromLabel')}:
          <FaviconImage
            email={currentMessage.from}
            size="sm"
            class="rounded-full"
            fallbackLetter={avatarInitial(currentMessage.from)}
          />
          <span title={$t('inbox.senderStatsTooltip', { values: { here: senderHereCount, other: senderOtherCount } })}>{currentMessage.from}</span></div>
        <div class="w-px h-3 bg-md-outline-variant/30"></div>
        <div class="text-md-on-surface/60 cursor-help" title={formatFullDateTime(currentMessage.received_at)}>{currentMessage.time}</div>
      </div>
      <!-- Status order is intentional: verification first, user labels second,
           and local/offline state last. This keeps security-relevant mail
           signals visible before organization metadata. -->
      <div class="flex flex-wrap items-center gap-1.5 mt-2.5">
        <MessageCodeBadges email={currentMessage} onCopyOtp={(code) => void copyOtpFromMessage(code)} />
        <MessageUnsubscribeBadge email={currentMessage} />
        {#if currentMessageLinkDomains.length > 0}
          <button
            type="button"
            class="inline-flex min-h-[24px] max-w-[16rem] shrink-0 cursor-pointer items-center gap-1 rounded-full bg-md-secondary-container px-2 py-0.5 text-xs font-semibold text-md-on-secondary-container transition-colors hover:bg-md-secondary-container/80 active:bg-md-secondary-container"
            aria-haspopup="dialog"
            aria-label={$t('inbox.linksInEmail', { values: { n: linksById[currentMessage.id].length } })}
            title={$t('inbox.linksInEmail', { values: { n: linksById[currentMessage.id].length } })}
            onclick={(e) => {
              e.stopPropagation();
              linksDialogMessageId = currentMessage.id;
              linksDialogIsMedia = false;
            }}
          >
            <span class="flex shrink-0 items-center -space-x-1">
              {#each currentMessageLinkDomains.slice(0, 3) as site (site.host)}
                <FaviconImage
                  domain={site.host}
                  size="xs"
                  class="rounded-full ring-1 ring-md-secondary-container"
                  fallbackLetter={(site.host[0] || '?').toUpperCase()}
                />
              {/each}
            </span>
            {#if currentMessageLinkDomains.length > 3}
              <span class="shrink-0 opacity-70">+{currentMessageLinkDomains.length - 3}</span>
            {/if}
            <span class="shrink-0 opacity-70">· {linksById[currentMessage.id].length}</span>
          </button>
        {/if}
        {#if (mediaById[currentMessage.id]?.length ?? 0) > 0}
          <Btn size="sm" variant="tonal" icon="image" aria-haspopup="dialog" onclick={() => { linksDialogMessageId = currentMessage.id; linksDialogIsMedia = true; }}>{$t('inbox.mediaLinks')}</Btn>
        {/if}
        {#if bestMagicLink}
          <Badge variant="success" size="sm" icon="link" label={$t('inbox.magicLinkDetected')} />
        {/if}
        {#each currentEmailLabels as label (label)}
          <Badge variant="tag" size="sm" icon="tag" label={label} customColor={labelColor(label)} />
        {/each}
        <button
          type="button"
          class="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full border border-dashed border-md-outline-variant text-md-on-surface/55 hover:border-md-primary hover:text-md-primary hover:bg-md-primary/10 active:bg-md-primary/30 transition-colors"
          title={$t('inbox.emailActions.addLabel')}
          aria-label={$t('inbox.emailActions.addLabel')}
          onclick={(e) => {
            e.stopPropagation();
            openLabelDialog();
          }}
        >
          <Icon name="add" class="w-3 h-3" />
          {$t('inbox.emailActions.addLabel')}
        </button>
        {#if currentMessage.local_only || (currentMessage.messageExpiresAt && currentMessage.messageExpiresAt <= Date.now())}
          {@const deletedWhen = (() => {
            const ts =
              currentMessage.local_only_since ||
              currentMessage.local_deleted_at ||
              currentMessage.stored_at ||
              toMs(currentMessage.received_at);
            return ts ? timeAgo(ts) : '';
          })()}
          <span
            class="cursor-help"
            data-tooltip={deletedWhen
              ? $t('inbox.deletedFromServerAgo', { values: { when: deletedWhen } })
              : $t('inbox.localOnlyTooltip')}
          >
            <Badge
              variant="neutral"
              size="sm"
              icon="cloudOff"
              label={$t('inbox.localOnlyBadge')}
            />
          </span>
        {/if}
      </div>
      {#if isThread}
        <div class="text-xs font-semibold text-md-primary/80 mt-2">
          {$t('inbox.messagesInThread', { values: { n: selectedThread.length } })}
        </div>
      {/if}
  </div>
</div>
{/if}

{#if selectedThread.length > 0}
<div class="relative flex-1 flex flex-col min-h-0">
  <div class="scroll-body flex-1 py-3 flex flex-col gap-3 overflow-y-auto pb-20" bind:this={messageBody} data-message-scroll data-message-scroll-key={mountedScrollKey} onscroll={() => { if (scrollReady && messageBody && mountedScrollKey) onScrollTopChange(mountedScrollKey, messageBody.scrollTop); }}>
    {#each selectedThread as msg, idx (msg.id)}
      <div class="bg-md-surface-container-low rounded-xl flex-shrink-0">
        {#if isThread}
          <div class="flex items-center justify-between px-3 pt-2">
            <div class="flex items-center gap-2">
              <FaviconImage
                email={msg.from}
                size="sm"
                class="rounded-full"
                fallbackLetter={avatarInitial(msg.from)}
              />
              <div class="text-xs font-semibold text-md-on-surface/60">
                {idx === 0 ? $t('inbox.latest') : `#${selectedThread.length - idx}`}
              </div>
            </div>
            <div class="text-xs text-md-on-surface/50 flex items-center gap-1.5">
              {#if idx > 0 && (msg.local_only || (msg.messageExpiresAt && msg.messageExpiresAt <= Date.now()))}
                <span
                  class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-md-tertiary-container text-md-on-tertiary-container cursor-help shrink-0"
                  data-tooltip={$t('inbox.localOnlyTooltip')}
                  aria-label={$t('inbox.localOnlyBadge')}
                ><Icon name="cloudOff" class="w-3 h-3" /></span>
              {/if}
              {msg.time}
            </div>
          </div>
        {/if}
        <div class="px-3 pb-3 pt-2">
          {#if isThread && msg.id !== currentMessage?.id}
            <MessageUnsubscribeBadge email={msg} />
          {/if}
          {#if isThread}
            <div class="text-xs text-md-on-surface/60 mb-1.5 flex items-center gap-1.5">
              <span class="font-semibold text-md-on-surface">{msg.from || msg.from_name || $t('activity.unknownSender')}</span>
            </div>
          {/if}
          {#if shouldShowLoadImagesChip(msg)}
            <button
              type="button"
              class="mb-2 inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full border border-md-outline-variant text-md-on-surface/70 hover:border-md-primary hover:text-md-primary hover:bg-md-primary/10 active:bg-md-primary/30 transition-colors"
              onclick={(e) => {
                e.stopPropagation();
                loadImagesForMessage(msg.id);
              }}
            >
              <Icon name="globe" class="w-3 h-3" />
              {$t('inbox.loadImagesForMessage')}
            </button>
          {/if}
          {#if Array.isArray(msg.attachments) && msg.attachments.length > 0}
            <div class="mb-2 space-y-1" aria-label={$t('inbox.attachments')}>
              <div class="text-label-sm text-md-on-surface/50">{$t('inbox.attachments')}</div>
              <div class="flex flex-wrap gap-1.5">
                {#each msg.attachments as att (att.filename || att.partNumber || att.mimeType)}
                  {#if safeDownloadHref(att.downloadUrl)}
                    <a
                      href={safeDownloadHref(att.downloadUrl)}
                      download={att.filename || true}
                      target="_blank"
                      rel="noreferrer"
                      class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container/80 active:bg-md-secondary-container/100 hover:text-md-primary transition-colors max-w-full"
                      title={att.filename || att.mimeType}
                    >
                      <Icon name="download" class="w-3 h-3 shrink-0" />
                      <span class="truncate">{att.filename || att.mimeType}</span>
                    </a>
                  {:else}
                    <span
                      class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-md-surface-variant/70 text-md-on-surface/60 border border-md-outline-variant/40 max-w-full cursor-help"
                      title={$t('inbox.attachmentsNoDownload')}
                    >
                      <Icon name="downloadForOffline" class="w-3 h-3 shrink-0" />
                      <span class="truncate">{att.filename || att.mimeType}</span>
                    </span>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
          <!-- Email body renders inside a Shadow DOM root for full style isolation;
               the sanitizer (sanitize-html) remains the security boundary. -->
          <EmailBody html={bodiesById[msg.id] || ''} />
          {#if linksById[msg.id] && linksById[msg.id].length > 0}
            {@const msgLinks = linksById[msg.id]}
            <button
              type="button"
              class="mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-md-outline-variant/30 text-label-sm font-semibold text-md-on-surface/70 hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 transition-colors"
              aria-haspopup="dialog"
              aria-label={$t('inbox.linksInEmail', { values: { n: msgLinks.length } })}
              onclick={(e) => {
                e.stopPropagation();
                linksDialogMessageId = msg.id;
                linksDialogIsMedia = false;
              }}
            >
              <Icon name="link" class="w-3.5 h-3.5 shrink-0 text-md-on-surface/50" />
              <span class="flex-1 min-w-0 truncate text-start">{$t('inbox.linksInEmail', { values: { n: msgLinks.length } })}</span>
              <Icon name="chevronRight" class="w-4 h-4 shrink-0 rtl-flip" />
            </button>
          {/if}
          {#if (mediaById[msg.id]?.length ?? 0) > 0}
            <Btn size="sm" variant="tonal" icon="image" aria-haspopup="dialog" onclick={() => { linksDialogMessageId = msg.id; linksDialogIsMedia = true; }}>{$t('inbox.mediaLinks')}</Btn>
          {/if}
          {#if isThread}
            {@const msgLabels = emailLabelsMap[emailLabelKeyForEmail(msg, mailboxAddress)] || []}
            {#if msgLabels.length}
              <div class="flex flex-wrap gap-1.5 mt-2">
                {#each msgLabels as label (label)}
                  <Badge variant="tag" size="sm" icon="tag" label={label} customColor={labelColor(label)} />
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
    <!-- Dynamic End-of-Page Spacer: allows content to flow behind floating nav & detail toolbar -->
    <div
      class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
      style="height: calc(var(--bottom-safe-area, 0px) + {detailToolbarHeightPx}px + 12px);"
      aria-hidden="true"
    ></div>
  </div>

  <!-- Unified verification strip: OTP and magic-link actions stay distinct while sharing one surface. -->
  {#if (currentMessage?.isOtp && currentMessage.otp) || bestMagicLink}
    <div
      id="verification-strip-detail"
      role="region"
      aria-label={$t('inbox.verificationTitle')}
      class="shrink-0 mx-0.5 mb-1 rounded-xl bg-md-surface-container-high {ELEVATION.level1} overflow-hidden"
    >
      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-md-outline-variant/20">
        <span class="flex-1 text-xs font-semibold text-md-on-surface/65">{$t('inbox.verificationTitle')}</span>
        <button
          type="button"
          class="w-6 h-6 flex items-center justify-center rounded-full hover:bg-md-surface-variant/60 active:bg-md-surface-variant/80"
          aria-label={verificationExpanded ? $t('inbox.collapseVerificationAria') : $t('inbox.expandVerificationAria')}
          title={verificationExpanded ? $t('inbox.collapseVerificationAria') : $t('inbox.expandVerificationAria')}
          onclick={(e) => { e.stopPropagation(); verificationExpanded = !verificationExpanded; }}
        >
          <Icon name={verificationExpanded ? 'chevronUp' : 'chevronDown'} class="w-3.5 h-3.5" />
        </button>
      </div>
      {#if verificationExpanded}
      <div class="px-2 pb-2 pt-1.5 space-y-1.5">
        {#if currentMessage?.isOtp && currentMessage.otp}
          <div
            id="button-otp-strip-detail"
            class="flex items-center gap-2 px-1.5 py-1.5 bg-md-secondary-container rounded-lg min-h-[52px]"
          >
            <div class="flex items-center gap-2 min-w-0">
              <div class="flex-shrink-0 {AVATAR_BOX.lg} rounded-full bg-md-surface flex items-center justify-center overflow-hidden">
                {#if currentMessage.from}
                  <FaviconImage
                    email={currentMessage.from}
                    size="lg"
                    fallbackLetter={(currentMessage.from[0] || '?').toUpperCase()}
                  />
                {/if}
              </div>
              <div class="min-w-0">
                <div class="text-xs font-bold text-md-on-secondary-container leading-tight truncate max-w-[100px]">
                  {currentMessage.from_name || currentMessage.from?.split('@')[0] || 'OTP'}
                </div>
                <div class="text-xs font-semibold text-md-on-secondary-container/65 leading-tight">
                  {$t('inbox.otpDetected')}
                </div>
              </div>
            </div>
            <div class="w-px h-7 bg-md-on-secondary-container/20 flex-shrink-0 mx-1"></div>
            <div class="flex-1 flex items-center justify-center min-w-0">
              <CopyButton
                text={currentMessage.otp}
                sensitive
                variant="primary"
                label={currentMessage.otp.replace(/\s/g, '')}
                tooltip={$t('inbox.copyOtpAria')}
                class="font-mono text-lg tracking-widest"
              />
            </div>
          </div>
        {/if}

        {#if bestMagicLink}
          <div
            id="button-magic-link-strip-detail"
            class="flex items-center gap-2 px-1.5 py-1.5 bg-md-tertiary-container rounded-lg min-h-[44px]"
          >
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <div class="flex-shrink-0 w-7 h-7 rounded-lg bg-md-surface flex items-center justify-center">
                <Icon name="globe" class="w-4 h-4 text-md-tertiary" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-xs font-semibold text-md-on-tertiary-container/65 leading-tight">
                  {$t('inbox.magicLinkDetected')}
                </div>
                <div class="text-label-sm font-semibold text-md-on-tertiary-container truncate" title={bestMagicLink.url}>
                  {bestMagicLink.host || bestMagicLink.label || bestMagicLink.url}
                </div>
              </div>
            </div>
            <div class="flex flex-nowrap items-center gap-3 shrink-0 max-w-[60%]" use:responsiveButtonLayout data-action-tier="S">
              <button
                type="button"
                class="h-10 px-4 rounded-full text-sm font-semibold bg-md-tertiary text-md-on-tertiary hover:opacity-90 transition-opacity"
                aria-label={$t('inbox.openMagicLink')}
                title={$t('inbox.openMagicLinkHost', { values: { host: bestMagicLink.host || '' } })}
                onclick={(e) => {
                  e.stopPropagation();
                  void openMagicLink(bestMagicLink!.url);
                }}
              >
                <span class="btn-label">{$t('inbox.openMagicLink')}</span>
              </button>
              <button
                type="button"
                class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-md-on-tertiary-container/10 active:bg-md-on-tertiary-container/20"
                aria-label={$t('inbox.copyMagicLink')}
                title={$t('inbox.copyMagicLink')}
                onclick={(e) => {
                  e.stopPropagation();
                  void copyMagicLink(bestMagicLink!.url);
                }}
              >
                <Icon name="contentCopy" class="w-5 h-5 text-md-on-tertiary-container/70" />
              </button>
            </div>
          </div>
        {/if}
      </div>
      {/if}
    </div>
  {/if}

  <div
    class="absolute inset-x-0 {PORTAL_Z_CLASS.chrome} flex items-center justify-center gap-1.5 px-2 pointer-events-none"
    style="bottom: calc(var(--bottom-safe-area, 0px) + 4px);"
  >
    <div
      bind:this={detailToolbarEl}
      use:responsiveButtonLayout
      data-action-tier="XS"
      class="{DETAIL_TOOLBAR_STRIP}"
    >
      {#if toolbarVisibility.archive}
      <button
        type="button"
        id="button-archive-detail"
        class="{toolbarBtn} {DETAIL_TOOLBAR_TONE_NEUTRAL}"
        aria-label={$t('common.archive')}
        title={$t('common.archive')}
        onclick={(e) => {
          e.stopPropagation();
          onArchive();
        }}
      >
        <Icon name="archive" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('common.archive')}</span>{/if}
      </button>
      {/if}
      {#if toolbarVisibility.delete}
      <button
        type="button"
        id="button-delete-detail"
        class="{toolbarBtn} {DETAIL_TOOLBAR_TONE_DANGER}"
        aria-label={$t('common.delete')}
        title={$t('common.delete')}
        onclick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Icon name="delete" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('common.delete')}</span>{/if}
      </button>
      {/if}
      {#if toolbarVisibility.download}
      <button
        type="button"
        id="button-download"
        class="{toolbarBtn} {DETAIL_TOOLBAR_TONE_NEUTRAL}"
        aria-label={$t('inbox.emailActions.download')}
        title={$t('inbox.emailActions.download')}
        onclick={(e) => {
          e.stopPropagation();
          downloadDialogOpen = true;
        }}
      >
        <Icon name="download" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.download')}</span>{/if}
      </button>
      {/if}
      {#if toolbarVisibility.print}
      <button
        type="button"
        id="button-print-detail"
        class="{toolbarBtn} {DETAIL_TOOLBAR_TONE_ACCENT}"
        aria-label={$t('inbox.emailActions.print')}
        title={$t('inbox.emailActions.print')}
        onclick={(e) => {
          e.stopPropagation();
          printEmail();
        }}
      >
        <Icon name="print" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.print')}</span>{/if}
      </button>
      {/if}
      {#if toolbarVisibility.forward}
      <button
        type="button"
        id="button-forward"
        class="{toolbarBtn} {DETAIL_TOOLBAR_TONE_NEUTRAL}"
        aria-label={$t('inbox.emailActions.forward')}
        title={$t('inbox.emailActions.forward')}
        onclick={(e) => {
          e.stopPropagation();
          _forwardMessage();
        }}
      >
        <Icon name="forward" class="w-4 h-4 shrink-0 rtl-flip" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.forwardShort')}</span>{/if}
      </button>
      {/if}
      {#if toolbarVisibility.markUnread}
      <button
        type="button"
        id="button-mark-unread"
        class="{toolbarBtn} {DETAIL_TOOLBAR_TONE_NEUTRAL}"
        aria-label={$t('inbox.emailActions.markUnread')}
        title={$t('inbox.emailActions.markUnread')}
        onclick={(e) => {
          e.stopPropagation();
          onMarkUnread();
        }}
      >
        <Icon name="mark_email_unread" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.markUnreadShort')}</span>{/if}
      </button>
      {/if}
      <button
        type="button"
        id="button-create-rule"
        class="{toolbarBtn} {DETAIL_TOOLBAR_TONE_ACCENT}"
        aria-label={$t('inbox.emailActions.createRule')}
        title={$t('inbox.emailActions.createRule')}
        onclick={(e) => {
          e.stopPropagation();
          onCreateRule(currentMessage?.from || '');
        }}
      >
        <Icon name="automation" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.createRuleShort')}</span>{/if}
      </button>
    </div>
  </div>

  <!-- Left Chevron Button -->
  <button
    class="absolute start-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full flex items-center justify-center bg-md-surface-container-high/70 backdrop-blur-sm border border-md-outline-variant/30 text-md-primary {ELEVATION.level2} transition-all opacity-40 hover:opacity-100 hover:scale-105 active:scale-95 disabled:opacity-15 disabled:cursor-not-allowed disabled:scale-100"
    onclick={(e) => { e.stopPropagation(); onPrev(); }}
    disabled={!hasPrev}
    title={hasPrev ? $t('inbox.emailActions.prevEmail') : $t('inbox.emailActions.noPrevEmail')}
    aria-label={$t('inbox.emailActions.prevEmail')}
  >
    <Icon name="chevronLeft" class="w-5 h-5 rtl-flip" />
  </button>

  <!-- End-side chevron (next) -->
  <button
    class="absolute end-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full flex items-center justify-center bg-md-surface-container-high/70 backdrop-blur-sm border border-md-outline-variant/30 text-md-primary {ELEVATION.level2} transition-all opacity-40 hover:opacity-100 hover:scale-105 active:scale-95 disabled:opacity-15 disabled:cursor-not-allowed disabled:scale-100"
    onclick={(e) => { e.stopPropagation(); onNext(); }}
    disabled={!hasNext}
    title={hasNext ? $t('inbox.emailActions.nextEmail') : $t('inbox.emailActions.noNextEmail')}
    aria-label={$t('inbox.emailActions.nextEmail')}
  >
    <Icon name="chevronRight" class="w-5 h-5 rtl-flip" />
  </button>

  {#if linksDialogMessage && linksDialogLinks.length > 0}
    <ModalDialog
      open={true}
      activityDialogKey="dialog:other"
      onClose={() => (linksDialogMessageId = null)}
      maxWidth="md"
      title={linksDialogIsMedia ? $t('inbox.mediaLinks') : $t('inbox.linksInEmail', { values: { n: linksDialogLinks.length } })}
    >
      {#snippet headerActions()}
        <IconButton
          icon="contentCopy"
          size="sm"
          ariaLabel={$t('inbox.copyAllLinks')}
          title={$t('inbox.copyAllLinks')}
          onclick={() => { void copyAllLinks(linksDialogLinks); }}
        />
      {/snippet}
      <div class="scroll-body max-h-[min(65vh,28rem)] space-y-2 overflow-y-auto">
        {#each linksDialogGroups as group (group.title)}
          <section class="space-y-2" aria-label={group.title}>
            <h3 class="ui-label text-md-on-surface-variant">{group.title} <span class="tabular-nums">({group.links.length})</span></h3>
        {#each group.links as link (link.url)}
          <div class="flex min-w-0 items-center gap-3 rounded-xl border border-md-outline-variant/30 bg-md-surface-container-low px-3 py-2" data-email-link>
            <FaviconImage
              domain={link.host}
              size="row"
              class="shrink-0"
              fallbackLetter={(link.host[0] || '?').toUpperCase()}
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-semibold text-md-on-surface" title={link.label}>{link.label}</div>
              <div class="truncate text-xs text-md-on-surface-variant" title={link.url}>{link.url}</div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <IconButton
                icon="openInNew"
                size="sm"
                ariaLabel={$t('inbox.openLink')}
                title={$t('inbox.openLink')}
                onclick={() => { void openMessageLink(link.url); }}
              />
              <IconButton
                icon="contentCopy"
                size="sm"
                ariaLabel={$t('inbox.copyLink')}
                title={$t('inbox.copyLink')}
                onclick={() => { void copyMagicLink(link.url); }}
              />
            </div>
          </div>
        {/each}
          </section>
        {/each}
      </div>
    </ModalDialog>
  {/if}

  <!-- Label dialog: absolute so it stays inside this detail pane only -->
  {#if labelDialogOpen}
    <!-- Portaled to document.body via ModalDialog (PORTAL_Z.dialog) - an in-pane
         absolute overlay would be trapped by the pane's stacking context. -->
    <ModalDialog
      open={labelDialogOpen}
      activityDialogKey="dialog:label"
      onClose={closeLabelDialog}
      maxWidth="xs"
      title={$t('inbox.emailActions.labelDialogTitle')}
    >
      {#snippet headerActions()}
        <IconButton
          icon="settings"
          size="sm"
          ariaLabel={$t('nav.labelManagement')}
          title={$t('nav.labelManagement')}
          onclick={() => {
            closeLabelDialog();
            onManageLabels();
          }}
        />
      {/snippet}
      <p class="text-xs text-md-on-surface/60 mb-2">{$t('inbox.labelDialogHint')}</p>
      <input
        type="text"
        class="w-full px-3 py-2 text-sm rounded-lg border border-md-outline-variant bg-md-surface-container-low focus:outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
        placeholder={$t('inbox.labelDialogPlaceholder')}
        bind:value={labelDialogInput}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveEmailLabels(); } }}
      />
      {#if allEmailLabels.length > 0}
        <div class="flex flex-wrap gap-1.5 mt-2">
          {#each allEmailLabels as label (label)}
            <button
              type="button"
              class="px-2 py-0.5 text-xs rounded-full transition-colors hover:opacity-80"
              style="background-color: {hexToRgba(labelColor(label), 0.12)}; color: {labelColor(label)};"
              onclick={(e) => { e.stopPropagation(); labelDialogInput = labelDialogInput ? `${labelDialogInput}, ${label}` : label; }}
            >{label}</button>
          {/each}
        </div>
      {/if}
      {#if dialogNewLabels.length > 0}
        <div class="flex items-center gap-2 mt-2">
          <input
            type="color"
            class="w-7 h-7 rounded-lg cursor-pointer border-0 p-0.5 bg-transparent shrink-0"
            bind:value={labelDialogColor}
            oninput={() => {
              labelDialogColorTouched = true;
            }}
            aria-label={$t('inbox.labelDialogNewColor')}
            title={$t('inbox.labelDialogNewColor')}
          />
          <span class="text-sm text-md-on-surface-variant">{$t('inbox.labelDialogNewColor')}</span>
        </div>
      {/if}
      {#snippet footer()}
        <Btn variant="secondary" size="md" onclick={closeLabelDialog}>{$t('common.cancel')}</Btn>
        <Btn variant="primary" size="md" disabled={labelSaveBusy} onclick={() => { void saveEmailLabels(); }}>{$t('common.save')}</Btn>
      {/snippet}
    </ModalDialog>
  {/if}

  <!-- Download format dialog: EML / Markdown / PDF (portaled via ModalDialog) -->
  {#if downloadDialogOpen}
    <ModalDialog
      open={downloadDialogOpen}
      activityDialogKey="dialog:other"
      onClose={() => (downloadDialogOpen = false)}
      maxWidth="xs"
      title={$t('inbox.emailActions.downloadDialogTitle')}
    >
      <p class="text-xs text-md-on-surface/60 mb-2">{$t('inbox.emailActions.downloadDialogHint')}</p>
      <div class="space-y-2">
          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-md-outline-variant/40 bg-md-surface-container-low hover:bg-md-primary/10 active:bg-md-primary/30 hover:border-md-primary transition-colors text-start"
            onclick={(e) => { e.stopPropagation(); downloadDialogOpen = false; void _downloadAsEML(); }}
          >
            <span class="w-9 h-9 rounded-lg bg-md-primary-container text-md-on-primary-container flex items-center justify-center shrink-0"><Icon name="mail" class="w-4 h-4" /></span>
            <span class="min-w-0">
              <span class="block text-sm font-semibold text-md-on-surface">{$t('inbox.emailActions.downloadEml')}</span>
              <span class="block text-xs text-md-on-surface/50 truncate">{$t('inbox.emailActions.downloadEmlHint')}</span>
            </span>
          </button>
          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-md-outline-variant/40 bg-md-surface-container-low hover:bg-md-primary/10 active:bg-md-primary/30 hover:border-md-primary transition-colors text-start"
            onclick={(e) => { e.stopPropagation(); downloadDialogOpen = false; downloadAsMarkdown(); }}
          >
            <span class="w-9 h-9 rounded-lg bg-md-secondary-container text-md-on-secondary-container flex items-center justify-center shrink-0"><Icon name="description" class="w-4 h-4" /></span>
            <span class="min-w-0">
              <span class="block text-sm font-semibold text-md-on-surface">{$t('inbox.emailActions.downloadMarkdown')}</span>
              <span class="block text-xs text-md-on-surface/50 truncate">{$t('inbox.emailActions.downloadMarkdownHint')}</span>
            </span>
          </button>
          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-md-outline-variant/40 bg-md-surface-container-low hover:bg-md-primary/10 active:bg-md-primary/30 hover:border-md-primary transition-colors text-start"
            onclick={(e) => { e.stopPropagation(); downloadDialogOpen = false; printEmail(); }}
          >
            <span class="w-9 h-9 rounded-lg bg-md-tertiary-container text-md-on-tertiary-container flex items-center justify-center shrink-0"><Icon name="print" class="w-4 h-4" /></span>
            <span class="min-w-0">
              <span class="block text-sm font-semibold text-md-on-surface">{$t('inbox.emailActions.downloadPdf')}</span>
              <span class="block text-xs text-md-on-surface/50 truncate">{$t('inbox.emailActions.downloadPdfHint')}</span>
            </span>
          </button>
        </div>
    </ModalDialog>
  {/if}
</div>
{:else}
  <EmptyState
    compact
    icon="mail"
    title={$t('inbox.noMessageSelected')}
    description={$t('inbox.splitEmptyHint')}
  />
{/if}

{#if selectionPopupPos && selectedText}
  <div
    class="fixed {PORTAL_Z_CLASS.dialog} -translate-x-1/2 flex flex-nowrap items-center gap-3 p-1.5 max-w-[calc(100vw-1.5rem)] rounded-full bg-md-surface-container-high border border-md-outline-variant/40 {ELEVATION.level2} backdrop-blur-md"
    use:responsiveButtonLayout
    data-action-tier="S"
    style="left: {selectionPopupPos.x}px; top: {selectionPopupPos.y}px;"
  >
    <button
      type="button"
      class="flex-1 min-w-0 h-10 px-4 flex items-center gap-2 text-sm font-semibold rounded-full bg-md-primary text-md-on-primary hover:brightness-110 active:brightness-95 active:scale-95 transition-all"
      onclick={async (e) => {
        e.stopPropagation();
        try {
          await copyToClipboardAndSchedulePurge(selectedText);
          showToast(get(t)('inbox.copiedToClipboard') as string);
        } catch (err) {
          logError(
            'Failed to copy selection',
            undefined,
            err instanceof Error ? err : new Error(String(err))
          );
          showToast?.(get(t)('inbox.copyFailed') as string);
        }
        window.getSelection()?.removeAllRanges();
      }}
    >
      <Icon name="contentCopy" class="w-5 h-5 shrink-0" />
      <span class="btn-label">{$t('common.copy')}</span>
    </button>
    <button
      type="button"
      class="flex-1 min-w-0 h-10 px-4 flex items-center gap-2 text-sm font-semibold rounded-full bg-md-secondary-container text-md-on-secondary-container hover:brightness-110 active:brightness-95 active:scale-95 transition-all"
      onclick={(e) => {
        e.stopPropagation();
        onSearchText(selectedText);
        window.getSelection()?.removeAllRanges();
      }}
    >
      <Icon name="search" class="w-5 h-5 shrink-0" />
      <span class="btn-label">{$t('inbox.searchMailbox')}</span>
    </button>
  </div>
{/if}
