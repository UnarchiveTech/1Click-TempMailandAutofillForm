import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const CONTENT_DIR = join(ROOT, 'docs-site', 'content');
const PUBLIC_DIR = join(ROOT, 'docs-site', 'public');
const DIST_DIR = join(ROOT, 'docs-site', 'dist');
const BASE_PATH = process.env.DOCS_BASE_PATH || '/1click/';
const PRODUCTION_BASE_PATH = '/1click/';
const PRODUCTION_ORIGIN = 'https://docs.unarchive.tech';

const PAGE_ORDER = [
  'index',
  'installation',
  'mailbox',
  'autofill',
  'automation',
  'settings',
  'privacy',
  'webmcp',
];
const PAGE_LABELS: Record<string, string> = {
  index: 'Overview',
  installation: 'Installation',
  mailbox: 'Mailbox',
  autofill: 'Autofill',
  automation: 'Automation',
  settings: 'Settings',
  privacy: 'Privacy',
  webmcp: 'WebMCP',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function siteUrl(value: string): string {
  return value.startsWith(PRODUCTION_BASE_PATH)
    ? `${BASE_PATH}${value.slice(PRODUCTION_BASE_PATH.length)}`
    : value;
}

/** Matches `-light` / `-dark` screenshot variants: stem + variant + extension. */
const THEME_VARIANT_RE = /^(.*)-(light|dark)(\.(?:png|webp|jpe?g|svg))$/;

function themeableImage(alt: string, url: string): string {
  const match = url.match(THEME_VARIANT_RE);
  if (!match) {
    return `<img src="${siteUrl(url)}" alt="${alt}" loading="lazy">`;
  }
  const [, stem, variant, ext] = match;
  const lightUrl = `${stem}-light${ext}`;
  const darkUrl = `${stem}-dark${ext}`;
  const src = variant === 'light' ? lightUrl : darkUrl;
  return `<img src="${siteUrl(src)}" alt="${alt}" loading="lazy" class="theme-shot" data-light="${siteUrl(
    lightUrl
  )}" data-dark="${siteUrl(darkUrl)}">`;
}

function inlineMarkdown(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, url: string) =>
    themeableImage(alt, url)
  );
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label: string, url: string) => `<a href="${siteUrl(url)}">${label}</a>`
  );
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return html;
}

function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim();
  // e.g. |---------|--------|  or  |:---|---:|:---:|
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  return /^[\s|:-]+$/.test(trimmed) && /-{2,}/.test(trimmed);
}

function parseTableRow(line: string): string[] {
  let raw = line.trim();
  if (raw.startsWith('|')) raw = raw.slice(1);
  if (raw.endsWith('|')) raw = raw.slice(0, -1);
  return raw.split('|').map((cell) => cell.trim());
}

function renderTable(header: string[], rows: string[][]): string {
  const thead = `<thead><tr>${header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead>`;
  const tbody =
    rows.length === 0
      ? ''
      : `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<div class="table-wrap"><table>${thead}${tbody}</table></div>`;
}

function markdownToHtml(markdown: string): { title: string; body: string } {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];
  let title = '1Click documentation';
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      output.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      output.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`);
      list = [];
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      if (code) {
        output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      } else {
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }

    // ── GFM pipe tables ────────────────────────────────────────────
    if (line.includes('|') && idx + 1 < lines.length && isTableDelimiter(lines[idx + 1])) {
      flushParagraph();
      flushList();
      const header = parseTableRow(line);
      idx += 1; // skip delimiter line
      const rows: string[][] = [];
      while (
        idx + 1 < lines.length &&
        lines[idx + 1].includes('|') &&
        lines[idx + 1].trim().startsWith('|')
      ) {
        idx += 1;
        const row = parseTableRow(lines[idx]);
        // skip stray delimiter-like rows inside the table body
        if (row.every((cell) => /^[:-]+$/.test(cell) || cell === '')) continue;
        rows.push(row);
      }
      output.push(renderTable(header, rows));
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const headingText = heading[2].trim();
      if (level === 1) title = headingText;
      output.push(`<h${level}>${inlineMarkdown(headingText)}</h${level}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      output.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  if (code) output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return { title, body: output.join('\n') };
}

function pageHref(slug: string): string {
  return slug === 'index' ? BASE_PATH : `${BASE_PATH}${slug}/`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Inline script: mirrors extension ThemeToggle - system/auto follows OS, light/dark pinned; screenshots swap to resolved theme. */
const THEME_SCRIPT =
  `<script>
(function () {
  var KEY = 'docs-theme-mode';
  var MODES = ['light', 'auto', 'dark'];
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function storedMode() {
    try {
      var v = localStorage.getItem(KEY);
      return MODES.indexOf(v) !== -1 ? v : 'auto';
    } catch (e) { return 'auto'; }
  }
  function apply(mode) {
    var resolved = mode === 'auto' ? (mq.matches ? 'dark' : 'light') : mode;
    var root = document.documentElement;
    root.setAttribute('data-theme-mode', mode);
    root.setAttribute('data-resolved-theme', resolved);
    var btns = document.querySelectorAll('.theme-toggle-track [data-theme]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-theme') === mode ? 'true' : 'false');
    }
    var shots = document.querySelectorAll('img.theme-shot[data-light]');
    for (var i = 0; i < shots.length; i++) {
      var want = resolved === 'dark' ? shots[i].getAttribute('data-dark') : shots[i].getAttribute('data-light');
      if (want && shots[i].getAttribute('src') !== want) shots[i].setAttribute('src', want);
    }
  }
  apply(storedMode());
  document.addEventListener('DOMContentLoaded', function () {
    apply(storedMode());
    var track = document.querySelector('.theme-toggle-track');
    if (!track) return;
    track.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-theme]');
      if (!btn) return;
      var mode = btn.getAttribute('data-theme');
      if (MODES.indexOf(mode) === -1) return;
      try { localStorage.setItem(KEY, mode); } catch (e) { /* ignore: persistence is best-effort - private mode and blocked storage reject the write, and the theme still applies for this page view */ }
      apply(mode);
    });
  });
  var onSchemeChange = function () { apply(storedMode()); };
  if (mq.addEventListener) mq.addEventListener('change', onSchemeChange);
  else if (mq.addListener) mq.addListener(onSchemeChange);
})();
</` + `script>`;

/** Header pill - 1:1 with extension ThemeToggle.svelte (light/auto/dark + sliding pill) */
const THEME_BUTTON = `<div class="theme-toggle-wrap" role="presentation">
    <div class="theme-toggle-track" role="group" aria-label="Switch color theme">
      <span class="theme-pill" aria-hidden="true"></span>
      <button type="button" data-theme="light" aria-label="Light" title="Light" aria-pressed="false">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      </button>
      <button type="button" data-theme="auto" aria-label="System" title="System" aria-pressed="true">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z"/></svg>
      </button>
      <button type="button" data-theme="dark" aria-label="Dark" title="Dark" aria-pressed="false">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 8.354-5.646z"/></svg>
      </button>
    </div>
  </div>`;

const SEARCH_MARKUP = `<div class="search-wrap" role="search">
  <label for="docs-search" class="sr-only">Search documentation</label>
  <div class="search-input-wrap">
    <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="docs-search" type="search" placeholder="Search docs…" autocomplete="off" spellcheck="false" aria-label="Search documentation" aria-controls="search-results" aria-expanded="false">
    <kbd class="search-kbd" aria-hidden="true">/</kbd>
    <button type="button" class="search-clear" aria-label="Clear search" hidden>×</button>
  </div>
  <div id="search-results" class="search-results" hidden role="listbox" aria-label="Search results"></div>
</div>`;

const SEARCH_SCRIPT =
  `<script>
(function () {
  var input = document.getElementById('docs-search');
  var resultsEl = document.getElementById('search-results');
  var wrap = document.querySelector('.search-wrap');
  var clearBtn = document.querySelector('.search-clear');
  var kbd = document.querySelector('.search-kbd');
  if (!input || !resultsEl) return;
  var dataEl = document.getElementById('search-data');
  var index = [];
  try { index = JSON.parse(dataEl ? dataEl.textContent || '[]' : '[]'); } catch(e) { index = []; }
  var activeIndex = -1;

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function highlight(text, q) {
    if (!q) return escapeHtml(text);
    var esc = q.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    try {
      return escapeHtml(text).replace(new RegExp('(' + esc + ')', 'ig'), '<mark>$1</mark>');
    } catch(e) { return escapeHtml(text); }
  }
  function snippetFor(item, q) {
    var text = item.text || '';
    if (!q) return escapeHtml(text.slice(0, 140)) + (text.length > 140 ? '…' : '');
    var lower = text.toLowerCase();
    var qLower = q.toLowerCase();
    var pos = lower.indexOf(qLower);
    if (pos === -1) return escapeHtml(text.slice(0, 140)) + (text.length > 140 ? '…' : '');
    var start = Math.max(0, pos - 55);
    var end = Math.min(text.length, pos + q.length + 75);
    var s = text.slice(start, end);
    if (start > 0) s = '…' + s;
    if (end < text.length) s = s + '…';
    return highlight(s, q);
  }
  function scoreItem(item, q) {
    var qLower = q.toLowerCase();
    var titleLower = (item.title || '').toLowerCase();
    var labelLower = (item.label || '').toLowerCase();
    if (titleLower.indexOf(qLower) !== -1) return 0;
    if (labelLower.indexOf(qLower) !== -1) return 1;
    if ((item.text || '').toLowerCase().indexOf(qLower) !== -1) return 2;
    return 99;
  }
  function render(q) {
    var query = (q || '').trim();
    if (!query || query.length < 1) {
      resultsEl.hidden = true;
      resultsEl.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      if (kbd) kbd.hidden = false;
      if (clearBtn) clearBtn.hidden = true;
      activeIndex = -1;
      return;
    }
    if (kbd) kbd.hidden = true;
    if (clearBtn) clearBtn.hidden = false;
    var qLower = query.toLowerCase();
    var scored = [];
    for (var i = 0; i < index.length; i++) {
      var it = index[i];
      var hay = ((it.title || '') + ' ' + (it.label || '') + ' ' + (it.text || '')).toLowerCase();
      if (hay.indexOf(qLower) !== -1) scored.push({ item: it, score: scoreItem(it, query) });
    }
    scored.sort(function(a,b){ return a.score - b.score; });
    var top = scored.slice(0, 8);
    if (top.length === 0) {
      resultsEl.innerHTML = '<div class="search-empty">No results for “' + escapeHtml(query) + '”</div>';
      resultsEl.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      return;
    }
    var html = '';
    for (var j = 0; j < top.length; j++) {
      var item = top[j].item;
      html += '<a role="option" class="search-result' + (j === activeIndex ? ' is-active' : '') + '" href="' + escapeHtml(item.href) + '" data-index="' + j + '">'
        + '<span class="search-result-label">' + highlight(item.label, query) + '</span>'
        + '<span class="search-result-title">' + highlight(item.title, query) + '</span>'
        + '<span class="search-result-snippet">' + snippetFor(item, query) + '</span>'
        + '</a>';
    }
    html += '<div class="search-hint"><kbd>↑↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>esc</kbd> close</div>';
    resultsEl.innerHTML = html;
    resultsEl.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  var debounceTimer = null;
  input.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    var v = input.value;
    debounceTimer = setTimeout(function(){ render(v); }, 120);
  });
  input.addEventListener('focus', function(){ if (input.value.trim()) render(input.value); });
  input.addEventListener('keydown', function(e) {
    var items = resultsEl.querySelectorAll('.search-result');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (resultsEl.hidden) { render(input.value); return; }
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      render(input.value);
      // move class without re-render flicker - re-render already handles it but ensure scroll
      if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      render(input.value);
      if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        window.location.href = items[activeIndex].getAttribute('href');
      }
    } else if (e.key === 'Escape') {
      resultsEl.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
      input.blur();
    }
  });
  if (clearBtn) clearBtn.addEventListener('click', function(){
    input.value = '';
    input.focus();
    render('');
  });
  document.addEventListener('click', function(e){
    if (!wrap || !wrap.contains(e.target)) {
      resultsEl.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
    }
  });
  document.addEventListener('keydown', function(e){
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      var ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      e.preventDefault();
      input.focus();
    }
  });
  resultsEl.addEventListener('mousemove', function(e){
    var a = e.target.closest('.search-result');
    if (!a) return;
    activeIndex = parseInt(a.getAttribute('data-index') || '-1', 10);
    var all = resultsEl.querySelectorAll('.search-result');
    for (var k=0;k<all.length;k++) all[k].classList.toggle('is-active', k===activeIndex);
  });
})();
</` + `script>`;

/* ── Store download popup (Install button) ─────────────────────────────── */

interface StoreEntry {
  id: string;
  name: string;
  store: string;
  status: string;
  tone: 'live' | 'pending' | 'muted';
  url: string;
}

/** Keep in sync with the table in content/installation.md. */
const STORES: StoreEntry[] = [
  {
    id: 'chrome',
    name: 'Chrome',
    store: 'Chrome Web Store',
    status: 'Published',
    tone: 'live',
    url: 'https://chromewebstore.google.com/detail/1click-temp-mail-with-aut/oilafkncmnboohnekbnokkifjbnjeecn',
  },
  {
    id: 'firefox',
    name: 'Firefox',
    store: 'Firefox Add-ons',
    status: 'In review',
    tone: 'pending',
    url: 'https://addons.mozilla.org/firefox/addon/1click-temp-mail/',
  },
  {
    id: 'safari',
    name: 'Safari',
    store: 'App Store',
    status: 'Packaged',
    tone: 'pending',
    url: 'https://apps.apple.com/app/1click-temp-mail',
  },
  {
    id: 'edge',
    name: 'Edge',
    store: 'Edge Add-ons',
    status: 'Planned',
    tone: 'muted',
    url: 'https://microsoftedge.microsoft.com/addons/',
  },
];

/** Simplified browser marks - stylized, dependency-free SVG glyphs. */
const STORE_ICONS: Record<string, string> = {
  chrome: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <path fill="#34A853" d="M12 12 17 3.34A10 10 0 0 1 2 12Z"/>
    <path fill="#FBBC05" d="M12 12 2 12A10 10 0 0 1 17 21.34Z"/>
    <path fill="#EA4335" d="M12 12 17 21.34A10 10 0 0 1 17 3.34Z"/>
    <circle cx="12" cy="12" r="3.4" fill="#4285F4"/>
  </svg>`,
  firefox: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <circle cx="12" cy="12" r="11" fill="#FF7139"/>
    <path d="M17.4 6.6a6.2 6.2 0 1 0 1.4 8.8" fill="none" stroke="#5B21B6" stroke-width="2.1" stroke-linecap="round"/>
    <circle cx="9.4" cy="10.2" r="1.05" fill="#fff"/>
    <circle cx="13.6" cy="10.6" r="1.05" fill="#fff"/>
  </svg>`,
  safari: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <defs>
      <linearGradient id="safariGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#3FB6F2"/>
        <stop offset="1" stop-color="#0B62D0"/>
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="11" fill="url(#safariGrad)"/>
    <path d="M12 8l4 4-4 4-4-4z" fill="#fff"/>
    <path d="M8 12l4-4v8z" fill="#E43355"/>
    <circle cx="12" cy="12" r="1.1" fill="#fff"/>
  </svg>`,
  edge: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <defs>
      <linearGradient id="edgeGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#35C1F0"/>
        <stop offset="0.55" stop-color="#0E7FDF"/>
        <stop offset="1" stop-color="#053DA8"/>
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="11" fill="url(#edgeGrad)"/>
    <circle cx="12" cy="12" r="6" fill="none" stroke="#fff" stroke-width="1.6"/>
    <path d="M9 12.4h5.2M10.4 12.4V9.2h2.4v1" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,
};

function storeCard(store: StoreEntry): string {
  return `<a class="store-card" href="${store.url}" target="_blank" rel="noopener">
    <span class="store-icon" aria-hidden="true">${STORE_ICONS[store.id]}</span>
    <span class="store-meta">
      <span class="store-name">${store.name}</span>
      <span class="store-market">${store.store}</span>
    </span>
    <span class="store-status store-status-${store.tone}">${store.status}</span>
  </a>`;
}

const INSTALL_BUTTON = `<button type="button" class="btn btn-primary header-install" data-install-trigger aria-haspopup="dialog" aria-expanded="false">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5"/><path d="M4 17v1.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V17"/></svg>
  <span>Install</span>
</button>`;

const DEMO_BUTTON = `<button type="button" class="btn btn-ghost header-demo" data-demo-trigger aria-haspopup="true">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.4-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/></svg>
  <span>Demo</span>
</button>
<div class="demo-toast" data-demo-toast role="status" hidden>Interactive demo is still being baked - explore the screenshots in the meantime.</div>`;

const INSTALL_MODAL = `<div class="modal-backdrop" data-install-backdrop hidden>
  <div class="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-modal-title" aria-describedby="install-modal-desc">
    <div class="install-modal-head">
      <div>
        <h2 id="install-modal-title">Get 1Click in your browser</h2>
        <p id="install-modal-desc">One codebase, four stores - pick your browser below.</p>
      </div>
      <button type="button" class="modal-close" data-install-close aria-label="Close dialog">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>
    <div class="store-grid">${STORES.map(storeCard).join('\n')}</div>
    <p class="install-modal-foot"><a href="${pageHref('installation')}">Manual / sideload walkthroughs &amp; store status → Installation</a></p>
  </div>
</div>`;

/** Open/close + focus trap for the Install dialog; Demo shows a placeholder toast. */
const HEADER_SCRIPT =
  `<script>
(function () {
  var backdrop = document.querySelector('[data-install-backdrop]');
  var trigger = document.querySelector('[data-install-trigger]');
  var lastFocused = null;
  function open() {
    if (!backdrop) return;
    lastFocused = document.activeElement;
    backdrop.hidden = false;
    document.body.classList.add('modal-open');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    var first = backdrop.querySelector('.store-card');
    if (first) first.focus();
  }
  function close() {
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    document.body.classList.remove('modal-open');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }
  if (trigger) trigger.addEventListener('click', open);
  var closeBtns = backdrop ? backdrop.querySelectorAll('[data-install-close]') : [];
  for (var i = 0; i < closeBtns.length; i++) closeBtns[i].addEventListener('click', close);
  if (backdrop) {
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !backdrop.hidden) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || backdrop.hidden) return;
      var focusables = backdrop.querySelectorAll('a[href], button:not([disabled])');
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
})();
(function () {
  var trigger = document.querySelector('[data-demo-trigger]');
  var toast = document.querySelector('[data-demo-toast]');
  if (!trigger || !toast) return;
  var timer = null;
  trigger.addEventListener('click', function () {
    toast.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(function () { toast.hidden = true; }, 2800);
  });
})();
</` + `script>`;

function renderPage(slug: string, title: string, body: string, searchDataJson: string): string {
  const nav = PAGE_ORDER.map((item) => {
    const active = item === slug ? ' aria-current="page"' : '';
    return `<a href="${pageHref(item)}"${active}>${PAGE_LABELS[item]}</a>`;
  }).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="1Click temporary email and autofill documentation">
  <link rel="stylesheet" href="${BASE_PATH}styles.css">
  <link rel="canonical" href="${PRODUCTION_ORIGIN}${pageHref(slug)}">
  <title>${escapeHtml(title)} · 1Click</title>
  ${THEME_SCRIPT}
</head>
<body>
  <header class="site-header">
    <a class="brand" href="${BASE_PATH}"><span class="brand-mark">1</span><span>1Click docs</span></a>
    <div class="header-actions">
      ${SEARCH_MARKUP}
      ${DEMO_BUTTON}
      ${INSTALL_BUTTON}
      ${THEME_BUTTON}
    </div>
  </header>
  <div class="layout">
    <aside class="site-sidebar">
      <p class="sidebar-label">Documentation</p>
      <nav aria-label="Documentation">${nav}</nav>
      <a class="sidebar-source" href="https://github.com/UnarchiveTech/1Click-TempMailandAutofillForm/releases" target="_blank" rel="noopener">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 3 6v6c0 5 3.9 9.4 9 10 5.1-.6 9-5 9-10V6z"/><path d="M12 8v4m0 4h.01"/></svg>
        <span>GitHub Releases</span>
      </a>
    </aside>
    <main class="page-shell">
      <article class="content">${body}</article>
    </main>
  </div>
  <footer class="site-footer">Generated from the 1Click project · <a href="https://unarchive.tech/">UnarchiveTech</a></footer>
  <script id="search-data" type="application/json">${searchDataJson}</script>
  ${INSTALL_MODAL}
  ${SEARCH_SCRIPT}
  ${HEADER_SCRIPT}
</body>
</html>
`;
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else await writeFile(to, await readFile(from));
  }
}

async function main() {
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });
  await copyDirectory(PUBLIC_DIR, DIST_DIR);
  await writeFile(
    join(DIST_DIR, 'styles.css'),
    await readFile(join(ROOT, 'docs-site', 'styles.css'))
  );
  await writeFile(join(DIST_DIR, '.nojekyll'), '');

  const files = await readdir(CONTENT_DIR);
  const slugs = files
    .filter((file) => extname(file) === '.md')
    .map((file) => basename(file, '.md'))
    .sort((a, b) => PAGE_ORDER.indexOf(a) - PAGE_ORDER.indexOf(b));

  // Build search index first (needs body text)
  const pageCache: Record<string, { title: string; body: string; href: string }> = {};
  for (const slug of slugs) {
    const source = await readFile(join(CONTENT_DIR, `${slug}.md`), 'utf8');
    const rendered = markdownToHtml(source);
    pageCache[slug] = { title: rendered.title, body: rendered.body, href: pageHref(slug) };
  }
  const searchIndex = slugs.map((slug) => {
    const { title, body, href } = pageCache[slug];
    const text = stripHtml(body);
    return {
      slug,
      label: PAGE_LABELS[slug] || slug,
      title,
      href,
      text: text.slice(0, 4000),
    };
  });
  // Script elements are raw-text: HTML entities are not decoded before
  // JSON.parse. Escape only '<' as a JSON unicode escape to prevent a content
  // string from terminating this script element.
  const searchDataJson = JSON.stringify(searchIndex).replace(/</g, '\\u003c');

  for (const slug of slugs) {
    const { title, body } = pageCache[slug];
    const outputDir = slug === 'index' ? DIST_DIR : join(DIST_DIR, slug);
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, 'index.html'), renderPage(slug, title, body, searchDataJson));
  }

  await writeFile(join(DIST_DIR, 'search-index.json'), JSON.stringify(searchIndex, null, 2));

  const outputStats = await stat(DIST_DIR);
  console.log(
    `Docs built at ${relative(ROOT, DIST_DIR)} (${outputStats.isDirectory() ? 'static output' : 'unknown'})`
  );
  console.log(`Base path: ${BASE_PATH}`);
  console.log(`Pages: ${slugs.join(', ')}`);
}

await main();
