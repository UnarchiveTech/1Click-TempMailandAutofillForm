#!/usr/bin/env bun
/**
 * i18n visual-fit scanner
 *
 * Design baseline = English. For each other locale, estimates text width and
 * reports whether labels fit slot budgets (or EN × growth factor).
 *
 * Usage:
 *   bun run check-i18n-fit              # human report (exit 0 unless --strict)
 *   bun run check-i18n-fit --strict     # exit 1 if any budgeted key overflows
 *   bun run check-i18n-fit --budgeted   # only keys in FIT_BUDGETS
 *   bun run check-i18n-fit --json out.json
 *   bun run check-i18n-fit --locale de  # one locale
 *   bun run check-i18n-fit --overflow-only
 *
 * Metrics are approximate (Unicode-aware system-ui model), for CI/layout
 * review - not a substitute for real browser layout.
 */

import { FIT_BUDGETS } from '../src/utils/i18n-fit-budgets';
import { type FitRow, flattenLocale, scanLocaleFit } from '../src/utils/i18n-fit-scan';

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}
function getArg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return args[i + 1];
}

const STRICT = hasFlag('strict');
const BUDGETED_ONLY = hasFlag('budgeted');
const OVERFLOW_ONLY = hasFlag('overflow-only');
const GROWTH = Number(getArg('growth') ?? '1.4');
const LOCALE_FILTER = getArg('locale');
const JSON_OUT = getArg('json') ?? (hasFlag('report') ? 'i18n-fit-report.json' : undefined);
const TOP = Number(getArg('top') ?? '40');

const LOCALES_DIR = `${import.meta.dir}/../src/locales`;
const SOURCE = 'en';

const useColour = process.stdout.isTTY;
const red = (s: string) => (useColour ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s: string) => (useColour ? `\x1b[33m${s}\x1b[0m` : s);
const green = (s: string) => (useColour ? `\x1b[32m${s}\x1b[0m` : s);
const dim = (s: string) => (useColour ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (useColour ? `\x1b[1m${s}\x1b[0m` : s);

// ─── Load ────────────────────────────────────────────────────────────────────

const files = (await Array.fromAsync(new Bun.Glob('*.json').scan(LOCALES_DIR))).sort();
if (!files.includes(`${SOURCE}.json`)) {
  console.error(red(`Missing source locale ${SOURCE}.json`));
  process.exit(1);
}

const enData = (await Bun.file(`${LOCALES_DIR}/${SOURCE}.json`).json()) as Record<string, unknown>;
const en = flattenLocale(enData);

const localeFiles = files.filter((f) => f !== `${SOURCE}.json`);
const locales: Record<string, Map<string, string>> = {};

for (const file of localeFiles) {
  const code = file.replace(/\.json$/, '');
  if (LOCALE_FILTER && code !== LOCALE_FILTER) continue;
  const data = (await Bun.file(`${LOCALES_DIR}/${file}`).json()) as Record<string, unknown>;
  locales[code] = flattenLocale(data);
}

if (Object.keys(locales).length === 0) {
  console.error(red(LOCALE_FILTER ? `Locale not found: ${LOCALE_FILTER}` : 'No locales found'));
  process.exit(1);
}

const result = scanLocaleFit(en, locales, {
  growthFactor: Number.isFinite(GROWTH) ? GROWTH : 1.4,
  budgetedOnly: BUDGETED_ONLY,
  includeStatuses: OVERFLOW_ONLY ? ['overflow'] : undefined,
});

// ─── Report file ─────────────────────────────────────────────────────────────

if (JSON_OUT) {
  const payload = {
    generatedAt: new Date().toISOString(),
    growthFactor: GROWTH,
    budgetedOnly: BUDGETED_ONLY,
    budgetKeyCount: Object.keys(FIT_BUDGETS).length,
    summary: result.summary,
    rows: result.rows.map((r) => ({
      key: r.key,
      locale: r.locale,
      status: r.status,
      enText: r.enText,
      localeText: r.localeText,
      enWidth: r.enWidth,
      localeWidth: r.localeWidth,
      maxWidth: r.maxWidth,
      freeSpace: r.freeSpace,
      deltaVsEn: r.deltaVsEn,
      budgetSource: r.budgetSource,
      hasSlotBudget: r.hasSlotBudget,
    })),
  };
  await Bun.write(JSON_OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(dim(`Wrote ${JSON_OUT}`));
}

// ─── Console ─────────────────────────────────────────────────────────────────

console.log(`\n${bold('=== i18n fit scanner ===')}`);
console.log(
  dim(
    `Baseline: English · growth: ×${GROWTH} · slot budgets: ${Object.keys(FIT_BUDGETS).length} · method: approximate system-ui widths`
  )
);
console.log(
  `Locales: ${result.summary.locales.join(', ')} · compared: ${result.summary.totalCompared}`
);

if (result.summary.orphanBudgets.length > 0) {
  console.log(
    yellow(`\nOrphan budget keys (not in en.json): ${result.summary.orphanBudgets.join(', ')}`)
  );
}

const overflows = result.rows.filter((r) => r.status === 'overflow');
const tights = result.rows.filter((r) => r.status === 'tight');
const budgetOverflows = overflows.filter((r) => r.hasSlotBudget);

function printRow(r: FitRow) {
  const free =
    r.freeSpace >= 0 ? green(`free +${r.freeSpace}px`) : red(`overflow ${-r.freeSpace}px`);
  const slot = r.hasSlotBudget ? 'slot' : 'en×g';
  const delta = r.deltaVsEn >= 0 ? `+${r.deltaVsEn}` : `${r.deltaVsEn}`;
  console.log(
    `  ${r.status === 'overflow' ? red('OVERFLOW') : yellow('TIGHT   ')}  ${r.locale.padEnd(3)}  ${r.key}`
  );
  console.log(
    dim(
      `           "${r.enText}" → "${r.localeText}"  en=${r.enWidth}px loc=${r.localeWidth}px max=${r.maxWidth ?? '-'}px (${slot}) Δen ${delta}px  ${free}`
    )
  );
}

if (overflows.length > 0) {
  console.log(`\n${bold(red(`Overflow (${overflows.length})`))} - does not fit budget`);
  for (const r of overflows.slice(0, TOP)) printRow(r);
  if (overflows.length > TOP) {
    console.log(dim(`  … and ${overflows.length - TOP} more (use --json to export all)`));
  }
}

if (!OVERFLOW_ONLY && tights.length > 0) {
  console.log(`\n${bold(yellow(`Tight (${tights.length})`))} - fits with < 8px free`);
  for (const r of tights.slice(0, Math.min(15, TOP))) printRow(r);
  if (tights.length > 15) {
    console.log(dim(`  … and ${tights.length - 15} more`));
  }
}

console.log(`\n${bold('=== Summary ===')}`);
console.log(`  OK        : ${green(String(result.summary.ok))}`);
console.log(`  Tight     : ${tights.length > 0 ? yellow(String(result.summary.tight)) : '0'}`);
console.log(
  `  Overflow  : ${overflows.length > 0 ? red(String(result.summary.overflow)) : green('0')}`
);
console.log(
  `  Budgeted  : ${result.summary.budgetedCompared} compared, ${
    budgetOverflows.length > 0
      ? red(`${result.summary.budgetedOverflow} overflow`)
      : green('0 overflow')
  }`
);

if (STRICT) {
  if (result.summary.budgetedOverflow > 0) {
    console.log(
      `\n${red(bold(`✗ Strict: ${result.summary.budgetedOverflow} budgeted key(s) overflow. Fix translations or raise FIT_BUDGETS.`))}\n`
    );
    process.exit(1);
  }
  if (result.summary.orphanBudgets.length > 0) {
    console.log(
      `\n${red(bold(`✗ Strict: orphan budget keys must be fixed in i18n-fit-budgets.ts`))}\n`
    );
    process.exit(1);
  }
  console.log(`\n${green(bold('✓ Strict: all budgeted keys fit.'))}\n`);
  process.exit(0);
}

if (budgetOverflows.length > 0) {
  console.log(
    `\n${yellow(
      `Budgeted overflows found (non-strict). Re-run with --strict to fail CI, or --budgeted --overflow-only for a short list.`
    )}\n`
  );
} else {
  console.log(`\n${green(bold('No budgeted overflows.'))}\n`);
}

process.exit(0);
