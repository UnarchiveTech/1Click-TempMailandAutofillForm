/**
 * Regenerate `tests/visual/preview-responsive-button-layout-module.js` from the real modules.
 *
 *   bun run generate-responsive-button-layout-module
 *   bun run check-responsive-button-layout-module      # fails when the artifact is stale
 *
 * The responsive fitting visual harness (`tests/visual/preview-responsive-button-layout.html`, driven by
 * `bun run check:responsive-button-layout`, `check:responsive-button-layout:webkit` and `check:responsive-button-layout:firefox`)
 * must run the code the extension ships. It used to import a hand-committed
 * bundle that nobody regenerated, so it verified whatever the responsive fitting looked
 * like the day that file was written - exactly the "second copy of the truth"
 * failure the harness exists to prevent. Same pattern as the locale messages: a
 * generated artifact that is committed (so the page opens in a plain browser)
 * plus a check that fails when it drifts from its sources.
 *
 * The nav and About strings are extracted from `src/locales/*.json` here rather
 * than imported by the entry, so the preview renders the REAL translations while
 * the artifact stays a few KB instead of inlining eight dictionaries.
 */

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NAV_LABEL_KEYS } from '../src/utils/ui/nav-layout.js';
import { collectAbsoluteFiles } from './source-files';

const ROOT = path.resolve(import.meta.dir, '..');
const ENTRY = path.join(ROOT, 'tests/visual/preview-responsive-button-layout-entry.ts');
const OUT = path.join(ROOT, 'tests/visual/preview-responsive-button-layout-module.js');
const BUNDLE_ENTRY_DIR = path.dirname(ENTRY);
const packageManager: unknown = JSON.parse(
  readFileSync(path.join(ROOT, 'package.json'), 'utf8')
).packageManager;
const REQUIRED_BUN_VERSION =
  typeof packageManager === 'string'
    ? /^bun@(\d+\.\d+\.\d+)$/.exec(packageManager)?.[1]
    : undefined;

if (!REQUIRED_BUN_VERSION) {
  throw new Error('package.json must pin packageManager to an exact bun@x.y.z version.');
}

if (Bun.version !== REQUIRED_BUN_VERSION) {
  console.error(
    `responsive fitting preview generation requires Bun ${REQUIRED_BUN_VERSION}; found ${Bun.version}. Update the pin and regenerate together.`
  );
  process.exit(1);
}

const BANNER = `// GENERATED FILE - do not edit.\n// Source: tests/visual/preview-responsive-button-layout-entry.ts (bun run generate-responsive-button-layout-module)\n// Bun: ${REQUIRED_BUN_VERSION}\n`;

/**
 * The `src/locales/*.json` dictionaries, resolved through the shared lister (see
 * `scripts/source-files.ts`): gitignored files are skipped, and `flat` keeps the
 * generated `locales/background/*.json` minimal sets out of the preview module.
 */
function localeFiles(): string[] {
  return collectAbsoluteFiles(path.join(ROOT, 'src/locales'), ['.json'], { flat: true });
}

/**
 * The About strings the preview renders. The AboutView action rows carry more
 * labels than the nav - nine keys across four namespaces - but the same rule
 * applies: the panels must render the REAL translations so the responsive fitting fits
 * the strings the extension ships, while the artifact stays a few KB.
 */
const ABOUT_LABEL_KEYS = [
  'about.sourceCode',
  'about.demo',
  'about.website',
  'diagnostics.title',
  'about.storeChrome',
  'about.storeFirefox',
  'about.reportIssue',
  'productTour.replay',
  'nav.keyboardShortcuts',
  'about.documentation',
] as const;

/** The About strings the preview renders, read from src/locales/*.json. */
function aboutLabelsSource(): string {
  const perLocale: Record<string, Record<string, string>> = {};
  for (const abs of localeFiles()) {
    const lang = path.basename(abs, '.json');
    const dict = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const key of ABOUT_LABEL_KEYS) {
      const value = key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          dict
        );
      if (typeof value === 'string') values[key] = value;
    }
    perLocale[lang] = values;
  }
  return `\n// Generated from src/locales/*.json - do not edit.\nexport const ABOUT_LABELS = ${JSON.stringify(perLocale, null, 2)};\n`;
}

/** The nav strings the preview renders: every flag's label key, plus More. */
function navLabelsSource(): string {
  const perLocale: Record<string, Record<string, string>> = {};
  for (const abs of localeFiles()) {
    const lang = path.basename(abs, '.json');
    const dict = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const { labelKey } of NAV_LABEL_KEYS) {
      const value = labelKey
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          dict
        );
      if (typeof value === 'string') values[labelKey] = value;
    }
    perLocale[lang] = values;
  }
  return `\n// Generated from src/locales/*.json - do not edit.\nexport const NAV_LABELS = ${JSON.stringify(perLocale, null, 2)};\n`;
}

/**
 * Bun can defer named re-exports that have no importer. The preview entry is a
 * re-export surface, so bundle a short-lived consumer that imports every
 * exported name and keeps the references in an exported array. This gives the
 * bundler a real consumer while leaving the checked-in entry readable.
 */
function createBundleConsumerSource(): { source: string; exportNames: string[] } {
  const entrySource = readFileSync(ENTRY, 'utf8');
  const reExportPattern = /export\s*\{([\s\S]*?)\}\s*from\s*(['"])([^'"]+)\2\s*;/g;
  const matches = [...entrySource.matchAll(reExportPattern)];
  if (matches.length === 0) {
    throw new Error('responsive fitting preview entry has no named re-exports to bundle');
  }

  const entryWithoutComments = entrySource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  if (entryWithoutComments.replace(reExportPattern, '').match(/\bexport\b/)) {
    throw new Error(
      'responsive fitting preview entry contains an unsupported non-re-export export'
    );
  }

  const exportNames: string[] = [];
  const importSpecifiers: string[] = [];
  const exportSpecifiers: string[] = [];
  const retainedLocals: string[] = [];

  for (const match of matches) {
    const names = match[1]
      .split(',')
      .map((specifier) => specifier.trim())
      .filter(Boolean);

    for (const specifier of names) {
      const parsed = specifier.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
      if (!parsed) {
        throw new Error(`unsupported responsive fitting preview export specifier: ${specifier}`);
      }

      const exportedName = parsed[2] ?? parsed[1];
      const localName = `__responsiveButtonLayoutExport${exportNames.length}`;
      exportNames.push(exportedName);
      importSpecifiers.push(`${parsed[1]} as ${localName}`);
      exportSpecifiers.push(`${localName} as ${exportedName}`);
      retainedLocals.push(localName);
    }
  }

  if (new Set(exportNames).size !== exportNames.length) {
    throw new Error('responsive fitting preview entry exports a name more than once');
  }

  const source = [
    `import { ${importSpecifiers.join(', ')} } from './preview-responsive-button-layout-entry.ts';`,
    `export { ${exportSpecifiers.join(', ')} };`,
    `export const __responsiveButtonLayoutBundleKeepAlive = [${retainedLocals.join(', ')}];`,
    '',
  ].join('\n');

  return { source, exportNames };
}

/**
 * The artifact exactly as it would be written. Bun's output is deterministic, so
 * the `--check` comparison is exact; the file is excluded from Biome (it is a
 * generated bundle, not hand-formatted source - see biome.json's `files.includes`).
 */
async function buildModule(): Promise<string> {
  const { source, exportNames } = createBundleConsumerSource();
  const bundleEntry = path.join(
    BUNDLE_ENTRY_DIR,
    '.preview-responsive-button-layout-bundle-entry.ts'
  );

  writeFileSync(bundleEntry, source, 'utf8');
  let bundledSource: string;
  try {
    const result = await Bun.build({
      entrypoints: [bundleEntry],
      target: 'browser',
      format: 'esm',
      minify: false,
      // The app's modules import through the `@/` alias; the entry uses relative
      // paths, but everything it pulls in must resolve the way the extension does
      // (Bun reads the `paths` mapping from the project's tsconfig).
      tsconfig: path.join(ROOT, 'tsconfig.json'),
    });
    if (!result.success) {
      for (const log of result.logs) console.error(log);
      throw new Error('responsive fitting module bundle failed');
    }
    bundledSource = await result.outputs[0].text();
  } finally {
    unlinkSync(bundleEntry);
  }

  const declaredNames = new Set(
    [...bundledSource.matchAll(/\b(?:function|class|var|let|const)\s+([\w$]+)/g)].map(
      (match) => match[1]
    )
  );
  const missingDefinitions = exportNames.filter((name) => !declaredNames.has(name));
  if (missingDefinitions.length > 0) {
    throw new Error(
      `responsive fitting module bundle omitted definitions for: ${missingDefinitions.join(', ')}`
    );
  }

  return BANNER + bundledSource + navLabelsSource() + aboutLabelsSource();
}

const expected = await buildModule();
const existing = Bun.file(OUT);
const current = (await existing.exists()) ? await existing.text() : null;

if (current === expected) {
  console.log('✔ responsive fitting preview module is up to date with its sources');
} else if (process.argv.includes('--check')) {
  console.error(
    '✗ tests/visual/preview-responsive-button-layout-module.js is stale - run: bun run generate-responsive-button-layout-module'
  );
  process.exit(1);
} else {
  await Bun.write(OUT, expected);
  console.log(
    `✔ wrote tests/visual/preview-responsive-button-layout-module.js (${expected.length} bytes)`
  );
}
