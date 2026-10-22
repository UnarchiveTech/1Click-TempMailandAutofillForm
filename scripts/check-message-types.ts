#!/usr/bin/env bun
/**
 * Typed-messaging verifier (background-locales-style generator pattern)
 *
 * Every `browser.runtime.sendMessage`, `browser.tabs.sendMessage` and
 * `sendMessageViaBg` call between entrypoints MUST carry a literal
 * `type`/`action` string declared in the `RuntimeMessage` union in
 * `src/utils/types.ts` (single source of truth). This script scans all of
 * `src/` and the static extension scripts under `public/` (plain JS files
 * outside the bundler, e.g. the offscreen audio document) and fails any call
 * whose discriminant:
 *
 *   1. is not a string literal (`type: someVar` / template interpolation), or
 *   2. resolves to a string NOT present in `RuntimeMessage`, or
 *   3. cannot be verified statically (unresolvable message variable).
 *
 * Message objects are read with a small bracket scanner, but *what counts as
 * code* - strings, template literals, comments, regex literals and the code
 * inside `${…}` - comes from the shared `./source-lexer`, the same
 * classification every other scanner uses, so object literals built with spread
 * (`{ type: 'x', ...extra }`) and generics-wrapped bridge calls
 * (`sendMessageViaBg<{ success?: boolean }>({ type: 'x' })`) are handled.
 * Variables are resolved when they are a same-file `const NAME = { ... }`
 * literal (e.g. the webmcp bridge payload).
 *
 * Three checks are performed:
 *
 *   FORWARD  - every sendMessage/sendMessageViaBg call must carry a literal
 *              type/action declared in the RuntimeMessage union.
 *   FIELDS   - every literal payload field at the call site must be declared
 *              on the union member, and every required member field must be
 *              present (spread payloads are treated as unverifiable and skip
 *              both checks). Structural drift between send sites and the
 *              RuntimeMessage interface is caught here; value-level type
 *              compatibility (e.g. string vs number) is NOT checked - that is
 *              the TypeScript compiler's job.
 *   REVERSE  - every RuntimeMessage union member must be handled somewhere:
 *              either a registered key in the background `handlers` object
 *              (src/entrypoints/background/runtime/message-handler.ts) or an
 *              explicit entry in the ALLOWED_UNHANDLED allowlist below (for
 *              messages received by content-script listeners, extension-page
 *              UI listeners, or other intentional broadcast sinks). Members
 *              allowlisted as `content` are additionally verified against the
 *              actual `onMessage` listeners in src/entrypoints/content/ - the
 *              consumed `type` literals are parsed out, so a content entry
 *              whose listener branch disappears fails the check instead of
 *              relying on manual spot-checks. This catches orphaned message
 *              types accumulating in the union.
 *
 * Usage:
 *   bun run check-message-types        # verify both directions
 *
 * Exits 1 when either direction fails, so typed messaging can't silently
 * regress. Wired into the pre-commit hook + CI.
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectAbsoluteFiles } from './source-files';
import { analyzeSource, stripComments } from './source-lexer';

// ─── Configuration ────────────────────────────────────────────────────────────

const SRC_DIR = join(import.meta.dir, '..', 'src');
const TYPES_FILE = join(SRC_DIR, 'utils', 'types.ts');
const PUBLIC_DIR = join(import.meta.dir, '..', 'public');
/** Static extension scripts shipped outside the bundler (e.g. offscreen doc). */
/** Scripts the bundler does not see - same extensions, as a lister filter. */
const PUBLIC_EXTS = ['.js', '.mjs', '.cjs'];
/** Every source extension this gate reads out of `src/`. */
const SRC_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.svelte'];

/** The two unions that make up `RuntimeMessage` in src/utils/types.ts. */
const UNION_TYPE_NAMES = ['BackgroundMessage', 'ContentMessage'] as const;

const useColour = process.stdout.isTTY;
const red = (s: string) => (useColour ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s: string) => (useColour ? `\x1b[33m${s}\x1b[0m` : s);
const green = (s: string) => (useColour ? `\x1b[32m${s}\x1b[0m` : s);
const bold = (s: string) => (useColour ? `\x1b[1m${s}\x1b[0m` : s);

/** Collect every file (recursively) under a directory matching `exts`. */
// ─── Code-aware scanner primitives ───────────────────────────────────────────

/**
 * Match the closing bracket for the opening bracket at `openIdx` (`(`, `[`,
 * `{`). Brackets inside strings, template text, comments and regex literals are
 * ignored, using the shared classification - this file keeps no second opinion
 * about what counts as code. `openIdx` itself is always counted, because every
 * caller passes a bracket it has already located. Returns -1 when unbalanced.
 */
function matchBalanced(src: string, openIdx: number, inCode = analyzeSource(src).inCode): number {
  const open = src[openIdx];
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : '';
  if (!close) return -1;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (i > openIdx && inCode[i] === 0) continue;
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Split a string on a top-level separator, ignoring separators inside brackets,
 * strings, template text, comments and regexes - the shared classification
 * decides which characters are syntax and which are data.
 */
function splitTopLevel(text: string, sep = ','): string[] {
  const { inCode } = analyzeSource(text);
  const parts: string[] = [];
  let start = 0;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < text.length; i++) {
    if (inCode[i] === 0) continue;
    const c = text[i];
    if (c === '(') paren++;
    else if (c === ')') paren = Math.max(0, paren - 1);
    else if (c === '[') bracket++;
    else if (c === ']') bracket = Math.max(0, bracket - 1);
    else if (c === '{') brace++;
    else if (c === '}') brace = Math.max(0, brace - 1);
    else if (c === sep && paren === 0 && brace === 0 && bracket === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Extract the discriminant (`type` or `action`) from a message object literal.
 * Returns null when the object has no literal type/action member.
 */
function extractDiscriminant(objText: string): string | null {
  const clean = stripComments(objText);
  const m = /\b(?:type|action)\s*:\s*(['"])([^'"]+)\1/.exec(clean);
  return m ? m[2] : null;
}

// ─── RuntimeMessage union catalogue ──────────────────────────────────────────

/** Slice out the body of `export type <NAME> = ...;` from the file. */
function extractUnionSpan(src: string, typeName: string): string {
  const startMarker = `export type ${typeName} =`;
  const start = src.indexOf(startMarker);
  if (start < 0) return '';
  const end = src.indexOf('export type ', start + startMarker.length);
  return src.slice(start + startMarker.length, end > 0 ? end : src.length);
}

/** Map of discriminant → full member object text across a union span. */
function collectUnionMembers(span: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < span.length) {
    const c = span[i];
    if (c === '{') {
      const closeIdx = matchBalanced(span, i);
      if (closeIdx < 0) break;
      const memberText = span.slice(i, closeIdx + 1);
      const disc = extractDiscriminant(memberText);
      if (disc) out.set(disc, memberText);
      i = closeIdx + 1;
    } else {
      i++;
    }
  }
  return out;
}

// ─── Payload field catalogues (structural validation) ────────────────────────

interface MemberFields {
  required: string[];
  optional: string[];
  indexSignature: boolean;
}

/** Parse `{ a: T; b?: U; [key: string]: unknown }` member text into fields. */
function parseMemberFields(memberText: string): MemberFields {
  const clean = stripComments(memberText).trim();
  const inner = clean.startsWith('{') ? clean.slice(1, -1) : clean;
  const required: string[] = [];
  const optional: string[] = [];
  let indexSignature = false;
  for (const segment of splitTopLevel(inner, ';')) {
    const seg = segment.trim();
    if (!seg) continue;
    if (/^\[[^\]]+\]\s*:/.test(seg)) {
      indexSignature = true;
      continue;
    }
    const m = /^([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")(\?)?\s*:/.exec(seg);
    if (!m) continue;
    const quoted = m[1].startsWith("'") || m[1].startsWith('"');
    const name = quoted ? m[1].slice(1, -1) : m[1];
    if (m[2] === '?') optional.push(name);
    else required.push(name);
  }
  return { required, optional, indexSignature };
}

/** Top-level literal keys of a message object; `hasSpread` when `...x` is used. */
function extractObjectKeys(objText: string): { keys: string[]; hasSpread: boolean } {
  const clean = stripComments(objText).trim();
  const inner = clean.startsWith('{') ? clean.slice(1, -1) : clean;
  const keys: string[] = [];
  let hasSpread = false;
  for (const segment of splitTopLevel(inner)) {
    const seg = segment.trim();
    if (!seg) continue;
    if (seg.startsWith('...')) {
      hasSpread = true;
      continue;
    }
    const m = /^([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")/.exec(seg);
    if (!m) continue;
    const quoted = m[1].startsWith("'") || m[1].startsWith('"');
    keys.push(quoted ? m[1].slice(1, -1) : m[1]);
  }
  return { keys, hasSpread };
}

/**
 * Structural drift check between a send-site payload and its union member.
 * `type`/`action` keys are never flagged (members may declare either), and
 * spread payloads skip the checks because the spread's fields are unknown.
 */
function validatePayload(memberText: string, objText: string): string[] {
  const fields = parseMemberFields(memberText);
  const { keys, hasSpread } = extractObjectKeys(objText);
  const disc = extractDiscriminant(memberText);
  const problems: string[] = [];
  const declared = new Set([...fields.required, ...fields.optional]);

  if (!fields.indexSignature) {
    for (const key of keys) {
      if (key === 'type' || key === 'action') continue;
      if (!declared.has(key)) {
        problems.push(
          `payload field '${key}' is not declared on the '${disc}' RuntimeMessage member`
        );
      }
    }
  }

  if (!hasSpread) {
    for (const req of fields.required) {
      if (req === 'type' || req === 'action' || req === disc) continue;
      if (!keys.includes(req)) {
        problems.push(
          `payload is missing required field '${req}' of the '${disc}' RuntimeMessage member`
        );
      }
    }
  }
  return problems;
}

// ─── Handler catalogue (reverse direction) ───────────────────────────────────

const HANDLER_FILE = join(SRC_DIR, 'entrypoints', 'background', 'runtime', 'message-handler.ts');

/**
 * Union members intentionally NOT registered in the background `handlers`
 * object. Each entry must name who actually receives the message:
 *
 *  - content: handled by a content-script `runtime.onMessage` listener
 *    (messages sent via `tabs.sendMessage`), e.g. `fillOTP`, `ping`.
 *    AUTO-VERIFIED: the check parses the onMessage listeners under
 *    src/entrypoints/content/ and fails if this member is not consumed there.
 *  - ui: handled by an extension-page `runtime.onMessage` listener
 *    (AppLayout / AppShell), e.g. `navigateView`, `otpCopied`.
 *  - offscreen: handled by the static offscreen audio document
 *    (`public/offscreen.js`), e.g. `playNotificationSound`.
 *  - broadcast: intentional fire-and-forget notification to any open
 *    extension context; no mandatory listener (e.g. `vaultLocked` - emitted
 *    on vault lock, extension pages may ignore it).
 *
 * When you add a new union member that is NOT wired to the background
 * `handlers` object, it must be listed here with its receiver - otherwise the
 * check fails as an orphaned message type. Prefer wiring a real listener over
 * the `broadcast` escape hatch.
 */
const ALLOWED_UNHANDLED: Record<string, 'content' | 'ui' | 'offscreen' | 'broadcast'> = {
  // Content-script listeners (tabs.sendMessage → content onMessage, content/index.ts)
  fillOTP: 'content',
  checkFormDetected: 'content',
  startSignup: 'content',
  ping: 'content',
  rescanForms: 'content',
  autofillBlocklistChanged: 'content',
  sitePrivacySettingsChanged: 'content',
  refillSavedLogin: 'content',
  // Dev-only perf report: background asks the tab's content script for its
  // perf ring (received in content/index.ts's onMessage listener).
  collectPerfMarks: 'content',
  // Extension-page UI listeners (background → AppLayout / AppShell)
  navigateView: 'ui',
  otpCopied: 'ui',
  otpAutoCopied: 'ui',
  vaultLocked: 'ui',
  // Static offscreen audio document (public/offscreen.js)
  playNotificationSound: 'offscreen',
};

/** Registered keys of the background `const handlers` object. */
function collectHandlerKeys(src: string): Set<string> {
  const out = new Set<string>();
  const decl = /\bconst\s+handlers\b/.exec(src);
  if (!decl) return out;
  const openIdx = src.indexOf('{', decl.index);
  if (openIdx < 0) return out;
  const closeIdx = matchBalanced(src, openIdx);
  if (closeIdx < 0) return out;

  for (const segment of splitTopLevel(src.slice(openIdx + 1, closeIdx))) {
    const clean = stripComments(segment).trim();
    const keyMatch = /^([A-Za-z_$][\w$]*|'[^']*'|"[^"]*"|\[[^\]]*\])\s*:/.exec(clean);
    if (!keyMatch) continue;
    const raw = keyMatch[1];
    out.add(raw.startsWith('[') ? raw.slice(1, -1).replace(/['"]/g, '') : raw.replace(/['"]/g, ''));
  }
  return out;
}

// ─── Content-script listener catalogue (verified allowlist) ─────────────────

const CONTENT_DIR = join(SRC_DIR, 'entrypoints', 'content');

/**
 * Literal message types consumed by content-script `onMessage` listeners.
 * Parses every `runtime.onMessage.addListener(...)` callback under
 * src/entrypoints/content/ and collects `X.type === '...'` / `case '...':`
 * literals inside the callback bodies (comments/strings excluded via mask).
 */
function collectContentHandledTypes(): Set<string> {
  const out = new Set<string>();
  const listenerRe = /\bonMessage\.addListener\s*\(/g;
  const typeCompareRe = /\b[A-Za-z_$][\w$]*\.type\??\s*===?\s*'([^']+)'/g;
  const caseRe = /\bcase\s+'([^']+)'\s*:/g;

  for (const file of collectAbsoluteFiles(CONTENT_DIR, SRC_EXTS)) {
    const src = readFileSync(file, 'utf8');
    const { inCode } = analyzeSource(src);
    let lm: RegExpExecArray | null;
    listenerRe.lastIndex = 0;
    for (lm = listenerRe.exec(src); lm !== null; lm = listenerRe.exec(src)) {
      const openIdx = lm.index + lm[0].length - 1;
      const closeIdx = matchBalanced(src, openIdx);
      if (closeIdx < 0) continue;
      const body = src.slice(openIdx + 1, closeIdx);
      const base = openIdx + 1;
      for (const re of [typeCompareRe, caseRe]) {
        let tm: RegExpExecArray | null;
        re.lastIndex = 0;
        for (tm = re.exec(body); tm !== null; tm = re.exec(body)) {
          // `inCode` is 0 on quote/string chars, so test the match START (the
          // receiver identifier / `case` keyword), which is always code.
          const matchIdx = base + tm.index;
          if (inCode[matchIdx] === 1) out.add(tm[1]);
        }
      }
    }
  }
  return out;
}

// ─── sendMessage call-site analysis ──────────────────────────────────────────

/** Resolve `const NAME = { ... }` (same file) to its object literal text. */
function resolveLocalObject(src: string, name: string): string | null {
  const re = new RegExp(`\\bconst\\s+${name}\\s*=\\s*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1;
  const closeIdx = matchBalanced(src, openIdx);
  return closeIdx < 0 ? null : src.slice(openIdx, closeIdx + 1);
}

interface CallAnalysis {
  discriminant: string | null;
  detail: string;
  /** Message object literal text (null when dynamic/unresolvable). */
  objText: string | null;
}

/**
 * Given the full file source and the index of a call's opening paren, extract
 * the message object and determine its literal discriminant. `tabs.sendMessage`
 * always takes the message as its second argument; runtime `sendMessage` may
 * take an extension ID before the message, so its message is the last argument.
 */
function analyzeSendCall(
  src: string,
  openIdx: number,
  messageArgIndex?: number
): CallAnalysis | null {
  const closeIdx = matchBalanced(src, openIdx);
  if (closeIdx < 0) return null;
  const args = splitTopLevel(src.slice(openIdx + 1, closeIdx));
  if (args.length === 0) return { discriminant: null, detail: 'no arguments', objText: null };
  const resolvedMessageIndex = messageArgIndex ?? args.length - 1;
  if (resolvedMessageIndex >= args.length) {
    return { discriminant: null, detail: 'message argument is missing', objText: null };
  }
  const msgArg = args[resolvedMessageIndex].trim();
  if (!msgArg) return { discriminant: null, detail: 'empty last argument', objText: null };

  if (msgArg.startsWith('{')) {
    const disc = extractDiscriminant(msgArg);
    return disc
      ? { discriminant: disc, detail: msgArg.slice(0, 60), objText: msgArg }
      : {
          discriminant: null,
          detail: `message object has no literal type/action: ${msgArg.slice(0, 60)}`,
          objText: null,
        };
  }

  if (/^[A-Za-z_$][\w$]*$/.test(msgArg)) {
    const objText = resolveLocalObject(src, msgArg);
    if (objText) {
      const disc = extractDiscriminant(objText);
      return disc
        ? { discriminant: disc, detail: `const ${msgArg}`, objText }
        : {
            discriminant: null,
            detail: `const ${msgArg} has no literal type/action`,
            objText: null,
          };
    }
    return {
      discriminant: null,
      detail: `unresolvable message variable "${msgArg}" (use a literal object or a same-file const)`,
      objText: null,
    };
  }

  return {
    discriminant: null,
    detail: `dynamic message expression: ${msgArg.slice(0, 60)}`,
    objText: null,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const typesSource = readFileSync(TYPES_FILE, 'utf8');
const memberByDiscriminant = new Map<string, string>();
for (const typeName of UNION_TYPE_NAMES) {
  for (const [disc, memberText] of collectUnionMembers(extractUnionSpan(typesSource, typeName))) {
    memberByDiscriminant.set(disc, memberText);
  }
}
const validKeys = new Set(memberByDiscriminant.keys());

if (validKeys.size === 0) {
  console.error(
    red(`Could not parse RuntimeMessage union from ${relative(process.cwd(), TYPES_FILE)}`)
  );
  process.exit(1);
}

const SEND_RE = /\bsendMessage\s*\(/g;
const VIA_BG_RE = /\bsendMessageViaBg(?:<[^>]*>)?\s*\(/g;

// Both lists come from the shared lister, so this gate reads exactly the files
// `bun run check` sees - no more (a gitignored probe can't fail it) and no fewer.
const srcFiles = collectAbsoluteFiles(SRC_DIR, SRC_EXTS);
const publicFiles = collectAbsoluteFiles(PUBLIC_DIR, PUBLIC_EXTS);
const files = [...srcFiles, ...publicFiles];
const problems: string[] = [];
let callCount = 0;
let payloadChecks = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const { inCode } = analyzeSource(src);
  // Keep src/ paths compact; show public/ scripts from the project root.
  const rel = file.startsWith(SRC_DIR) ? relative(SRC_DIR, file) : relative(process.cwd(), file);

  // The `sendMessageViaBg` helper's own body forwards a caller-provided message
  // (`browser.runtime.sendMessage(message)`) - an intentional passthrough whose
  // callers are validated at their own call sites. Exempt its definition body.
  const exemptRanges: Array<[number, number]> = [];
  {
    let dm: RegExpExecArray | null;
    VIA_BG_RE.lastIndex = 0;
    for (dm = VIA_BG_RE.exec(src); dm !== null; dm = VIA_BG_RE.exec(src)) {
      const before = src.slice(Math.max(0, dm.index - 12), dm.index);
      if (!/\bfunction\s+$/.test(before)) continue; // not the definition
      const defOpen = dm.index + dm[0].length - 1;
      const defClose = matchBalanced(src, defOpen);
      if (defClose < 0) continue;
      const bodyOpen = src.indexOf('{', defClose + 1);
      if (bodyOpen < 0) continue;
      const bodyClose = matchBalanced(src, bodyOpen);
      exemptRanges.push([dm.index, bodyClose > 0 ? bodyClose + 1 : defClose + 1]);
    }
  }
  const isExempt = (idx: number) => exemptRanges.some(([from, to]) => idx >= from && idx < to);

  const visit = (m: RegExpExecArray) => {
    const openIdx = m.index + m[0].length - 1;
    if (openIdx >= inCode.length || inCode[openIdx] === 0) return; // inside comment/string
    if (isExempt(openIdx)) return; // inside the sendMessageViaBg definition body

    callCount++;
    const line = src.slice(0, openIdx).split('\n').length;
    const callPrefix = src.slice(Math.max(0, m.index - 32), m.index);
    const isTabsSendMessage = /\btabs\s*\.\s*$/.test(callPrefix);
    const analysis = analyzeSendCall(src, openIdx, isTabsSendMessage ? 1 : undefined);
    if (!analysis) return;
    if (analysis.discriminant === null) {
      problems.push(`${rel}:${line}: ${analysis.detail}`);
    } else if (!validKeys.has(analysis.discriminant)) {
      problems.push(
        `${rel}:${line}: '${analysis.discriminant}' is not declared in RuntimeMessage (src/utils/types.ts)`
      );
    } else if (analysis.objText) {
      const memberText = memberByDiscriminant.get(analysis.discriminant);
      if (memberText) {
        payloadChecks++;
        for (const p of validatePayload(memberText, analysis.objText)) {
          problems.push(`${rel}:${line}: ${p}`);
        }
      }
    }
  };

  for (const re of [SEND_RE, VIA_BG_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    for (m = re.exec(src); m !== null; m = re.exec(src)) visit(m);
  }
}

const handlerKeys = collectHandlerKeys(readFileSync(HANDLER_FILE, 'utf8'));
const orphaned = [...validKeys]
  .filter((key) => !handlerKeys.has(key) && !(key in ALLOWED_UNHANDLED))
  .sort();
const handlerOnly = [...handlerKeys]
  .filter((key) => !validKeys.has(key) && !(key in ALLOWED_UNHANDLED))
  .sort();
const contentHandledTypes = collectContentHandledTypes();
const contentAllowlisted = Object.entries(ALLOWED_UNHANDLED)
  .filter(([, cat]) => cat === 'content')
  .map(([key]) => key);
const contentMissing = contentAllowlisted.filter((key) => !contentHandledTypes.has(key)).sort();

console.log(bold('\n=== Typed Messaging ==='));
console.log(
  `  Files scanned         : ${bold(String(files.length))} (${bold(String(srcFiles.length))} src + ${bold(String(publicFiles.length))} public)`
);
console.log(`  sendMessage calls     : ${bold(String(callCount))}`);
console.log(`  Payloads field-checked: ${bold(String(payloadChecks))}`);
console.log(`  RuntimeMessage keys   : ${bold(String(validKeys.size))}`);
console.log(`  Background handlers   : ${bold(String(handlerKeys.size))}`);
const byCat = (cat: string) =>
  Object.entries(ALLOWED_UNHANDLED)
    .filter(([, c]) => c === cat)
    .map(([k]) => k)
    .join(', ');
console.log(`  Allowlisted           : ${bold(String(Object.keys(ALLOWED_UNHANDLED).length))}`);
for (const cat of ['content', 'ui', 'offscreen', 'broadcast']) {
  console.log(`    ${cat.padEnd(9)} ${byCat(cat) || '-'}`);
}
console.log(`  Content listener hits : ${bold(String(contentHandledTypes.size))}`);

if (orphaned.length > 0) {
  const lines = [
    `${orphaned.length} orphaned RuntimeMessage member(s) with no handler: ${orphaned.join(', ')}`,
    'Register it in the background handlers object (message-handler.ts) or add it to ALLOWED_UNHANDLED in this script with its receiver.',
  ];
  for (const line of lines) problems.push(line);
}

if (handlerOnly.length > 0) {
  console.warn(
    yellow(
      `  ⚠ ${handlerOnly.length} background handler(s) not declared in RuntimeMessage (possible dead or legacy types):`
    )
  );
  for (const k of handlerOnly) console.warn(yellow(`  - ${k}`));
}

if (contentMissing.length > 0) {
  for (const key of contentMissing) {
    problems.push(
      `'${key}' is allowlisted as a content-listener message but no content-script onMessage listener consumes it (src/entrypoints/content/) - wire the listener or remove the allowlist entry`
    );
  }
}

if (problems.length > 0) {
  console.error(red(`  ✗ ${problems.length} problem(s) found:`));
  for (const p of problems) console.error(red(`  - ${p}`));
  console.error(
    yellow(
      `  Add missing members to the RuntimeMessage union in src/utils/types.ts, or fix the send site to use a literal type/action from that union.`
    )
  );
  process.exit(1);
}

console.log(green('  ✓ Every sendMessage/sendMessageViaBg call resolves to a RuntimeMessage key'));
