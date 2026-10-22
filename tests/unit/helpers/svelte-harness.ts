/**
 * Minimal Svelte 5 + jsdom component-test harness.
 *
 * The repo has no component-test story: the UI layer (~half the codebase) was
 * only verifiable indirectly through unit tests on pure functions or the
 * Playwright e2e suite. This harness mounts real .svelte components in jsdom
 * so DOM-level assertions are possible for ProviderPill, AddressView, dialogs,
 * etc. - no new runtime dependencies (jsdom + svelte are already deps).
 *
 * How it works:
 *  1. `compile()` the .svelte source with svelte/compiler (client mode).
 *  2. Rewrite its import specifiers - `@/` and relative ones - into whatever each
 *     target needs: a recursively-compiled component, a re-emitted `.ts` barrel
 *     that re-exports components (Bun hands a bare `.svelte` import back as its
 *     own path, so a barrel's components must be compiled too), or a plain
 *     absolute file URL. Bare `svelte` imports are pointed at the client runtime
 *     for the same reason `mount()` is (see 3). Rewriting reads the source through
 *     `scripts/source-lexer`, so an import mentioned in a doc comment is prose.
 *     Artifacts land in `.wxt/component-test-modules/` (gitignored, content-hashed
 *     - the harness's own source is part of the hash, so a rule change recompiles
 *     automatically).
 *  3. Mount via the Svelte client runtime, imported directly from
 *     `node_modules/svelte/src/index-client.js` - the package `exports` map
 *     resolves `.` to the SERVER build under Bun (no `browser` condition), and
 *     the server build's `mount()` throws "lifecycle_function_unavailable".
 *  4. Stub the DOM APIs jsdom lacks that real components touch: `ResizeObserver`
 *     (every action row observes itself) next to the scheduling globals Svelte's
 *     client runtime needs (`requestAnimationFrame`, `getComputedStyle`, …).
 *
 * Components that touch `wxt/browser` need a mock registered BEFORE the first
 * `renderComponent()` call:
 *
 *   mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
 *
 * (bun's mock.module applies to the whole test-file process, and bun test runs
 * each file in its own process, so this cannot leak into sibling suites.)
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { compile } from 'svelte/compiler';
// The one classifier for "which bytes are code" - a doc comment that mentions an
// import is prose, and rewriting it made this harness compile a barrel into itself.
import { analyzeSource } from '../../../scripts/source-lexer';

const ROOT = resolve(import.meta.dirname, '../../..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, '.wxt', 'component-test-modules');
const SVELTE_CLIENT_URL = pathToFileURL(
  join(ROOT, 'node_modules', 'svelte', 'src', 'index-client.js')
).href;

let dom: JSDOM | null = null;

/** jsdom ships no matchMedia; every call site only reads `matches`. */
const matchMediaStub = (query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  onchange: null,
  dispatchEvent: () => false,
});

type MountFn = (
  component: unknown,
  options: { target: Element; props?: Record<string, unknown> }
) => unknown;

type UnmountFn = (component: unknown) => void;

let mountFn: MountFn | null = null;
let unmountFn: UnmountFn | null = null;

/** Install jsdom globals once per test file. Idempotent. */
export function setupDom(): void {
  if (dom) return;
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://example.test/',
  });
  const w = dom.window;
  // Bun's test preload installs a Web Locks shim on the original navigator.
  // Keep it when swapping in jsdom's navigator, or locked storage writes fail.
  const existingLocks = globalThis.navigator?.locks;
  if (existingLocks) {
    Object.defineProperty(w.navigator, 'locks', {
      configurable: true,
      value: existingLocks,
    });
  }
  // The full set of constructors Svelte 5's client runtime touches while
  // mounting (template cloning, async scheduling, effects, events).
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    navigator: w.navigator,
    HTMLElement: w.HTMLElement,
    Element: w.Element,
    Node: w.Node,
    Text: w.Text,
    Comment: w.Comment,
    Document: w.Document,
    DocumentFragment: w.DocumentFragment,
    DocumentType: w.DocumentType,
    ShadowRoot: w.ShadowRoot,
    Range: w.Range,
    DOMParser: w.DOMParser,
    HTMLMediaElement: w.HTMLMediaElement,
    HTMLImageElement: w.HTMLImageElement,
    HTMLInputElement: w.HTMLInputElement,
    HTMLButtonElement: w.HTMLButtonElement,
    HTMLDivElement: w.HTMLDivElement,
    HTMLSpanElement: w.HTMLSpanElement,
    HTMLTemplateElement: w.HTMLTemplateElement,
    HTMLStyleElement: w.HTMLStyleElement,
    HTMLAnchorElement: w.HTMLAnchorElement,
    HTMLLabelElement: w.HTMLLabelElement,
    HTMLFormElement: w.HTMLFormElement,
    HTMLSelectElement: w.HTMLSelectElement,
    HTMLTextAreaElement: w.HTMLTextAreaElement,
    SVGElement: w.SVGElement,
    SVGSVGElement: w.SVGSVGElement,
    CustomEvent: w.CustomEvent,
    Event: w.Event,
    MouseEvent: w.MouseEvent,
    KeyboardEvent: w.KeyboardEvent,
    InputEvent: w.InputEvent,
    MutationObserver: w.MutationObserver,
    // jsdom ships no ResizeObserver, and any action row mounting
    // `responsiveButtonLayout` observes itself with one - without this stub the mount
    // throws before a single DOM assertion can run.
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    // jsdom ships no matchMedia either; components check
    // `(prefers-reduced-motion: reduce)` before animating dialogs/FABs.
    // Assigned on the JSDOM WINDOW too (below) - call sites read
    // `window.matchMedia(...)`, not the bare global.
    matchMedia: matchMediaStub,
    getComputedStyle: w.getComputedStyle.bind(w),
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  });
  // `window.matchMedia` is read through the window object, so the stub must
  // land on the JSDOM window itself, not only on globalThis.
  if (!w.matchMedia) w.matchMedia = matchMediaStub;
}

/** Reset the DOM between tests in the same file. */
export function cleanupDom(): void {
  if (dom) dom.window.document.body.innerHTML = '';
}

/**
 * The harness's own compile/rewrite rules, hashed into every artifact's cache key:
 * the rules decide what a cached module CONTAINS, so editing them must invalidate
 * the cache. Keying on the component source alone left stale modules compiled under
 * the old rules in place - a rewritten import was simply never re-applied, and the
 * failure surfaced as an unrelated crash inside a component nobody had touched.
 */
const HARNESS_REVISION = createHash('sha1')
  .update(readFileSync(new URL(import.meta.url)))
  .digest('hex')
  .slice(0, 8);

/**
 * Rewrite the import specifiers that are CODE, leaving every other occurrence of the
 * same text alone.
 *
 * `src/ui/components/primitives/index.ts` documents itself with
 * `import { Btn } from '@/ui/components/primitives'` inside its header comment, and
 * a plain text rewrite of that line made this harness compile `index.ts` into itself
 * - 11 527 times - instead of compiling the components it re-exports. Offsets
 * survive the classification (comment bodies are blanked in place), so the rewrite
 * is applied to the untouched source. The `from` keyword is checked rather than the
 * specifier, because a specifier is *inside* a string by nature - a mention of
 * `from '…'` in a string literal is not an import either.
 */
function rewriteImports(source: string, rewrite: (spec: string) => string): string {
  const { code, inCode } = analyzeSource(source);
  let out = '';
  let cursor = 0;
  for (const match of code.matchAll(/from\s*(['"])([^'"]+)\1/g)) {
    if (inCode[match.index] !== 1) continue;
    const spec = match[2];
    const next = rewrite(spec);
    if (next === spec) continue;
    const start = match.index + match[0].length - spec.length - 1;
    out += source.slice(cursor, start) + next;
    cursor = start + spec.length;
  }
  return out + source.slice(cursor);
}

/**
 * Resolve an `@/`-aliased or relative import specifier to a real file, trying the
 * extensions a bundler would (`./Thing` → `Thing.ts` / `Thing/index.ts`).
 * `null` when nothing matches - a bare package specifier, or a path this harness
 * has no business rewriting.
 */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : resolve(dirname(fromFile), spec);
  // TS-style module resolution: this codebase (and Bun) write `./x.js` to mean
  // the `.ts` source beside it, so a `.js`-suffixed specifier also tries the
  // extensionless stem and the `.ts`/`.tsx` spellings - otherwise a left-alone
  // relative `.js` import fails at runtime from the OUT copy.
  const stem = base.endsWith('.js') ? base.slice(0, -3) : base;
  const candidates = [
    base,
    stem,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.js`,
    `${stem}.svelte`,
    join(stem, 'index.ts'),
    join(stem, 'index.js'),
    join(stem, 'index.svelte'),
  ];
  return candidates.find((p) => existsSync(p) && statSync(p).isFile()) ?? null;
}

/** A `.ts` module that (re-)exports `.svelte` components - a barrel. */
function reExportsComponents(file: string): boolean {
  return statSync(file).isFile() && /\.svelte['"]/.test(readFileSync(file, 'utf8'));
}

/** The import target to emit for a resolved file: components compile, barrels re-emit. */
function compiledTarget(absPath: string): string {
  if (absPath.endsWith('.svelte')) return pathToFileURL(compileComponent(absPath)).href;
  if (absPath.endsWith('.ts') && reExportsComponents(absPath)) {
    return pathToFileURL(compileTsModule(absPath)).href;
  }
  return pathToFileURL(absPath).href;
}

/**
 * Re-emit a `.ts` barrel that re-exports `.svelte` components
 * (`src/ui/components/primitives/index.ts`), with every component re-export
 * pointing at a compiled module.
 *
 * Bun imports `.svelte` natively as an ASSET: the "component" a barrel hands back
 * is its own file path, so mounting one dies with `Btn is not a function`. A barrel
 * therefore has to be copied and rewritten like a component is. The copy keeps the
 * `.ts` extension so Bun still strips types from whatever else the barrel exports.
 */
function compileTsModule(sourcePath: string): string {
  const content = readFileSync(sourcePath, 'utf8');
  const hash = createHash('sha1')
    .update(`${HARNESS_REVISION}\0${sourcePath}\0${content}`)
    .digest('hex')
    .slice(0, 12);
  const outPath = join(OUT, `${hash}.ts`);
  if (existsSync(outPath)) return outPath;

  // The copy lives in OUT, so every local specifier becomes absolute - a relative
  // one would resolve against the wrong directory.
  const code = rewriteImports(content, (spec) => {
    if (!spec.startsWith('@/') && !spec.startsWith('.')) return spec;
    const target = resolveSpecifier(sourcePath, spec);
    return target ? compiledTarget(target) : spec;
  });

  mkdirSync(OUT, { recursive: true });
  writeFileSync(outPath, code);
  return outPath;
}

function compileComponent(sourcePath: string): string {
  const content = readFileSync(sourcePath, 'utf8');
  const hash = createHash('sha1')
    .update(`${HARNESS_REVISION}\0${sourcePath}\0${content}`)
    .digest('hex')
    .slice(0, 12);
  const outPath = join(OUT, `${hash}.mjs`);
  if (existsSync(outPath)) return outPath;

  const { js } = compile(content, {
    generate: 'client',
    filename: sourcePath,
    css: 'injected',
  });
  // Every specifier is resolved the same way, in one pass: a `@/` alias or a
  // relative path becomes whatever it needs to be - a compiled component, a
  // re-emitted barrel (see `compileTsModule`), or a plain absolute file URL that
  // Bun imports natively (pathToFileURL keeps Windows backslashes out). Bare
  // package specifiers are left to Bun, with one exception: a bare `from 'svelte'`
  // resolves to the SERVER build (the package exports map has no `browser`
  // condition), and a component that calls `onMount` / `onDestroy` - every dialog
  // does - then throws "ssr_context is null" before it renders.
  const code = rewriteImports(js.code, (spec) => {
    if (spec === 'svelte') return SVELTE_CLIENT_URL;
    if (!spec.startsWith('@/') && !spec.startsWith('.')) return spec;
    const target = resolveSpecifier(sourcePath, spec);
    return target ? compiledTarget(target) : spec;
  });

  mkdirSync(OUT, { recursive: true });
  writeFileSync(outPath, code);
  return outPath;
}

export interface RenderedComponent {
  /** The container the component mounted into. Query it for DOM assertions. */
  target: HTMLDivElement;
  /** The mounted component instance. */
  instance: unknown;
}

/**
 * Compile + mount a component by path relative to the project root
 * (e.g. `src/ui/components/primitives/ProviderPill.svelte`).
 */
async function getClient(): Promise<{ mount: MountFn; unmount: UnmountFn }> {
  if (mountFn && unmountFn) return { mount: mountFn, unmount: unmountFn };
  const client = (await import(SVELTE_CLIENT_URL)) as { mount: MountFn; unmount: UnmountFn };
  mountFn = client.mount;
  unmountFn = client.unmount;
  return client;
}

export async function renderComponent(
  relPath: string,
  props: Record<string, unknown> = {}
): Promise<RenderedComponent> {
  setupDom();
  const { mount } = await getClient();
  const sourcePath = join(ROOT, relPath);

  // Some dependency may have changed (e.g. a function moved out of a .ts
  // file) while the .svelte source hash stayed the same - the cached .mjs
  // still references the old import. Retry once with a fresh compile.
  let mod: { default: unknown };
  let modPath = compileComponent(sourcePath);
  try {
    mod = (await import(pathToFileURL(modPath).href)) as { default: unknown };
  } catch {
    // Stale compiled artifact - delete, recompile, retry.
    try {
      unlinkSync(modPath);
    } catch {
      /* ignore */
    }
    modPath = compileComponent(sourcePath);
    mod = (await import(pathToFileURL(modPath).href)) as { default: unknown };
  }

  const target = document.createElement('div');
  document.body.appendChild(target);
  const instance = mount(mod.default, { target, props });
  // Flush effects + microtasks so text/title/state are settled before asserting.
  await new Promise((r) => setTimeout(r, 0));
  return { target, instance };
}

/** Unmount a previously mounted component (runs effect cleanups, stops timers). */
export async function unmountComponent(instance: unknown): Promise<void> {
  const { unmount } = await getClient();
  unmount(instance);
}
