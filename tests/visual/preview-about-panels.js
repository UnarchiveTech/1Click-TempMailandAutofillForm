/**
 * AboutView action-row panels for `tests/visual/preview-responsive-button-layout.html`.
 *
 * The About page's two action rows are the newest §8 surfaces, so they get the
 * same treatment as the nav pill: the panels mount the REAL `responsiveButtonLayout`
 * (from the generated bundle, same as the extension ships) over markup that
 * mirrors `AboutView.svelte`'s authored classes, fed with the REAL translations
 * (`ABOUT_LABELS`, extracted from `src/locales/*.json` by the generator), then
 * measure what actually rendered - per locale, RTL included.
 *
 * Row 1 - GitHub · Store · Report (`role="toolbar"`, tier S): icon-over-label
 * stacks (flex-col). The responsive fitting fits their widths and enforces S-tier
 * typography, icons, horizontal padding and icon-label spacing. The common
 * taller stacked hit area remains authored by the component.
 * Row 2 - Replay · Shortcuts · Docs (tier S): horizontal actions using the
 * standard height and spacing, fitted within S's floors.
 *
 * PASS covers the contract that must hold in every locale/direction: the row
 * fits (sum+gaps ≤ row), the tier is locked (floors respected, no tier
 * conversion), truncation appears ONLY in the responsive fitting's final 'trunc' state,
 * and heights are equal within the row. The fitting STATE may legitimately
 * differ between two locales (and between LTR and RTL of the same locale) -
 * label widths differ - so the panels assert the contract, never a hand-picked
 * state, for the locale rows.
 */

import {
  ABOUT_LABELS,
  BODY_FONT_FAMILY,
  responsiveButtonLayout,
} from './preview-responsive-button-layout-module.js';

/** Real popup content width: 360 viewport − 6px scrollbar − 2×2px px-0.5. */
const ROW_W = 350;

/** RTL locales get mirrored stages; their rows must satisfy the same contract. */
const RTL = new Set(['ar']);

/** LTR stage per locale, one entry per (row, locale) panel. */
const CASES = [
  { id: 'S', row: 'toolbar', tier: 'S', lang: 'en' },
  { id: 'T', row: 'toolbar', tier: 'S', lang: 'de' },
  { id: 'U', row: 'toolbar', tier: 'S', lang: 'ar' },
  { id: 'V', row: 'pills', tier: 'S', lang: 'en' },
  { id: 'W', row: 'pills', tier: 'S', lang: 'de' },
  { id: 'X', row: 'pills', tier: 'S', lang: 'ar' },
];

const ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/></svg>';

const label = (lang, key) => ABOUT_LABELS[lang]?.[key] ?? ABOUT_LABELS.en[key];

/** Row-1 buttons as AboutView renders them in a Chrome popup (store enabled). */
function toolbarButtons(lang) {
  return [
    ['about.sourceCode', 'primary'],
    ['about.storeChrome', 'neutral'],
    ['about.reportIssue', 'danger'],
  ].map(([key, variant]) => {
    const a = document.createElement('a');
    a.href = '#';
    a.className = `col-btn about-${variant}`;
    a.innerHTML = `${ICON}<span class="col-label" title="${label(lang, key)}">${label(lang, key)}</span>`;
    return a;
  });
}

/** Row-2 pills: Replay · Shortcuts · Docs. */
function pillButtons(lang) {
  return ['productTour.replay', 'nav.keyboardShortcuts', 'about.documentation'].map((key) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'xs-btn';
    b.title = label(lang, key);
    b.innerHTML = `${ICON}<span>${label(lang, key)}</span>`;
    return b;
  });
}

/** Mirror AboutView.svelte's authored classes in harness CSS (no Tailwind here). */
const STYLES = `
<style>
  .about-stage { width: ${ROW_W}px; font-family: ${'var(--about-font, system-ui)'}; }
  /* The §8 row itself: the flex container the responsive fitting measures. */
  [data-about-row] {
    display: flex;
    width: 100%;
    gap: 12px; /* gap-3 - the rows' authored inter-button gap */
  }
  /* Row 1: icon-over-label stacks - text-xs font-semibold px-1.5 py-2 rounded-xl gap-1 */
  .col-btn {
    display: flex; flex: 1 1 0%; min-width: 0;
    flex-direction: column; align-items: center; justify-content: center;
    gap: 4px; padding: 8px 6px; border-radius: 12px;
    font-size: 12px; font-weight: 600; line-height: 1.25; text-align: center;
    border: 1px solid; text-decoration: none; cursor: pointer;
  }
  .col-label { max-width: 100%; white-space: nowrap; }
  .about-primary { border-color: var(--md-primary, #6750a4); color: var(--md-primary, #6750a4); }
  .about-neutral { border-color: #cac4d0; color: #1d1b20; }
  .about-danger { border: none; color: #b3261e; }
  /* Row 2: horizontal actions - text-sm px-4 py-2 rounded-lg gap-2 */
  .xs-btn {
    display: flex; flex: 1 1 0%; min-width: 0;
    align-items: center; justify-content: center;
    gap: 8px; height: 40px; box-sizing: border-box; padding: 8px 16px; border-radius: 8px;
    font-size: 14px; line-height: 1.4; border: 1px solid #cac4d0;
    background: none; color: #1d1b20; cursor: pointer;
  }
  .about-stage svg { width: 16px; height: 16px; flex-shrink: 0; }
</style>`;

const r1 = (n) => Math.round(n * 10) / 10;

function dumpRow(node) {
  const buttons = [...node.querySelectorAll('button, a, [role="button"]')];
  const rects = buttons.map((b) => b.getBoundingClientRect());
  const gaps = [];
  for (let i = 0; i < rects.length - 1; i += 1) {
    // Facing-edge distance, direction-agnostic - see the responsive fitting's measureGap.
    gaps.push(r1(Math.max(rects[i + 1].left - rects[i].right, rects[i].left - rects[i + 1].right)));
  }
  const cs = getComputedStyle(buttons[0]);
  const svg = buttons[0].querySelector('svg');
  const labelEl = buttons[0].querySelector('span');
  return {
    state: node.dataset.responsiveButtonLayoutState ?? '-',
    font: r1(parseFloat(cs.fontSize)),
    pad: r1(parseFloat(cs.paddingLeft)),
    band: r1(parseFloat(cs.gap)),
    icon: svg ? r1(parseFloat(getComputedStyle(svg).width)) : null,
    heights: buttons.map((b) => r1(b.getBoundingClientRect().height)),
    widths: buttons.map((b) => r1(b.getBoundingClientRect().width)),
    gaps,
    rowWidth: r1(node.getBoundingClientRect().width),
    sumPlusGaps: r1(
      gaps.reduce((a, g) => a + Math.abs(g), 0) +
        buttons.reduce((a, b) => a + b.getBoundingClientRect().width, 0)
    ),
    labelOverflow: labelEl ? getComputedStyle(labelEl).overflow : null,
    labelEllipsis: labelEl ? getComputedStyle(labelEl).textOverflow : null,
  };
}

/**
 * The contract, not a guessed state: which arm of Underfit wins depends on the
 * locale's label widths (the per-button guard), so the panel asserts that
 * EITHER arm is a real fit, the tier stays locked, and truncation appears only
 * where the responsive fitting's own state machine says it may.
 */
function verify(entry, d) {
  const checks = [];
  const ok = (cond, why) => {
    if (!cond) checks.push(why);
    return cond;
  };
  const fits = d.sumPlusGaps <= d.rowWidth + 0.6;
  ok(fits, `row overflows: ${d.sumPlusGaps} > ${d.rowWidth}`);
  ok(
    ['stretch', 'natural', 'pad', 'coupled', 'font', 'trunc'].includes(d.state),
    `state ${d.state}`
  );

  if (entry.row === 'toolbar') {
    // The tier owns typography, icon size, horizontal padding and label gap;
    // stacked controls keep one shared authored hit-area height.
    ok(d.font === 14 || d.font === 12, `stack font ${d.font} off S tier`);
    ok(d.icon === 2 * d.font - 8, `stack icon ${d.icon} off S tier`);
    ok(d.pad >= 4, `stack pad ${d.pad} below S floor`);
    ok(d.band >= 3, `stack gap ${d.band} below S floor`);
    const h = d.heights[0];
    ok(
      d.heights.every((x) => Math.abs(x - h) <= 1),
      `heights unequal: ${d.heights}`
    );
  } else {
    // Tier S LOCKED: horizontal actions use the standard 40px height and keep
    // typography, icons, padding and spacing within S's floors.
    ok(d.font === 14 || d.font === 12, `font ${d.font} off-tier`);
    ok(d.icon === 2 * d.font - 8, `icon ${d.icon} ≠ 2×${d.font}−8`);
    ok(d.pad >= 4, `pad ${d.pad} below S floor`);
    ok(d.band >= 3, `gap ${d.band} below S floor`);
    ok(
      d.heights.every((h) => Math.abs(h - 40) <= 1),
      `S height is not 40px: ${d.heights}`
    );
    const h = d.heights[0];
    ok(
      d.heights.every((x) => Math.abs(x - h) <= 1),
      `heights unequal: ${d.heights}`
    );
  }
  // §8.4: truncation is the responsive fitting's FINAL step - nowhere else may a label
  // clip (authored truncate/line-clamp/overflow-hidden were removed for this).
  if (d.state !== 'trunc') {
    ok(d.labelEllipsis !== 'ellipsis', 'ellipsis outside trunc state');
    ok(d.labelOverflow !== 'hidden', 'label clipped outside trunc state');
  } else {
    ok(!fits || d.font === 12, 'trunc reached above the typography floor');
  }
  return checks;
}

/** Mount every About panel, run the real responsive fitting, set `window.__aboutPanels`. */
export async function mountAboutPanels() {
  await document.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (!document.getElementById('about-styles')) {
    const style = document.createElement('div');
    style.id = 'about-styles';
    style.innerHTML = STYLES;
    document.body.appendChild(style);
  }
  const grid = document.getElementById('aboutGrid');
  const all = {};
  // First pass: mount every row so locale stages sit side by side before any
  // verdict is read (identical layout conditions across panels).
  const mounted = [];
  for (const entry of CASES) {
    const panel = document.createElement('div');
    panel.className = 'panel';
    const dir = RTL.has(entry.lang) ? 'rtl' : 'ltr';
    panel.innerHTML = `
      <h2>${entry.id} - about ${entry.row} · ${entry.lang} · ${dir} · ${ROW_W}px <span class="verdict" id="v-${entry.id}">…</span></h2>
      <div class="about-stage" dir="${dir}" style="--about-font: ${BODY_FONT_FAMILY ?? 'system-ui'}"></div>
      <div class="meta"></div>`;
    grid.appendChild(panel);
    const stage = panel.querySelector('.about-stage');
    const row = document.createElement('div');
    row.id = `row${entry.id}`; // same convention as the nav panels' rows
    row.setAttribute('data-about-row', entry.row);
    row.setAttribute('data-action-tier', entry.tier);
    if (entry.row === 'toolbar') {
      row.setAttribute('role', 'toolbar');
      row.setAttribute('data-responsive-button-layout-interior', 'fit');
    }
    for (const el of entry.row === 'toolbar'
      ? toolbarButtons(entry.lang)
      : pillButtons(entry.lang)) {
      row.appendChild(el);
    }
    stage.appendChild(row);
    responsiveButtonLayout(row);
    mounted.push({ entry, panel, row });
  }
  // Second pass: measure + verdict AFTER the responsive fitting settles. The responsive fitting
  // evaluates on its own rAF loop (padding → coupled → font → trunc), so a
  // fixed 2-rAF wait measures an intermediate layout - the tier panels above
  // use the same 250ms settle for the same reason.
  await new Promise((resolve) => setTimeout(resolve, 250));
  for (const { entry, panel, row } of mounted) {
    const d = dumpRow(row);
    const failures = verify(entry, d);
    const verdictEl = panel.querySelector('.verdict');
    verdictEl.textContent = failures.length ? 'FAIL' : 'PASS';
    verdictEl.className = `verdict ${failures.length ? 'bad' : 'ok'}`;
    if (failures.length) verdictEl.title = failures.join('; ');
    panel.querySelector('.meta').textContent =
      `state=${d.state}  font=${d.font}px  pad=${d.pad}px  gap=${d.band}px  icon=${d.icon}px\n` +
      `widths=[${d.widths.join(', ')}]  gaps=[${d.gaps.join(', ')}]  row=${d.rowWidth}px\n` +
      `sum+gaps=${d.sumPlusGaps} ≤ ${d.rowWidth}  heights=[${d.heights.join(', ')}]`;
    all[entry.id] = {
      lang: entry.lang,
      row: entry.row,
      dir: RTL.has(entry.lang) ? 'rtl' : 'ltr',
      verdict: failures.length ? 'FAIL' : 'PASS',
      failures,
      measured: d,
    };
  }
  window.__aboutPanels = all;
  return all;
}
