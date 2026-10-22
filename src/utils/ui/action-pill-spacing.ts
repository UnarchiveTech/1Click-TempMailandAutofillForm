/**
 * action-pill-spacing.ts - GAPPING-ONLY spacing rule for action pills.
 *
 * Rule (AGENTS.md Rule 8 companion): when a pill's icon↔label gap is LARGER
 * than its left/right padding, the three inner bands look unbalanced - the
 * label sits far from the icon while the pill edges stay tight. In that case
 * the pill's own inner budget is redistributed EQUALLY, so
 * `padL == gap == padR`:
 *
 *     budget = padLeft + gap + padRight   (2·pad + gap when symmetric)
 *     X      = budget / 3
 *
 * The pill keeps its exact width (3·X == budget), so nothing else changes.
 *
 * When padding is already >= the gap (the normal authored case, e.g.
 * pad 10 / gap 6), the pill is left EXACTLY as authored - no overrides.
 *
 * CRITICAL CONSTRAINTS:
 * - This helper NEVER changes font sizes or row-fit decisions (that stays
 *   with fitActionButtonsLayout → --action-btn-font / the responsive fitting).
 * - It NEVER touches icon wrappers / `.btn-icon` boxes / disc backgrounds,
 *   and never overrides flex-grow, justify-content, or row gaps. Those are
 *   design-owned.
 * - Tighten-on-overflow is the only extra: if a row overflows AFTER the rule
 *   (a fitter picked a font a hair too large for the real content), all three
 *   bands shrink equally - pad == gap preserved - until it fits (1px floor).
 *
 * Usage (any future block - responsive fitting action OR plain fitter):
 *     applyPillSpacing(rowEl);   // call again whenever the row re-renders
 */

/** Equalized uniform band: `X = (padLeft + gap + padRight) / 3`. */
export function uniformPillSpace(padBase: number, gapBase: number): number {
  if (padBase <= 0 || gapBase <= 0) return 0;
  return (padBase * 2 + gapBase) / 3;
}

interface ButtonBases {
  left: number;
  right: number;
  gap: number;
}

const rowBases = new WeakMap<HTMLElement, ButtonBases[]>();

function getBases(row: HTMLElement, buttons: HTMLElement[]): ButtonBases[] {
  const cached = rowBases.get(row);
  if (cached) return cached;
  const per = buttons.map((b): ButtonBases => {
    const s = getComputedStyle(b);
    const left = parseFloat(s.paddingLeft);
    const right = parseFloat(s.paddingRight);
    const gap = parseFloat(s.columnGap || s.rowGap || s.gap || '0');
    return {
      left: Number.isFinite(left) && left > 0 ? left : 0,
      right: Number.isFinite(right) && right > 0 ? right : 0,
      gap: Number.isFinite(gap) && gap > 0 ? gap : 0,
    };
  });
  rowBases.set(row, per);
  return per;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Apply the pill-spacing rule to a row. Only acts on pills whose authored
 * icon↔label gap is LARGER than their left/right padding; those get
 * `padL == gap == padR == X`. Everything else is left untouched.
 */
export function applyPillSpacing(row: HTMLElement): void {
  const buttons = Array.from(row.querySelectorAll<HTMLElement>('button, a, [role="button"]'));
  if (!buttons.length) return;
  const bases = getBases(row, buttons);

  for (const [i, b] of buttons.entries()) {
    const base = bases[i];
    if (!base) continue;
    const pad =
      base.left > 0 && base.right > 0
        ? Math.min(base.left, base.right)
        : base.left > 0
          ? base.left
          : base.right;
    if (pad <= 0 || base.gap <= 0) continue;
    // Rule applies only when the gap is LARGER than the padding.
    if (base.gap <= pad) continue;

    const x = uniformPillSpace(pad, base.gap);
    if (x <= 0) continue;
    b.style.paddingLeft = `${round2(x)}px`;
    b.style.paddingRight = `${round2(x)}px`;
    b.style.gap = `${round2(x)}px`;
  }

  // Tighten-on-overflow: if the row still overflows, shrink every pill's
  // bands equally - pad == gap preserved - until it fits. Gapping-only,
  // fonts untouched, 1px floor.
  let pass = 0;
  while (row.scrollWidth > row.clientWidth + 0.5 && pass < 40) {
    pass += 1;
    for (const b of buttons) {
      const pad = parseFloat(b.style.paddingLeft);
      const gap = parseFloat(b.style.gap);
      const cur = Number.isFinite(pad) && pad > 0 ? pad : Number.isFinite(gap) && gap > 0 ? gap : 0;
      if (cur <= 0) continue;
      const next = Math.max(1, round2(cur - 0.25));
      if (Number.isFinite(pad) && pad > 0) b.style.paddingLeft = `${next}px`;
      if (Number.isFinite(pad) && pad > 0) b.style.paddingRight = `${next}px`;
      if (Number.isFinite(gap) && gap > 0) b.style.gap = `${next}px`;
    }
  }
}
