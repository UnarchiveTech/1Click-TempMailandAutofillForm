/**
 * check-branch-protection.ts - fail when the live branch-protection gate on a
 * branch drifts (or disappears), so the enforcement policy set by
 * enforce-branch-protection.ts is verified like the other check-* gates
 * instead of trusted from memory.
 *
 * ── What it verifies ────────────────────────────────────────────────────────
 * The branch must be protected by AT LEAST ONE verifiable mechanism carrying
 * the required status-check contexts (default: "PR Validation / validate"):
 *   1. A repository/org RULESET with an active `required_status_checks` rule
 *      (via GET /repos/{owner}/{repo}/rules/branches/{branch} - needs only
 *      Metadata:read, so the CI GITHUB_TOKEN can read it), and/or
 *   2. CLASSIC branch protection with required status checks (via GET
 *      /branches/{branch}/protection - needs Administration:read, which the
 *      GITHUB_TOKEN does NOT have).
 * With --workflow <path> it additionally requires an active `workflows` rule
 * pointing at that workflow file (rulesets only - classic protection has no
 * workflow rule).
 *
 * ── Exit semantics (fail closed, skip only when unverifiable) ───────────────
 *   exit 1 - the gate is verifiably absent or drifted (contexts missing,
 *            status checks disabled, rulesets without a gate, or no
 *            protection at all). Remediation: run
 *            `bun scripts/enforce-branch-protection.ts` (or --ruleset).
 *   exit 0 - the gate is fully verified, OR verification was impossible:
 *            • no token found (set GH_TOKEN / GITHUB_TOKEN / gh auth login),
 *            • the token cannot read classic protection (HTTP 403 - the CI
 *              GITHUB_TOKEN case) and no ruleset gate exists. Adopt --ruleset
 *              enforcement to make the gate CI-verifiable.
 *   Note: rulesets in `evaluate`/`disabled` enforcement are not reported by
 *   the rules endpoint, so only `active` rulesets count as enforcement.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   bun scripts/check-branch-protection.ts
 *   bun scripts/check-branch-protection.ts --repo owner/name --branch main
 *   bun scripts/check-branch-protection.ts --workflow .github/workflows/pr-validation.yml
 *   bun scripts/check-branch-protection.ts --context "PR Validation / e2e-chrome"
 *
 * Runs inside `bun run audit`; skips with a warning when no token is
 * available so tokenless pre-commit runs stay green, and likewise skips when
 * no repository can be determined (no GITHUB_REPOSITORY, no parseable git
 * 'origin' remote, no --repo) so the check only runs where it can be
 * meaningful.
 */

import { execFileSync } from 'node:child_process';

import { DEFAULT_REQUIRED_CONTEXTS, detectRepo, pickToken } from './enforce-branch-protection';

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

/** Contexts required by active `required_status_checks` rules (repo + org rulesets). */
export function contextsFromRules(rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  const contexts: string[] = [];
  for (const entry of rules) {
    const rec = asRecord(entry);
    if (rec?.type !== 'required_status_checks') continue;
    const params = asRecord(rec.parameters);
    const checks = params?.required_status_checks;
    if (!Array.isArray(checks)) continue;
    for (const check of checks) {
      const cr = asRecord(check);
      if (cr && typeof cr.context === 'string') contexts.push(cr.context);
    }
  }
  return dedupe(contexts);
}

/** Workflow paths required by active `workflows` rules (repo + org rulesets). */
export function workflowPathsFromRules(rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  const paths: string[] = [];
  for (const entry of rules) {
    const rec = asRecord(entry);
    if (rec?.type !== 'workflows') continue;
    const params = asRecord(rec.parameters);
    const workflows = params?.workflows;
    if (!Array.isArray(workflows)) continue;
    for (const workflow of workflows) {
      const wr = asRecord(workflow);
      if (wr && typeof wr.path === 'string') paths.push(wr.path);
    }
  }
  return dedupe(paths);
}

/**
 * Contexts from classic branch protection, or null when required status
 * checks are disabled entirely (required_status_checks absent or null).
 */
export function contextsFromProtection(protection: unknown): string[] | null {
  const rec = asRecord(protection);
  const checks = rec?.required_status_checks;
  const inner = asRecord(checks);
  if (!inner) return null;
  const contexts = inner.contexts;
  return Array.isArray(contexts) ? contexts.filter((x): x is string => typeof x === 'string') : [];
}

export interface GateInput {
  requiredContexts: readonly string[];
  requiredWorkflows: readonly string[];
  /** Raw array from GET /repos/{owner}/{repo}/rules/branches/{branch}. */
  rules: unknown;
  /** HTTP status of GET /branches/{branch}/protection (200/403/404/other). */
  protectionStatus: number | null;
  /** Classic protection body (only meaningful when protectionStatus === 200). */
  protection: unknown;
}

export interface GateVerdict {
  pass: boolean;
  /** True when the gate could not be verified (warn, do not fail). */
  skip: boolean;
  messages: string[];
}

/**
 * Decide whether the branch's protection carries the required gate. Pure and
 * deterministic: pass when a verifiable mechanism (ruleset status-checks rule,
 * ruleset workflows rule, or classic protection) covers every required
 * context/workflow; fail on verifiable drift or absence; skip only when the
 * mechanism's existence cannot be confirmed (no read permission).
 */
export function evaluateGate(input: GateInput): GateVerdict {
  const rules = Array.isArray(input.rules) ? input.rules : [];
  const rulesContexts = contextsFromRules(rules);
  const rulesWorkflows = workflowPathsFromRules(rules);
  const hasRulesGate = rules.some((entry) => {
    const rec = asRecord(entry);
    return rec?.type === 'required_status_checks' || rec?.type === 'workflows';
  });

  const classicReadable = input.protectionStatus === 200;
  const classicContexts = classicReadable ? (contextsFromProtection(input.protection) ?? []) : [];

  if (classicReadable || hasRulesGate) {
    const allContexts = dedupe([...rulesContexts, ...classicContexts]);
    const messages: string[] = [];
    const missingContexts = input.requiredContexts.filter((c) => !allContexts.includes(c));
    if (missingContexts.length > 0) {
      messages.push(
        `required context(s) missing from every status-check source: ${missingContexts
          .map((c) => `"${c}"`)
          .join(', ')}`
      );
    }
    const missingWorkflows = input.requiredWorkflows.filter((p) => !rulesWorkflows.includes(p));
    if (missingWorkflows.length > 0) {
      messages.push(
        `required workflow rule(s) missing: ${missingWorkflows.join(', ')} (only rulesets can require workflows)`
      );
    }
    return messages.length === 0
      ? { pass: true, skip: false, messages: [] }
      : { pass: false, skip: false, messages };
  }

  if (rules.length === 0) {
    if (input.protectionStatus === 404) {
      return {
        pass: false,
        skip: false,
        messages: [
          'no branch protection and no ruleset gate found on this branch',
          'run: bun scripts/enforce-branch-protection.ts (add --ruleset for CI-verifiable enforcement)',
        ],
      };
    }
    if (input.protectionStatus === 403) {
      return {
        pass: false,
        skip: true,
        messages: [
          'cannot verify classic branch protection - the token lacks Administration:read and no ruleset gate is present. Adopt --ruleset enforcement or run locally with an admin token.',
        ],
      };
    }
    return {
      pass: false,
      skip: true,
      messages: [
        `cannot verify branch protection (protection endpoint HTTP ${input.protectionStatus ?? 'n/a'})`,
      ],
    };
  }

  return {
    pass: false,
    skip: false,
    messages: ['rulesets exist on this branch, but none requires the validation gate'],
  };
}

/* ---------------------------------------------------------------------------
 * CLI + network
 * ------------------------------------------------------------------------- */

interface CliOptions {
  repo: string | null;
  branch: string;
  token: string | null;
  requiredContexts: string[];
  requiredWorkflows: string[];
  help: boolean;
}

function defaultOptions(): CliOptions {
  return {
    repo: null,
    branch: 'main',
    token: null,
    requiredContexts: [],
    requiredWorkflows: [],
    help: false,
  };
}

function parseArgs(argv: string[]): CliOptions {
  const opts = defaultOptions();
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline: string | null = null;
    const eq = arg.match(/^--([a-z-]+)=(.*)$/);
    if (eq) {
      arg = `--${eq[1]}`;
      inline = eq[2];
    }
    const value = (): string | null =>
      inline ?? (i + 1 < argv.length ? (argv[i + 1] as string) : null);
    switch (arg) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--repo': {
        const v = value();
        if (v) {
          opts.repo = v;
          if (inline === null) i++;
        }
        break;
      }
      case '--branch': {
        const v = value();
        if (v) {
          opts.branch = v;
          if (inline === null) i++;
        }
        break;
      }
      case '--token': {
        const v = value();
        if (v) {
          opts.token = v;
          if (inline === null) i++;
        }
        break;
      }
      case '--context': {
        const v = value();
        if (v) {
          opts.requiredContexts.push(v);
          if (inline === null) i++;
        }
        break;
      }
      case '--workflow': {
        const v = value();
        if (v) {
          opts.requiredWorkflows.push(v);
          if (inline === null) i++;
        }
        break;
      }
      default:
        console.error(`Unknown argument: ${arg} (see --help)`);
        process.exit(1);
    }
  }
  return opts;
}

const HELP = `Usage: bun scripts/check-branch-protection.ts [options]

Fail when the live branch-protection gate drifts or disappears. Verified
sources: active rulesets (repo or org) with required_status_checks / workflows
rules, plus classic branch protection when the token can read it.

Options:
  --repo owner/name        Repository to check (default: GITHUB_REPOSITORY
                           env var, then the 'origin' git remote)
  --branch <name>          Branch to check (default: main)
  --token <token>          GitHub token (default: GH_TOKEN, GITHUB_TOKEN,
                           then gh auth token)
  --context <context>      Extra required status-check context (repeatable;
                           the default "${DEFAULT_REQUIRED_CONTEXTS.join(', ')}" is always required)
  --workflow <path>        Also require an active workflows rule with this
                           file path (repeatable; rulesets only)

Exits 1 when the gate is verifiably missing/drifted; 0 when verified or when
verification is impossible (no token, no repository configured, or no read
permission).`;

async function jsonApi<T>(
  apiBase: string,
  path: string,
  headers: Record<string, string>,
  method: 'GET'
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${apiBase}${path}`, { method, headers });
  let data: T = undefined as T;
  if (res.status !== 204) {
    try {
      data = (await res.json()) as T;
    } catch {
      /* non-JSON body - keep undefined */
    }
  }
  return { status: res.status, data };
}

function authHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function gitRemoteUrl(): string | null {
  try {
    const out = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function ghToken(): string | null {
  try {
    const out = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const repo = opts.repo ?? detectRepo(process.env, gitRemoteUrl());
  if (!repo) {
    console.warn(
      '⚠ no repository configured (no GITHUB_REPOSITORY, no parseable git origin remote, no --repo) - skipping remote check'
    );
    return;
  }
  const [owner, name, ...rest] = repo.split('/');
  if (!owner || !name || rest.length > 0) {
    fail(`invalid repository "${repo}" - expected owner/name`);
  }

  const token = opts.token ?? pickToken(process.env) ?? ghToken();
  if (!token) {
    console.warn(
      '⚠ no GitHub token found (GH_TOKEN / GITHUB_TOKEN / `gh auth login`) - skipping remote check'
    );
    return;
  }

  const apiBase = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
  const headers = authHeaders(token);
  const branch = opts.branch;

  let rules: unknown = [];
  try {
    const rulesRes = await jsonApi<unknown>(
      apiBase,
      `/repos/${owner}/${name}/rules/branches/${encodeURIComponent(branch)}`,
      headers,
      'GET'
    );
    if (rulesRes.status === 200) {
      rules = Array.isArray(rulesRes.data) ? rulesRes.data : [];
    } else if (rulesRes.status !== 404) {
      console.warn(
        `⚠ could not read rules for ${repo}:${branch} (HTTP ${rulesRes.status}) - skipping`
      );
      return;
    }
  } catch {
    console.warn(`⚠ network error reading rules for ${repo}:${branch} - skipping`);
    return;
  }

  let protectionStatus: number | null = null;
  let protection: unknown = null;
  try {
    const protectionRes = await jsonApi<unknown>(
      apiBase,
      `/repos/${owner}/${name}/branches/${encodeURIComponent(branch)}/protection`,
      headers,
      'GET'
    );
    protectionStatus = protectionRes.status;
    protection = protectionRes.status === 200 ? protectionRes.data : null;
  } catch {
    /* protection read failed - evaluateGate treats null status as unverifiable */
  }

  const requiredContexts = dedupe([...DEFAULT_REQUIRED_CONTEXTS, ...opts.requiredContexts]);
  const verdict = evaluateGate({
    requiredContexts,
    requiredWorkflows: opts.requiredWorkflows,
    rules,
    protectionStatus,
    protection,
  });

  const foundContexts = dedupe([
    ...contextsFromRules(rules),
    ...(protectionStatus === 200 ? (contextsFromProtection(protection) ?? []) : []),
  ]);
  const foundWorkflows = workflowPathsFromRules(rules);

  if (verdict.pass) {
    console.log(
      `✓ Branch protection gate intact on ${repo}:${branch} - required context(s) "${requiredContexts.join('", "')}" verified`
    );
    if (foundWorkflows.length > 0) {
      console.log(`  Required workflow rule(s): ${foundWorkflows.join(', ')}`);
    }
    return;
  }

  if (verdict.skip) {
    console.warn(`⚠ ${verdict.messages.join(' ')}`);
    return;
  }

  console.error(`✗ Branch protection drift on ${repo}:${branch}:`);
  for (const message of verdict.messages) console.error(`  - ${message}`);
  console.error(`  Found contexts: ${foundContexts.map((c) => `"${c}"`).join(', ') || '(none)'}`);
  if (foundWorkflows.length > 0) {
    console.error(`  Found workflows: ${foundWorkflows.join(', ')}`);
  }
  process.exit(1);
}

if (import.meta.main) main();
