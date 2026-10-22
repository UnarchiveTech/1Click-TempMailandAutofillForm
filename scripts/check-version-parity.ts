/**
 * Parity guard between the TWO copies of the manifest-version sanitizer:
 *   - src/utils/version-sanitize.ts   (shared module -> wxt.config.ts builds)
 *   - release.yml "Sanitize expected manifest version" step (inline node -e)
 *
 * The workflow cannot import the TS module (CI runs plain node), so the same
 * algorithm lives twice. That duplication once hid a REAL bug: both copies
 * used `version.split('-', 2)`, which silently DROPS the tail of a
 * multi-dash pre-release - '3.0.0-beta-1' sanitized to '3.0.0', colliding
 * with the stable version. This check re-executes the EXACT node body
 * embedded in the workflow (extracted, not copied) and asserts it agrees
 * with the shared module across a version battery. A future edit to either
 * copy that drifts from the other fails the commit (and the module's own
 * unit tests pin the intended mapping, so both drifting together also fails).
 *
 * The snippet is executed with `bun -e` (this repo's runtime) rather than
 * `node -e` (the workflow's runtime): the code is engine-neutral ECMAScript,
 * and running under bun keeps the check dependency-free in pre-commit.
 *
 * The check ALSO guards the version job's STEP ORDERING. The "Sanitize
 * expected manifest version" step reads `steps.resolve.outputs.version` in
 * its env, so "Resolve build version" MUST run first. A forward reference is
 * not a YAML error - the expression evaluates to an empty string and the
 * sanitizer silently emits its `0.0.0` fallback, which then fails the build
 * job's manifest comparison on EVERY release. The ordering guard asserts
 * resolve precedes sanitize AND that sanitize is still wired to the resolve
 * output (otherwise the ordering would be vacuous).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sanitizeVersionForManifest } from '../src/utils/version-sanitize.js';

const ROOT = join(import.meta.dir, '..');
const RELEASE_WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'release.yml');

/**
 * Versions both implementations must agree on. The EXPECTED outputs live only
 * in tests/unit/utils/version-sanitize.test.ts (the oracle for intent); this
 * list just exercises agreement across the shapes that occur in practice:
 * stable, multi-dash / single-dash / dotted pre-releases, 4-part cores,
 * over-range clamping, and garbage inputs.
 */
export const PARITY_VERSIONS: readonly string[] = [
  '3.0.0',
  '2.0.0',
  '0.0.0',
  '3.0.0-beta-1',
  '3.0.0-beta-8',
  '1.0.0-rc-1',
  '1.0.0-rc1',
  '3.1.0-beta.2',
  '2.0.0-alpha.10',
  '0.0.0-dev-3',
  '10.20.30.40-beta-5',
  '99999.0.0',
  '1.2.3-beta-99999',
  '0.0.0-dev',
  '3.0.0-beta',
  '1..3',
  'abc',
  '',
];

export const WORKFLOW_STEP_NAME = 'Sanitize expected manifest version';
export const RESOLVE_STEP_NAME = 'Resolve build version';

/**
 * Extract the JS body of the `node -e '...'` snippet from the workflow's
 * "Sanitize expected manifest version" step. Returns the code verbatim
 * (leading block indentation included) so what we execute is what CI runs.
 * Throws when the step or snippet cannot be found - the check FAILS CLOSED
 * if the workflow is restructured.
 */
export function extractSanitizeSnippet(workflowText: string): string {
  const norm = workflowText.replace(/\r\n/g, '\n');
  const stepIdx = norm.indexOf(`- name: ${WORKFLOW_STEP_NAME}`);
  if (stepIdx === -1) {
    throw new Error(
      `Step "${WORKFLOW_STEP_NAME}" not found in release.yml - ` +
        'rename it back or update WORKFLOW_STEP_NAME in check-version-parity.ts.'
    );
  }
  const marker = "node -e '\n";
  const snippetIdx = norm.indexOf(marker, stepIdx);
  if (snippetIdx === -1) {
    throw new Error(
      `No "node -e '" body found in the "${WORKFLOW_STEP_NAME}" step - ` +
        'the snippet moved or was rewritten in a way this extractor cannot find.'
    );
  }
  const bodyStart = snippetIdx + marker.length;
  // The body ends at the first line indented like the run-block content
  // (10 spaces) that closes the single quote: `          ')`.
  const close = norm.indexOf("\n          ')", bodyStart);
  if (close === -1) {
    throw new Error(
      `Unterminated node -e body in "${WORKFLOW_STEP_NAME}" - expected a ` +
        "closing `          ')` line."
    );
  }
  const body = norm.slice(bodyStart, close);
  if (body.length === 0) {
    throw new Error('Extracted an EMPTY node -e body - the snippet is missing its logic.');
  }
  return body;
}

/**
 * Execute the workflow snippet the way CI does: RAW_VERSION set in the
 * environment, result read from stdout.
 */
export function evaluateSnippet(snippet: string, version: string): string {
  const result = spawnSync(process.execPath, ['-e', snippet], {
    encoding: 'utf8',
    env: { ...process.env, RAW_VERSION: version },
    timeout: 10_000,
  });
  if (result.error) {
    throw new Error(`Failed to run the release.yml sanitize snippet: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `release.yml sanitize snippet exited ${result.status ?? 'non-zero'} for version ` +
        `"${version}":\n${result.stderr}`
    );
  }
  return result.stdout.trim();
}

export interface ParityIssue {
  version: string;
  workflowOutput: string;
  moduleOutput: string;
}

/**
 * Slice the body of the `version:` job (between its header and the next
 * sibling top-level job) out of the workflow text. Throws when the job
 * cannot be found - the check FAILS CLOSED if the workflow is restructured.
 */
export function extractVersionJobBody(norm: string): string {
  const marker = '\n  version:\n';
  const jobStart = norm.indexOf(marker);
  if (jobStart === -1) {
    throw new Error(
      'Job "version" not found in release.yml - rename it back or update ' +
        'check-version-parity.ts.'
    );
  }
  const lines = norm.slice(jobStart + marker.length).split('\n');
  let end = lines.length;
  // The version job's own keys are indented 4+; the first 2-space `name:`
  // after its header is the next sibling job.
  for (let i = 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(0, end).join('\n');
}

export interface StepOrderingIssue {
  code: 'resolve_after_sanitize' | 'sanitize_not_wired_to_resolve';
  message: string;
}

/**
 * Assert the version job runs "Resolve build version" BEFORE "Sanitize
 * expected manifest version" and that the sanitize step still consumes
 * `steps.resolve.outputs.version` in its env. Returns the problems found
 * (empty = ordering holds). Throws when either step disappears - FAILS
 * CLOSED on restructuring.
 */
export function checkVersionStepOrdering(workflowText: string): StepOrderingIssue[] {
  const norm = workflowText.replace(/\r\n/g, '\n');
  const jobBody = extractVersionJobBody(norm);

  const resolveMarker = `\n      - name: ${RESOLVE_STEP_NAME}`;
  const sanitizeMarker = `\n      - name: ${WORKFLOW_STEP_NAME}`;
  const resolveIdx = jobBody.indexOf(resolveMarker);
  const sanitizeIdx = jobBody.indexOf(sanitizeMarker);
  if (resolveIdx === -1) {
    throw new Error(
      `Step "${RESOLVE_STEP_NAME}" not found in the version job of release.yml - ` +
        'rename it back or update RESOLVE_STEP_NAME in check-version-parity.ts.'
    );
  }
  if (sanitizeIdx === -1) {
    throw new Error(
      `Step "${WORKFLOW_STEP_NAME}" not found in the version job of release.yml - ` +
        'rename it back or update WORKFLOW_STEP_NAME in check-version-parity.ts.'
    );
  }

  const problems: StepOrderingIssue[] = [];
  if (resolveIdx > sanitizeIdx) {
    problems.push({
      code: 'resolve_after_sanitize',
      message:
        `"${RESOLVE_STEP_NAME}" must run BEFORE "${WORKFLOW_STEP_NAME}" - the ` +
        'sanitize step reads steps.resolve.outputs.version in its env, and a ' +
        'forward reference silently evaluates to an empty string (sanitized ' +
        "to '0.0.0'), failing the build job's manifest comparison on every release.",
    });
  }

  // The ordering guard is vacuous if the sanitize step stops consuming the
  // resolve output - keep the wiring check alongside it.
  const nextStep = jobBody.indexOf('\n      - name:', sanitizeIdx + 1);
  const sanitizeBlock = jobBody.slice(sanitizeIdx, nextStep === -1 ? jobBody.length : nextStep);
  if (!sanitizeBlock.includes('steps.resolve.outputs.version')) {
    problems.push({
      code: 'sanitize_not_wired_to_resolve',
      message:
        `"${WORKFLOW_STEP_NAME}" no longer reads steps.resolve.outputs.version ` +
        'in its env - the ordering guard has nothing to protect. Restore the ' +
        'wiring or update check-version-parity.ts.',
    });
  }
  return problems;
}

/**
 * Assert the workflow snippet agrees with the shared module across the
 * battery. Returns the mismatches (empty = parity holds).
 */
export function checkVersionParity(
  versions: readonly string[],
  snippet: string,
  evaluate: (snippet: string, version: string) => string = evaluateSnippet
): ParityIssue[] {
  const issues: ParityIssue[] = [];
  for (const version of versions) {
    const workflowOutput = evaluate(snippet, version);
    const moduleOutput = sanitizeVersionForManifest(version);
    if (workflowOutput !== moduleOutput) {
      issues.push({ version, workflowOutput, moduleOutput });
    }
  }
  return issues;
}

function main(): void {
  let workflowText: string;
  let snippet: string;
  try {
    workflowText = readFileSync(RELEASE_WORKFLOW_PATH, 'utf8');
    snippet = extractSanitizeSnippet(workflowText);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  const issues = checkVersionParity(PARITY_VERSIONS, snippet);
  let ordering: StepOrderingIssue[] = [];
  try {
    ordering = checkVersionStepOrdering(workflowText);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  if (issues.length > 0 || ordering.length > 0) {
    if (issues.length > 0) {
      console.error(`\nVERSION PARITY DRIFT (${issues.length}):`);
      for (const { version, workflowOutput, moduleOutput } of issues) {
        const label = version === '' ? '(empty)' : version;
        console.error(`  ✗ "${label}": workflow=${workflowOutput}  module=${moduleOutput}`);
      }
      console.error(
        '\nThe release.yml sanitize step and src/utils/version-sanitize.ts disagree.\n' +
          'Fix whichever copy changed and keep them byte-for-byte in sync ' +
          '(update tests/unit/utils/version-sanitize.test.ts only if the MAPPING itself changed).'
      );
    }
    if (ordering.length > 0) {
      console.error(`\nVERSION JOB STEP-ORDER PROBLEMS (${ordering.length}):`);
      for (const { message } of ordering) console.error(`  ✗ ${message}`);
      console.error(
        '\nReorder the version job steps in release.yml so "Resolve build version" ' +
          'runs before "Sanitize expected manifest version" (and keep the env wiring).'
      );
    }
    process.exit(1);
  }

  console.log(
    `✓ release.yml "${WORKFLOW_STEP_NAME}" step matches ` +
      `src/utils/version-sanitize.ts across ${PARITY_VERSIONS.length} versions.`
  );
  console.log(
    `✓ version job ordering: "${RESOLVE_STEP_NAME}" precedes ` +
      `"${WORKFLOW_STEP_NAME}" and is wired to its output.`
  );
}

if (import.meta.main) main();
