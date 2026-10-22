/**
 * check-storage-rmw.ts - flags an UNSERIALIZED whole-key read-modify-write.
 *
 * WHAT IT CATCHES
 *
 * `browser.storage.local.set({ K: … })` REPLACES the whole value of K. So a flow
 * that reads K, mutates what it read, and writes K back has a lost update in it:
 * two such flows - two panes, two handlers, or one debounced flush racing a bulk
 * action - each read the same pre-state and the second write silently erases the
 * first. That is the class `@/utils/storage/rmw.ts` exists for (`readEmails`
 * bulk marks vs. the debounced flush, `starredEmails` toggles, the OTP domain
 * lists, `automationRules`, the tag catalog), and the reason its docstring says
 * the fix belongs in a helper rather than at each call site.
 *
 * The rule is deliberately about DATA FLOW, not proximity. A file that reads K
 * into state and later writes a fresh value for K is fine - that is a plain
 * preference write (`uiDensity`, `showImages`, …). What is a finding is a write
 * whose VALUE for K is derived from K's own read:
 *
 *   const res = await storage.local.get(['notificationSnoozeByAddress']);
 *   const map = { ...(res.notificationSnoozeByAddress || {}) };   // ← derived
 *   map[addr] = until;
 *   await storage.local.set({ notificationSnoozeByAddress: map }); // ← finding
 *
 * The storage layer's retrying primitive counts as the SAME write
 * (`writeWithRetry({ K: map })` → finding too): it wraps one whole-key write in
 * a backoff, so it can lose an update exactly like the raw call - and if the
 * gate only knew the raw spelling, routing a site through the wrapper would
 * quietly retire its finding instead of fixing it.
 *
 * THE EXEMPTION THAT MATTERS
 *
 * A pair already inside one `withLock('…')` / `updateStoredObject('…')` callback
 * is serialized by construction - that IS the fix, so the gate reads those call
 * spans and stays silent. Everything else - a fresh value, a literal, a function
 * parameter, a write that precedes the read, a binding that is out of scope at
 * the write site - is not this bug and is never reported.
 *
 * WHAT IT CANNOT SEE (stated because the gate is a ratchet, not a proof)
 *
 *  - **Keys it cannot resolve.** Only a string literal, or a file-local
 *    `const KEY = 'literal'` (optionally `const KEY: string = 'literal'`), names
 *    a key. A key that arrives as a parameter or is built dynamically is skipped,
 *    and the count is printed so the blind spot is visible rather than implied.
 *  - **Cross-function state hand-off** (`load()` → view state → `save(list)`
 *    where `list` is a parameter) is not tracked: the binding is not visible at
 *    the write site, so it is not reported. Real lost updates can hide there;
 *    this gate closes the in-file shape, which is where every one that shipped
 *    actually lived.
 *  - **Cross-CONTEXT races.** `updateStoredObject` serializes one JS context. Two
 *    documents (popup + side panel + app tab) that both write one key need the
 *    background to own the write; that is a design decision no in-file scan can
 *    make, so `--` the message names the two legal shapes and leaves the choice
 *    to the author.
 *
 * PRE-EXISTING SITES are listed in `scripts/baselines/storage-rmw.txt` as `<path><TAB><key>`
 * rows - a ratchet: a finding that is not listed fails, and a row whose site was
 * fixed also fails until it is removed with `--update`. The list may only shrink.
 *
 * Usage: bun scripts/check-storage-rmw.ts [--update] [--list]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectAbsoluteFiles, REPO_ROOT } from './source-files';
import { analyzeSource, codeOnly } from './source-lexer';

const SRC_DIR = join(process.cwd(), 'src');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'baselines', 'storage-rmw.txt');

/** One reported site: the key, where it was read, and where it was written back. */
export interface RmwSite {
  /** The whole key that is read, mutated and written back. */
  key: string;
  /** 1-based line of the read that the written value is derived from. */
  readLine: number;
  /** 1-based line of the `set` that writes the whole key. */
  writeLine: number;
  /** The written value expression, for an actionable message. */
  value: string;
}

/** What one file's scan produced, including what it could not analyse. */
export interface FileScan {
  sites: RmwSite[];
  /** `get` sites whose KEY is a parameter or built dynamically. */
  unresolvedKey: number;
  /** `get` sites whose result is not bound to a name (nothing to trace). */
  unbound: number;
  /** Those same sites as `<line> get(<fragment>) - <why>`, so the blind spot is visible. */
  unanalysed: string[];
  /** Read/write pairs that are already inside a serialization callback. */
  serialized: number;
}

interface Analysis {
  /** Comments blanked, strings intact - what keys and expressions are read from. */
  text: string;
  /** Syntax only: strings, templates, regexes and comments blanked. */
  structural: string;
  /** 1 for bytes that are code (not comment, string text, or regex body). */
  inCode: Uint8Array;
}

function analyse(raw: string): Analysis {
  const { code, inCode } = analyzeSource(raw);
  return { text: code, structural: codeOnly(raw), inCode };
}

const IDENTIFIER_RE = /[A-Za-z_$][\w$]*/g;

/** Every identifier mentioned in an expression. */
function identifiersIn(expr: string): string[] {
  return [...expr.matchAll(IDENTIFIER_RE)].map((m) => m[0]);
}

/** `index` → its 1-based line, counted in the same-length analysed text. */
function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** The index of the `)` matching the `(` at `open`, or -1. */
function matchingParen(structural: string, open: number): number {
  let depth = 0;
  for (let i = open; i < structural.length; i++) {
    if (structural[i] === '(') depth++;
    else if (structural[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The index of the `}` matching the `{` at `open`, or -1. */
function matchingBrace(structural: string, open: number): number {
  let depth = 0;
  for (let i = open; i < structural.length; i++) {
    if (structural[i] === '{') depth++;
    else if (structural[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Every `{…}` pair in the file, outermost first - the raw material for both the
 * function-scope question and the `withLock` span question.
 */
function bracePairs(structural: string): Array<{ open: number; close: number }> {
  const stack: number[] = [];
  const pairs: Array<{ open: number; close: number }> = [];
  for (let i = 0; i < structural.length; i++) {
    if (structural[i] === '{') stack.push(i);
    else if (structural[i] === '}') {
      const open = stack.pop();
      if (open !== undefined) pairs.push({ open, close: i });
    }
  }
  return pairs.sort((a, b) => a.open - b.open);
}

/**
 * The `)` closing the parameter list of the signature whose body braces open at
 * `k`, walking back over an optional `: ReturnType` annotation.
 *
 * A plain `) { … }` is already the answer; TypeScript's `): Promise<T> { … }`
 * puts the annotation in between, and reading `k` as "not a `)`, so not a
 * signature" made the WHOLE body invisible as a scope - which is how a write of
 * a same-named parameter in the NEXT function got tainted by this one's read
 * (`storage-keys.ts`'s `getAnalyticsRecord` / `setAnalyticsRecord` pair, two of
 * the baseline rows). Returns -1 when `k` ends no signature at all (`else {`,
 * `try {`, an object literal).
 *
 * The walk crosses the characters a return TYPE is spelled with, so `void`,
 * `Promise<T>`, `Record<string, number>` and `Array<T | null>` all land on the
 * `)`. A `{ … }` type LITERAL stops it (a `{` cannot be told from a block
 * going backwards) - those signatures are still recognised by the `function`
 * keyword above, which is the shape a type literal actually appears in.
 */
function paramListClose(structural: string, k: number): number {
  let i = k;
  // Every character a return type is spelled with - the walk stops on the `:`
  // that introduces the annotation, or on a `)` when there is none.
  while (i >= 0 && /[\sA-Za-z0-9_$.<>,|&[\]['"?!]/.test(structural[i])) i--;
  if (i < 0) return -1;
  if (structural[i] !== ':') return structural[i] === ')' ? i : -1;
  i--;
  while (i >= 0 && /\s/.test(structural[i])) i--;
  return structural[i] === ')' ? i : -1;
}

/** True when the `{` at `open` starts a function body (`) {`, `=> {`, `{ … `). */
function isFunctionBody(structural: string, open: number): boolean {
  let k = open - 1;
  while (k >= 0 && /\s/.test(structural[k])) k--;
  if (k < 0) return false;
  const before = structural.slice(Math.max(0, k - 40), k + 1);
  if (/\bfunction\b/.test(before)) return true;
  if (structural.slice(k - 1, k + 1) === '=>') return true;
  // A method or callback: the brace follows the closing `)` of an argument list.
  const closeParen = paramListClose(structural, k);
  if (closeParen === -1) return false;
  const openParen = (() => {
    let depth = 0;
    for (let i = closeParen; i >= 0; i--) {
      if (structural[i] === ')') depth++;
      else if (structural[i] === '(') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  })();
  if (openParen === -1) return false;
  // `if (…) {`, `for (…) {`, `while (…) {`, `catch (…) {` are BLOCKS, not scopes
  // for our purpose - treat them as transparent (they do not rebind names).
  const header = structural.slice(Math.max(0, openParen - 12), openParen).trimEnd();
  return !/(^|\W)(if|for|while|switch|catch)$/.test(header);
}

/**
 * The function body a byte sits in, as an offset range, or null at the file's
 * top level (a `<script>` body, a module body). Used to decide whether a binding
 * is still in scope - a name bound inside one function is NOT the same name in
 * the next one, which is exactly how a destructured alias (`selectedProvider:
 * provider`) collides with an unrelated parameter at another call site.
 */
function scopeAt(
  structural: string,
  pairs: Array<{ open: number; close: number }>,
  index: number
): { open: number; close: number } | null {
  let best: { open: number; close: number } | null = null;
  for (const pair of pairs) {
    if (pair.open < index && index < pair.close && isFunctionBody(structural, pair.open)) {
      if (!best || pair.open > best.open) best = pair;
    }
  }
  return best;
}

const sameScope = (
  a: { open: number; close: number } | null,
  b: { open: number; close: number } | null
): boolean => (a === null && b === null) || (a !== null && b !== null && a.open === b.open);

/**
 * The `withLock` / `updateStoredObject` call spans in a file. A read and a write
 * inside the SAME span are already serialized - that is the fix, not the bug.
 */
function serializedSpans(structural: string): Array<{ open: number; close: number }> {
  const spans: Array<{ open: number; close: number }> = [];
  for (const m of structural.matchAll(/\b(?:withLock|withAddressLock|updateStoredObject)\s*\(/g)) {
    const openParen = (m.index as number) + m[0].length - 1;
    const argsClose = matchingParen(structural, openParen);
    if (argsClose === -1) continue;
    // The callback body is INSIDE the argument list - `withLock('x', async () =>
    // { … })` - so it is the first brace between the paren and its match, never
    // the next brace in the file (which is what an `indexOf` past the closing
    // paren returns, and why the first version of this exemption never fired).
    const bodyOpen = structural.indexOf('{', openParen);
    if (bodyOpen === -1 || bodyOpen > argsClose) continue;
    const bodyClose = matchingBrace(structural, bodyOpen);
    if (bodyClose === -1 || bodyClose > argsClose) continue;
    spans.push({ open: bodyOpen, close: bodyClose });
  }
  return spans;
}

const withinSpans = (
  spans: Array<{ open: number; close: number }>,
  from: number,
  to: number
): boolean => spans.some((s) => s.open <= from && to <= s.close);

/** File-local `const KEY = 'literal'` bindings, so `get([KEY])` resolves. */
function stringConstants(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of text.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[A-Za-z_$][\w$<>,.[\]\s|]*?)?=\s*(['"`])([^'"`\n]*)\2/g
  )) {
    if (!map.has(m[1])) map.set(m[1], m[3]);
  }
  return map;
}

/** Resolve one key expression (a string literal, or an identifier constant). */
function resolveKey(expr: string, constants: Map<string, string>): string | null {
  const literal = /^\s*['"`]([^'"`\n]*)['"`]\s*$/.exec(expr);
  if (literal) return literal[1];
  const ident = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(expr);
  if (ident) return constants.get(ident[1]) ?? null;
  return null;
}

/** The keys one `storage.local.get(...)` argument names (unresolved ones dropped). */
function keysOfGetArgument(arg: string, constants: Map<string, string>): string[] {
  const keys: string[] = [];
  // Array form: `['a', 'b']` / `[KEY]` - take the top-level entries.
  const bracket = /^\s*\[([\s\S]*)\]\s*$/.exec(arg);
  const body = bracket ? bracket[1] : arg;
  let depth = 0;
  let entry = '';
  const flush = () => {
    const key = resolveKey(entry, constants);
    if (key !== null && !keys.includes(key)) keys.push(key);
    entry = '';
  };
  for (const char of body) {
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    if (char === ',' && depth === 0) flush();
    else entry += char;
  }
  flush();
  return keys;
}

/** The statement the binding of a call site belongs to. */
interface Binding {
  /** Names the read binds, with the storage keys each one carries. */
  names: Array<{ name: string; keys: string[] }>;
  /** The result object itself was bound (`const res = …`), not destructured. */
  whole: boolean;
  index: number;
}

/**
 * What a `get` call's result is bound to: `const { a = {} } = await get([…])`
 * gives name `a` carrying key `a`; `const res = …` gives `res` carrying every
 * requested key (so `res.notificationSnoozeByAddress` can be traced).
 */
function bindingOf(text: string, callIndex: number, requested: string[]): Binding | null {
  // Walk left to the `=` this call is assigned into, skipping comparisons and
  // arrows (`===`, `=>`, `!=`) - those are not assignments.
  let eq = -1;
  for (let i = callIndex - 1; i >= 0; i--) {
    if (text[i] !== '=') continue;
    const prev = text[i - 1];
    const next = text[i + 1];
    if (
      next === '=' ||
      next === '>' ||
      prev === '=' ||
      prev === '!' ||
      prev === '<' ||
      prev === '>'
    )
      continue;
    eq = i;
    break;
  }
  if (eq === -1) return null;
  // The left-hand side: everything back to the statement boundary. Brackets are
  // tracked so the walk does NOT stop at the destructuring brace itself -
  // `const { latestOtp } = …` has that brace to the LEFT of the `=`, and
  // stopping there left the LHS as `latestOtp }`, which parses as nothing.
  let start = 0;
  let depth = 0;
  for (let i = eq - 1; i >= 0; i--) {
    const c = text[i];
    if (c === ')' || c === ']' || c === '}') {
      depth++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      if (depth === 0) {
        start = i + 1;
        break;
      }
      depth--;
      continue;
    }
    if (c === ';' && depth === 0) {
      start = i + 1;
      break;
    }
  }
  const lhs = text.slice(start, eq);
  const destructure = /\{([\s\S]*)\}\s*(?::[^=]*)?$/.exec(lhs);
  if (destructure) {
    const names: Binding['names'] = [];
    for (const part of destructure[1].split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const aliased = /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/.exec(trimmed);
      const plain = /^([A-Za-z_$][\w$]*)/.exec(trimmed);
      const prop = aliased ? aliased[1] : plain ? plain[1] : '';
      const name = aliased ? aliased[2] : plain ? plain[1] : '';
      if (!prop || !name) continue;
      // Only a prop that IS one of the requested keys carries that key.
      if (requested.includes(prop)) names.push({ name, keys: [prop] });
    }
    return names.length > 0 ? { names, whole: false, index: callIndex } : null;
  }
  const ident = /([A-Za-z_$][\w$]*)\s*(?::[^=]*)?$/.exec(lhs);
  if (!ident) return null;
  return { names: [{ name: ident[1], keys: [...requested] }], whole: true, index: callIndex };
}

/** The expression span of `const X = <expr>` starting at `start` (index of `=`+1). */
function expressionSpan(structural: string, start: number): number {
  let depth = 0;
  let i = start;
  const continuesWith = /[([{,.+\-*/%&|?=:]/;
  for (; i < structural.length; i++) {
    const c = structural[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) return i;
      depth--;
    }
    if (depth > 0) continue;
    if (c === ';') return i;
    if (c === '\n') {
      const soFar = structural.slice(start, i).trimEnd();
      let next = i + 1;
      while (next < structural.length && /[ \t\n]/.test(structural[next])) next++;
      const startsContinuation = /^[.?]/.test(structural.slice(next));
      if (!continuesWith.test(soFar.slice(-1)) && !startsContinuation) return i;
    }
  }
  return i;
}

/** One field of an object literal: its property name and its value expression. */
interface Field {
  key: string;
  value: string;
}

/** The top-level fields of the object literal starting at `open`. */
function objectFields(text: string, structural: string, open: number): Field[] {
  const close = matchingBrace(structural, open);
  if (close === -1) return [];
  const fields: Field[] = [];
  let depth = 0;
  let segmentStart = open + 1;
  const flush = (endExclusive: number) => {
    const structuralSegment = structural.slice(segmentStart, endExclusive);
    const colon = topLevelColon(structuralSegment);
    const textSegment = text.slice(segmentStart, endExclusive);
    if (colon === -1) {
      // Shorthand: `{ addresses }` writes the variable named `addresses`.
      const name = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(textSegment);
      if (name) fields.push({ key: name[1], value: name[1] });
      return;
    }
    const rawKey = textSegment.slice(0, colon).trim();
    const key = /^['"`]?([^'"`\s]+)['"`]?$/.exec(rawKey)?.[1] ?? rawKey;
    if (rawKey.startsWith('[')) return; // computed key - not resolvable
    fields.push({ key, value: textSegment.slice(colon + 1).trim() });
  };
  for (let i = open + 1; i <= close; i++) {
    const c = structural[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if ((c === ',' && depth === 0) || i === close) {
      flush(i);
      segmentStart = i + 1;
    }
  }
  return fields;
}

/** Index of the `:` that separates a field's key from its value, or -1. */
function topLevelColon(segment: string): number {
  let depth = 0;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ':' && depth === 0) {
      // `a ? b : c` inside a value is not a key separator - a field segment
      // only ever starts with a key, so the FIRST top-level colon is the one.
      return i;
    }
  }
  return -1;
}

/**
 * The keys an expression carries, given what is tainted: a name bound by the
 * read carries its keys directly, and a member access on a whole-result binding
 * (`res.K`) carries exactly `K`.
 */
function carriedKeys(
  expr: string,
  taint: Map<
    string,
    { keys: string[]; whole: boolean; scope: { open: number; close: number } | null }
  >,
  atScope: { open: number; close: number } | null,
  requested: string[]
): string[] {
  const carried = new Set<string>();
  const memberRe = /([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)/g;
  const members = new Set<string>();
  for (const m of expr.matchAll(memberRe)) members.add(`${m[1]}.${m[2]}`);
  for (const name of identifiersIn(expr)) {
    const entry = taint.get(name);
    if (!entry) continue;
    if (entry.scope !== null && !sameScope(entry.scope, atScope)) continue;
    if (!entry.whole) {
      for (const k of entry.keys) carried.add(k);
      continue;
    }
    // A whole-result binding: only the keys it actually carries can be reached.
    let sawMember = false;
    for (const member of members) {
      const [receiver, key] = member.split('.');
      if (receiver !== name) continue;
      if (entry.keys.includes(key) || requested.includes(key)) {
        carried.add(key);
        sawMember = true;
      }
    }
    if (!sawMember) for (const k of entry.keys) carried.add(k);
  }
  return [...carried];
}

/**
 * Pure core: every unserialized whole-key read-modify-write in one file.
 *
 * Sequential by construction - the file is walked in source order, and a write
 * can only be flagged by a read that came before it (a write-then-read is two
 * independent operations, not a modify).
 */
export function scanSource(raw: string): FileScan {
  const { text, structural, inCode } = analyse(raw);
  const constants = stringConstants(text);
  const pairs = bracePairs(structural);
  const serialized = serializedSpans(structural);

  interface Read {
    index: number;
    keys: string[];
    binding: Binding;
    scope: { open: number; close: number } | null;
    line: number;
  }
  const reads: Read[] = [];
  const unanalysed: string[] = [];
  let unresolvedKey = 0;
  let unbound = 0;

  for (const m of text.matchAll(/\.storage\s*\.local\s*\.get\s*\(/g)) {
    const index = m.index as number;
    if (inCode[index] !== 1) continue;
    const open = index + m[0].length - 1;
    const close = matchingParen(structural, open);
    if (close === -1) continue;
    const arg = text
      .slice(open + 1, close)
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40);
    const keys = keysOfGetArgument(text.slice(open + 1, close), constants);
    if (keys.length === 0) {
      unresolvedKey++;
      unanalysed.push(`${lineAt(text, index)} get(${arg}) - key is a parameter or dynamic`);
      continue;
    }
    const binding = bindingOf(text, index, keys);
    if (!binding) {
      unbound++;
      unanalysed.push(`${lineAt(text, index)} get(${arg}) - result is not bound to a name`);
      continue;
    }
    reads.push({
      index,
      keys,
      binding,
      scope: scopeAt(structural, pairs, index),
      line: lineAt(text, index),
    });
  }

  interface Write {
    index: number;
    fields: Field[];
    scope: { open: number; close: number } | null;
    line: number;
  }
  const writes: Write[] = [];
  // Both spellings of one write: the raw area call and the storage layer's
  // retrying wrapper (which re-sends the same whole-key value).
  for (const m of text.matchAll(/(?:\.storage\s*\.local\s*\.set|\bwriteWithRetry)\s*\(\s*\{/g)) {
    const index = m.index as number;
    if (inCode[index] !== 1) continue;
    const open = index + m[0].length - 1;
    writes.push({
      index,
      fields: objectFields(text, structural, open),
      scope: scopeAt(structural, pairs, index),
      line: lineAt(text, index),
    });
  }

  interface Declaration {
    index: number;
    name: string;
    expr: string;
    scope: { open: number; close: number } | null;
  }
  const declarations: Declaration[] = [];
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    const index = m.index as number;
    if (inCode[index] !== 1) continue;
    const valueStart = index + m[0].length;
    declarations.push({
      index,
      name: m[1],
      expr: text.slice(valueStart, expressionSpan(structural, valueStart)),
      scope: scopeAt(structural, pairs, index),
    });
  }

  type Entry = { keys: string[]; whole: boolean; scope: { open: number; close: number } | null };
  const taint = new Map<string, Entry>();
  const events = [
    ...reads.map((r) => ({ at: r.index, kind: 'read' as const, read: r })),
    ...declarations.map((d) => ({ at: d.index, kind: 'decl' as const, decl: d })),
    ...writes.map((w) => ({ at: w.index, kind: 'write' as const, write: w })),
  ].sort((a, b) => a.at - b.at);

  const sites: RmwSite[] = [];
  let serializedPairs = 0;

  for (const event of events) {
    if (event.kind === 'read') {
      for (const { name, keys } of event.read.binding.names) {
        const existing = taint.get(name);
        const visible = existing && sameScope(existing.scope, event.read.scope);
        taint.set(name, {
          keys: visible ? [...new Set([...existing.keys, ...keys])] : keys,
          whole: event.read.binding.whole,
          scope: event.read.scope,
        });
      }
      continue;
    }
    if (event.kind === 'decl') {
      const carried = carriedKeys(event.decl.expr, taint, event.decl.scope, []);
      if (carried.length > 0) {
        taint.set(event.decl.name, { keys: carried, whole: false, scope: event.decl.scope });
      } else {
        taint.delete(event.decl.name);
      }
      continue;
    }

    for (const field of event.write.fields) {
      const earlier = reads.filter(
        (r) => r.index < event.write.index && r.keys.includes(field.key)
      );
      if (earlier.length === 0) continue;
      const carried = carriedKeys(field.value, taint, event.write.scope, [field.key]);
      if (!carried.includes(field.key)) continue;
      const read = earlier[earlier.length - 1];
      if (withinSpans(serialized, read.index, event.write.index)) {
        serializedPairs++;
        continue;
      }
      sites.push({
        key: field.key,
        readLine: read.line,
        writeLine: event.write.line,
        value: field.value.replace(/\s+/g, ' ').slice(0, 80),
      });
    }
  }

  return { sites, unresolvedKey, unbound, unanalysed, serialized: serializedPairs };
}

// ── Baseline ratchet ────────────────────────────────────────────────────────

/** A baseline row, or a finding reduced to the row that represents it. */
export interface BaselineRow {
  file: string;
  key: string;
}

export function formatBaseline(rows: readonly BaselineRow[]): string {
  return `${[...rows]
    .sort((a, b) => `${a.file}\t${a.key}`.localeCompare(`${b.file}\t${b.key}`))
    .map((r) => `${r.file}\t${r.key}`)
    .join('\n')}\n`;
}

export function parseBaseline(text: string): BaselineRow[] {
  const rows: BaselineRow[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [file, key] = trimmed.split('\t');
    if (!file || !key) continue;
    rows.push({ file, key });
  }
  return rows;
}

/** Which findings are new, and which baseline rows no longer have a site. */
export function diffBaseline(
  findings: readonly BaselineRow[],
  baseline: readonly BaselineRow[]
): { added: BaselineRow[]; stale: BaselineRow[] } {
  const key = (r: BaselineRow) => `${r.file}\t${r.key}`;
  const listed = new Set(baseline.map(key));
  const found = new Set(findings.map(key));
  return {
    added: findings.filter((r) => !listed.has(key(r))),
    stale: baseline.filter((r) => !found.has(key(r))),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const BASELINE_HEADER = `# Whole-key read-modify-write baseline - a ratchet: rows may only disappear.
# Format: <path><TAB><key>
# Each row is a storage key a file READS, mutates and writes back whole, with no
# serialization around the pair - so two concurrent flows can lose one of the
# writes (see scripts/check-storage-rmw.ts). Rows are pre-existing debt: route
# the pair through updateStoredObject (one JS context) or hold withLock across
# it (the background's cross-context lock), then drop the row. A new row is never
# a fix, because any finding not listed here fails the gate.
# Refresh (after shrinking) with:
#   bun scripts/check-storage-rmw.ts --update
`;

function main(): void {
  const update = process.argv.includes('--update');
  const list = process.argv.includes('--list');
  const files = collectAbsoluteFiles(SRC_DIR, ['.ts', '.svelte']);

  const rows: BaselineRow[] = [];
  const details: Array<RmwSite & { file: string }> = [];
  const unanalysedSamples: string[] = [];
  let unresolvedKey = 0;
  let unbound = 0;
  let serialized = 0;
  for (const file of files) {
    const scan = scanSource(readFileSync(file, 'utf8'));
    unresolvedKey += scan.unresolvedKey;
    unbound += scan.unbound;
    if (list) {
      const repoPath = relative(REPO_ROOT, file).replace(/\\/g, '/');
      for (const sample of scan.unanalysed) unanalysedSamples.push(`${repoPath}:${sample}`);
    }
    serialized += scan.serialized;
    const repoPath = relative(REPO_ROOT, file).replace(/\\/g, '/');
    for (const site of scan.sites) {
      details.push({ ...site, file: repoPath });
      if (!rows.some((r) => r.file === repoPath && r.key === site.key)) {
        rows.push({ file: repoPath, key: site.key });
      }
    }
  }

  if (list) {
    for (const d of details) {
      console.log(`${d.file}:${d.writeLine}\t[${d.key}]\tread@${d.readLine}\t${d.value}`);
    }
    console.log(
      `\n${details.length} site(s) / ${rows.length} file+key row(s); ${serialized} already serialized; ` +
        `${unresolvedKey} unresolvable key(s); ${unbound} unbound read(s)`
    );
    console.log('\nRead sites the scan could not analyse:');
    for (const u of unanalysedSamples.slice(0, 25)) console.log(`  ${u}`);
    return;
  }

  const baseline = existsSync(BASELINE_PATH)
    ? parseBaseline(readFileSync(BASELINE_PATH, 'utf8'))
    : [];
  const { added, stale } = diffBaseline(rows, baseline);

  if (update) {
    writeFileSync(BASELINE_PATH, BASELINE_HEADER + formatBaseline(rows));
    console.log(
      `storage-rmw baseline updated: ${rows.length} row(s) (${stale.length} removed, ${added.length} added).`
    );
    return;
  }

  if (added.length > 0) {
    console.error(`Unserialized whole-key read-modify-write (${added.length} new):`);
    for (const row of added) {
      for (const d of details.filter((x) => x.file === row.file && x.key === row.key)) {
        console.error(`  ${row.file}:${d.writeLine}  [${row.key}]  read@${d.readLine}`);
        console.error(`    writes whole key as: ${d.value}`);
      }
    }
    console.error(
      '\nA key that is read, mutated and written back must be serialized:\n' +
        '  - one JS context (views, features): `updateStoredObject(key, updater, parse)`\n' +
        '    from @/utils/storage/rmw.js - the updater runs against the last write\n' +
        '    this key landed, so no read can go stale;\n' +
        '  - the background: hold `withLock(<lock>, …)` across the read AND the\n' +
        '    write (browser.storage.local.set replaces the whole value);\n' +
        '  - when another CONTEXT (popup / side panel / app tab) writes the same\n' +
        '    key, let the background own the write - an intra-context helper cannot\n' +
        '    serialize two documents.'
    );
  }

  if (stale.length > 0) {
    console.error(
      `\nStale baseline row(s) - the site is gone, so the ratchet must shrink (${stale.length}):`
    );
    for (const row of stale) console.error(`  ${row.file}\t${row.key}`);
    console.error('Run `bun scripts/check-storage-rmw.ts --update` to drop them.');
  }

  if (added.length > 0 || stale.length > 0) process.exit(1);

  console.log(
    `No unserialized whole-key read-modify-write beyond the baseline (${rows.length} row(s); ` +
      `${serialized} pair(s) already serialized; ${unresolvedKey} unresolvable key(s); ` +
      `${unbound} unbound read(s)).`
  );
}

// CLI entry only - unit tests import the pure core above.
if (import.meta.main) main();
