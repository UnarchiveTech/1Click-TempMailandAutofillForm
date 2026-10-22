/**
 * enforce-branch-protection.ts - require validation checks on main so direct
 * pushes of unvalidated commits are REJECTED by GitHub, not just flagged red.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * The Main Push Validation workflow (added alongside this script) runs
 * audit + typecheck + tests on every push to main, but a workflow alone is a
 * tripwire: `git commit --no-verify && git push origin main` lands first and
 * turns red AFTER the fact. Branch protection makes the server reject the
 * push: once a required status check exists on the branch, GitHub refuses any
 * push whose commit does not already carry a successful/skipped/neutral status
 * for that check (docs: "After all required status checks pass, any commits
 * must either be pushed to another branch and then merged or pushed directly
 * to the protected branch").
 *
 * ── Why the required check is "PR Validation / validate" ────────────────────
 * The natural first guess is the workflow this script pairs with - but
 * "Main Push Validation / validate" triggers ONLY on pushes to main, so it
 * never reports on pull-request head commits. Requiring it would leave every
 * PR permanently stuck at "Expected - waiting for status to be reported"
 * (a required check with no reported status blocks merges), deadlocking the
 * merge button. "PR Validation / validate" reports on every PR head, so it:
 *   • keeps PR merges working - the check is green on the head, and the
 *     push-triggered Main Push Validation workflow then re-verifies the merge
 *     commit on main as a backstop, and
 *   • blocks exactly the hole - a fresh direct push to main has no reported
 *     status for the required check, so GitHub rejects it with:
 *       GH006: Protected branch update failed for refs/heads/main.
 *       Required status check "PR Validation / validate" is expected.
 * If you later want the literal main-push workflow as a required check, give
 * it a `pull_request` trigger first, then add it with --check.
 *
 * ── Ruleset mode (--ruleset) ────────────────────────────────────────────────
 * Classic branch protection (above) is the default. Passing --ruleset uses the
 * newer repository-rules API instead: the same gate expressed as a ruleset
 * with org-scoped bypass lists. The ruleset is identified by NAME (default
 * "Main validation gate" - pass the same --ruleset-name when re-running or
 * removing), and contains:
 *   • required_status_checks - the same PR Validation / validate gate as
 *     classic mode (strict via --strict),
 *   • workflows - requires a workflow to pass (default: pr-validation.yml).
 *     The rule demands a pull_request and/or merge_group trigger, so the
 *     push-only Main Push Validation workflow can NOT be required this way,
 *     and the rule itself is enterprise/org-scoped - drop it with
 *     --no-required-workflow on plans that reject it,
 *   • non_fast_forward + deletion - no force pushes, no branch deletion,
 *   • pull_request - only with --require-pr.
 * Bypass lists are org-scoped: --bypass-actor team:123:pull_request grants a
 * team a PR-only bypass; OrganizationAdmin and DeployKey take no id. When no
 * --bypass-actor is passed, the existing bypass list is preserved. Rules are
 * REPLACED wholesale on update (this script owns the named ruleset); the name,
 * enforcement level and bypass list are preserved unless overridden.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 * Reads the branch's CURRENT protection (if any) and merges this policy on
 * top instead of clobbering: existing required contexts are kept and extended,
 * existing review/restriction/linear-history settings are preserved. It never
 * adds a PR-review requirement unless asked (--require-pr). Admins are covered
 * by default (--no-enforce-admins to opt out).
 *
 * ── Prerequisites ───────────────────────────────────────────────────────────
 * • Admin (or owner) access to the repository.
 * • A token with "Administration" repository permission (write) - a classic
 *   PAT with the `repo` scope, or a fine-grained PAT / GitHub App token with
 *   Administration: write. Resolved from --token, then GH_TOKEN, then
 *   GITHUB_TOKEN, then `gh auth token`.
 * • Repo resolved from --repo, then the GITHUB_REPOSITORY env var, then the
 *   `origin` remote of the current checkout.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   bun scripts/enforce-branch-protection.ts                # require the gate
 *   bun scripts/enforce-branch-protection.ts --dry-run      # show, don't touch
 *   bun scripts/enforce-branch-protection.ts --strict       # require up-to-date
 *   bun scripts/enforce-branch-protection.ts --require-pr   # + 1-review PR rule
 *   bun scripts/enforce-branch-protection.ts --check "PR Validation / validate" \
 *        --check "PR Validation / e2e-chrome"               # extra required checks
 *   bun scripts/enforce-branch-protection.ts --remove --yes # undo everything
 *   bun scripts/enforce-branch-protection.ts --ruleset --dry-run
 *   bun scripts/enforce-branch-protection.ts --ruleset \
 *        --bypass-actor team:123456:pull_request
 *   bun scripts/enforce-branch-protection.ts --ruleset --remove --yes
 *
 * Exits 1 on any API failure; exits 0 after a successful dry-run or update.
 */

import { execFileSync } from 'node:child_process';

/** The check contexts this policy requires by default (see header for why). */
export const DEFAULT_REQUIRED_CONTEXTS: readonly string[] = ['PR Validation / validate'];

/** Default name used to identify the ruleset created by --ruleset mode. */
export const DEFAULT_RULESET_NAME = 'Main validation gate';

/**
 * Default workflow the ruleset mode requires to pass. Must trigger on
 * `pull_request` and/or `merge_group` - GitHub rejects required workflows
 * without one of those triggers (the push-only Main Push Validation workflow
 * therefore cannot be required here).
 */
export const DEFAULT_REQUIRED_WORKFLOW = '.github/workflows/pr-validation.yml';

const RULESET_ENFORCEMENTS = ['disabled', 'active', 'evaluate'] as const;
const BYPASS_ACTOR_TYPES = [
  'Integration',
  'OrganizationAdmin',
  'RepositoryRole',
  'Team',
  'DeployKey',
  'User',
] as const;
const BYPASS_MODES = ['always', 'pull_request', 'exempt'] as const;

/** Body shape accepted by PUT /repos/{owner}/{repo}/branches/{branch}/protection. */
export interface ProtectionBody {
  required_status_checks: { strict: boolean; contexts: string[] } | null;
  enforce_admins: boolean | null;
  required_pull_request_reviews: {
    required_approving_review_count: number;
    dismiss_stale_reviews: boolean;
    require_code_owner_reviews: boolean;
    require_last_push_approval: boolean;
  } | null;
  restrictions: { users: string[]; teams: string[]; apps: string[] } | null;
  required_linear_history: boolean;
  allow_force_pushes: boolean;
  allow_deletions: boolean;
  required_conversation_resolution: boolean;
  required_signatures: boolean;
}

export interface EnforceOptions {
  /** required_status_checks.strict - force branches up to date before merging. */
  strict: boolean;
  /** Add a 1-approving-review PR requirement (blocks direct pushes entirely). */
  requirePr: boolean;
  /** Apply the rules to admins too (the whole point of "blocked outright"). */
  enforceAdmins: boolean;
  /** Extra check contexts to require in addition to the defaults (deduped). */
  extraChecks: readonly string[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function asBooleanRecord(v: unknown): boolean {
  const rec = asRecord(v);
  return rec?.enabled === true;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/** Map an array of { login | slug, ... } entries to their identifier strings. */
function asIdList(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((entry) => {
      const rec = asRecord(entry);
      const value = rec?.[field];
      return typeof value === 'string' ? value : null;
    })
    .filter((x): x is string => x !== null);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

/**
 * Merge the enforcement policy on top of the branch's CURRENT protection
 * (the raw GET /protection response, or null when unprotected). Non-destructive:
 * existing contexts/checks are preserved and extended, existing review and
 * restriction settings are carried over, and the requested booleans only ever
 * move false -> true.
 */
export function buildProtectionBody(current: unknown, opts: EnforceOptions): ProtectionBody {
  const cur = asRecord(current);
  const existingChecks = asRecord(cur?.required_status_checks);

  const contexts = dedupe([
    ...asStringArray(existingChecks?.contexts),
    ...DEFAULT_REQUIRED_CONTEXTS,
    ...opts.extraChecks,
  ]);
  const strict = opts.strict || existingChecks?.strict === true;

  const existingReviews = asRecord(cur?.required_pull_request_reviews);
  const reviews = existingReviews
    ? {
        required_approving_review_count:
          typeof existingReviews.required_approving_review_count === 'number'
            ? (existingReviews.required_approving_review_count as number)
            : 1,
        dismiss_stale_reviews: existingReviews.dismiss_stale_reviews === true,
        require_code_owner_reviews: existingReviews.require_code_owner_reviews === true,
        require_last_push_approval: existingReviews.require_last_push_approval === true,
      }
    : opts.requirePr
      ? {
          required_approving_review_count: 1,
          dismiss_stale_reviews: false,
          require_code_owner_reviews: false,
          require_last_push_approval: false,
        }
      : null;

  const existingRestrictions = asRecord(cur?.restrictions);
  const restrictions = existingRestrictions
    ? {
        users: asIdList(existingRestrictions.users, 'login'),
        teams: asIdList(existingRestrictions.teams, 'slug'),
        apps: asIdList(existingRestrictions.apps, 'slug'),
      }
    : null;

  return {
    required_status_checks: { strict, contexts },
    enforce_admins: opts.enforceAdmins,
    required_pull_request_reviews: reviews,
    restrictions,
    required_linear_history: asBooleanRecord(cur?.required_linear_history),
    allow_force_pushes: asBooleanRecord(cur?.allow_force_pushes),
    allow_deletions: asBooleanRecord(cur?.allow_deletions),
    required_conversation_resolution: asBooleanRecord(cur?.required_conversation_resolution),
    required_signatures: asBooleanRecord(cur?.required_signatures),
  };
}

export interface BypassActor {
  actor_type: string;
  actor_id: number | null;
  bypass_mode: string;
}

/** Rule objects accepted by the repository-rules API (subset this script emits). */
export type RulesetRule =
  | {
      type: 'required_status_checks';
      parameters: {
        required_status_checks: { context: string }[];
        strict_required_status_checks_policy: boolean;
      };
    }
  | {
      type: 'workflows';
      parameters: { workflows: { path: string; repository_id: number; ref?: string }[] };
    }
  | {
      type: 'pull_request';
      parameters: {
        required_approving_review_count: number;
        dismiss_stale_reviews_on_push: boolean;
        require_code_owner_review: boolean;
        require_last_push_approval: boolean;
        required_review_thread_resolution: boolean;
      };
    }
  | { type: 'non_fast_forward' }
  | { type: 'deletion' };

/** Body shape accepted by POST/PUT /repos/{owner}/{repo}/rulesets. */
export interface RulesetBody {
  name: string;
  target: 'branch';
  enforcement: string;
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: RulesetRule[];
  bypass_actors?: BypassActor[];
}

export interface RulesetOptions {
  /** Ruleset name; null keeps the existing name (or DEFAULT_RULESET_NAME). */
  name: string | null;
  /** active | evaluate | disabled; null keeps the existing level (or active). */
  enforcement: string | null;
  branch: string;
  /** Extra ref patterns excluded from the ruleset condition. */
  excludeBranches: readonly string[];
  /** Workflow path for the workflows rule, or null to omit the rule. */
  requiredWorkflowPath: string | null;
  /** Ref the required workflow file is read from (null = default branch). */
  workflowRef: string | null;
  /** Numeric id of the repository owning the required workflow. */
  workflowRepositoryId: number;
  strict: boolean;
  requirePr: boolean;
  /** Extra check contexts for the required_status_checks rule. */
  requiredChecks: readonly string[];
  /** Explicit bypass list; null preserves the existing list (or none). */
  bypassActors: readonly BypassActor[] | null;
}

/**
 * Parse a --bypass-actor spec: `Type[:id][:mode]`.
 *   team:123:pull_request   - team 123 may bypass on pull requests only
 *   OrganizationAdmin       - org admins bypass (no id)
 *   user:456                - user 456 bypasses always
 * Types: Integration, OrganizationAdmin, RepositoryRole, Team, DeployKey, User.
 * Modes: always (default), pull_request, exempt.
 */
export function parseBypassActor(spec: string): BypassActor | null {
  const [rawType, rawId, rawMode] = spec.split(':');
  if (!rawType) return null;
  const actorType = BYPASS_ACTOR_TYPES.find((t) => t.toLowerCase() === rawType.toLowerCase());
  if (!actorType) return null;

  let actorId: number | null = null;
  if (rawId !== undefined && rawId !== '') {
    const parsed = Number(rawId);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    actorId = parsed;
  }

  let bypassMode = 'always';
  if (rawMode !== undefined && rawMode !== '') {
    if (!(BYPASS_MODES as readonly string[]).includes(rawMode)) return null;
    bypassMode = rawMode;
  }

  // OrganizationAdmin ignores the id; DeployKey requires it to be null;
  // the rest require a numeric id.
  if (actorType === 'OrganizationAdmin' || actorType === 'DeployKey') {
    if (actorId !== null) return null;
  } else if (actorId === null) {
    return null;
  }
  if (actorType === 'DeployKey' && bypassMode === 'pull_request') return null;

  return { actor_type: actorType, actor_id: actorId, bypass_mode: bypassMode };
}

/**
 * Build the ruleset body. Unlike classic protection (which merges on top of
 * the existing config), the rules are REPLACED wholesale - this script owns
 * the named ruleset. The name, enforcement level and bypass list are preserved
 * from the existing ruleset unless explicitly overridden.
 */
export function buildRulesetBody(current: unknown, opts: RulesetOptions): RulesetBody {
  const cur = asRecord(current);

  const rules: RulesetRule[] = [];
  const contexts = dedupe([...DEFAULT_REQUIRED_CONTEXTS, ...opts.requiredChecks]);
  rules.push({
    type: 'required_status_checks',
    parameters: {
      required_status_checks: contexts.map((context) => ({ context })),
      strict_required_status_checks_policy: opts.strict,
    },
  });

  if (opts.requiredWorkflowPath) {
    if (opts.workflowRepositoryId <= 0) {
      throw new Error('workflowRepositoryId is required when a required workflow is configured');
    }
    rules.push({
      type: 'workflows',
      parameters: {
        workflows: [
          {
            path: opts.requiredWorkflowPath,
            repository_id: opts.workflowRepositoryId,
            ...(opts.workflowRef ? { ref: opts.workflowRef } : {}),
          },
        ],
      },
    });
  }

  if (opts.requirePr) {
    rules.push({
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    });
  }

  rules.push({ type: 'non_fast_forward' }, { type: 'deletion' });

  const rawActors = cur?.bypass_actors;
  const existingActors: unknown[] = Array.isArray(rawActors) ? rawActors : [];
  const preservedActors: BypassActor[] | null =
    existingActors.length > 0
      ? existingActors
          .map((entry): BypassActor | null => {
            const rec = asRecord(entry);
            if (!rec || typeof rec.actor_type !== 'string') return null;
            return {
              actor_type: rec.actor_type,
              actor_id: typeof rec.actor_id === 'number' ? rec.actor_id : null,
              bypass_mode: typeof rec.bypass_mode === 'string' ? rec.bypass_mode : 'always',
            };
          })
          .filter((x): x is BypassActor => x !== null)
      : null;
  const bypassActors = opts.bypassActors ? [...opts.bypassActors] : preservedActors;

  const existingName = cur?.name;
  const existingEnforcement = cur?.enforcement;
  return {
    name: opts.name ?? (typeof existingName === 'string' ? existingName : DEFAULT_RULESET_NAME),
    target: 'branch',
    enforcement:
      opts.enforcement ??
      (typeof existingEnforcement === 'string' ? existingEnforcement : 'active'),
    conditions: {
      ref_name: {
        include: [`refs/heads/${opts.branch}`],
        exclude: [...opts.excludeBranches],
      },
    },
    rules,
    ...(bypassActors ? { bypass_actors: bypassActors } : {}),
  };
}

/** Parse scp-like and URL-like git remote strings into { owner, repo }. */
export function parseRepoFromRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim().replace(/\.git$/, '');
  // scp-like paths never start with '/'; a '//' after the colon is a URL scheme.
  const scp = trimmed.match(/^(?:[^@/]+@)?[^:/]+:([^/].*)$/);
  const url = trimmed.match(/^(?:https?|ssh|git):\/\/[^/]+\/(.+)$/);
  const path = scp?.[1] ?? url?.[1];
  if (!path) return null;
  const [owner, repo, ...rest] = path.split('/').filter(Boolean);
  if (!owner || !repo || rest.length > 0) return null;
  return { owner, repo };
}

/** Resolve owner/repo: --repo > GITHUB_REPOSITORY > parsed origin remote. */
export function detectRepo(
  env: Record<string, string | undefined>,
  remoteUrl: string | null
): string | null {
  const fromEnv = env.GITHUB_REPOSITORY?.trim();
  if (fromEnv) return fromEnv;
  if (!remoteUrl) return null;
  const parsed = parseRepoFromRemote(remoteUrl);
  return parsed ? `${parsed.owner}/${parsed.repo}` : null;
}

/** First usable token from the env (GH_TOKEN takes precedence over GITHUB_TOKEN). */
export function pickToken(env: Record<string, string | undefined>): string | null {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  return token?.trim() || null;
}

/* ---------------------------------------------------------------------------
 * CLI + network (not unit-tested; keep everything above pure)
 * ------------------------------------------------------------------------- */

interface CliOptions {
  repo: string | null;
  branch: string;
  token: string | null;
  extraChecks: string[];
  strict: boolean;
  requirePr: boolean;
  enforceAdmins: boolean;
  dryRun: boolean;
  remove: boolean;
  yes: boolean;
  help: boolean;
  /** Use a repository ruleset instead of classic branch protection. */
  rulesetMode: boolean;
  rulesetName: string | null;
  enforcement: string | null;
  excludeBranches: string[];
  requiredWorkflowPath: string | null;
  workflowRef: string | null;
  workflowRepositoryId: number | null;
  bypassActors: BypassActor[] | null;
}

function defaultOptions(): CliOptions {
  return {
    repo: null,
    branch: 'main',
    token: null,
    extraChecks: [],
    strict: false,
    requirePr: false,
    enforceAdmins: true,
    dryRun: false,
    remove: false,
    yes: false,
    help: false,
    rulesetMode: false,
    rulesetName: null,
    enforcement: null,
    excludeBranches: [],
    requiredWorkflowPath: DEFAULT_REQUIRED_WORKFLOW,
    workflowRef: null,
    workflowRepositoryId: null,
    bypassActors: null,
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
      case '--check': {
        const v = value();
        if (v) {
          opts.extraChecks.push(v);
          if (inline === null) i++;
        }
        break;
      }
      case '--ruleset':
        opts.rulesetMode = true;
        break;
      case '--ruleset-name': {
        const v = value();
        if (v) {
          opts.rulesetName = v;
          if (inline === null) i++;
        }
        break;
      }
      case '--enforcement': {
        const v = value();
        if (v) {
          if (!(RULESET_ENFORCEMENTS as readonly string[]).includes(v)) {
            console.error(
              `Invalid enforcement "${v}" - expected ${RULESET_ENFORCEMENTS.join(' | ')}`
            );
            process.exit(1);
          }
          opts.enforcement = v;
          if (inline === null) i++;
        }
        break;
      }
      case '--exclude-branch': {
        const v = value();
        if (v) {
          opts.excludeBranches.push(v);
          if (inline === null) i++;
        }
        break;
      }
      case '--required-workflow': {
        const v = value();
        if (v) {
          opts.requiredWorkflowPath = v;
          if (inline === null) i++;
        }
        break;
      }
      case '--no-required-workflow':
        opts.requiredWorkflowPath = null;
        break;
      case '--workflow-ref': {
        const v = value();
        if (v) {
          opts.workflowRef = v;
          if (inline === null) i++;
        }
        break;
      }
      case '--workflow-repository-id': {
        const v = value();
        if (v) {
          const parsed = Number(v);
          if (!Number.isInteger(parsed) || parsed <= 0) {
            console.error(`Invalid repository id "${v}" - expected a positive integer`);
            process.exit(1);
          }
          opts.workflowRepositoryId = parsed;
          if (inline === null) i++;
        }
        break;
      }
      case '--bypass-actor': {
        const v = value();
        if (v) {
          const actor = parseBypassActor(v);
          if (!actor) {
            console.error(
              `Invalid bypass actor "${v}" - expected Type[:id][:mode] with Type in ${BYPASS_ACTOR_TYPES.join(', ')}`
            );
            process.exit(1);
          }
          opts.bypassActors = [...(opts.bypassActors ?? []), actor];
          if (inline === null) i++;
        }
        break;
      }
      case '--strict':
        opts.strict = true;
        break;
      case '--require-pr':
        opts.requirePr = true;
        break;
      case '--no-enforce-admins':
        opts.enforceAdmins = false;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--remove':
        opts.remove = true;
        break;
      case '--yes':
        opts.yes = true;
        break;
      default:
        console.error(`Unknown argument: ${arg} (see --help)`);
        process.exit(1);
    }
  }
  return opts;
}

const HELP = `Usage: bun scripts/enforce-branch-protection.ts [options]

Require validation checks on a branch so direct pushes of unvalidated commits
are rejected server-side (GH006 ... is expected) instead of merely flagged red.

Options:
  --repo owner/name        Repository to protect (default: GITHUB_REPOSITORY
                           env var, then the 'origin' git remote)
  --branch <name>          Branch to protect (default: main)
  --token <token>          GitHub token with Administration:write on the repo
                           (default: GH_TOKEN, GITHUB_TOKEN, then gh auth token)
  --check <context>        Extra required check context (repeatable)
  --strict                 Require branches to be up to date before merging
  --require-pr             Also require 1 approving PR review (blocks direct
                           pushes entirely)
  --no-enforce-admins      Leave admins exempt (default: rules apply to admins)
  --dry-run                Print the planned protection without changing it
  --remove --yes           Delete branch protection entirely (undo)

Ruleset mode (alternative to classic protection - pass --ruleset):
  --ruleset                Enforce via a repository ruleset instead of the
                           classic branch-protection API
  --ruleset-name <name>    Ruleset name (default: "${DEFAULT_RULESET_NAME}";
                           pass the same name when re-running/removing)
  --enforcement <level>    active | evaluate | disabled (default: keep the
                           existing level, or active)
  --exclude-branch <pat>   Extra ref pattern excluded from the ruleset
  --required-workflow <path>  Workflow that must pass (default:
                           ${DEFAULT_REQUIRED_WORKFLOW}). Must trigger on
                           pull_request and/or merge_group; the rule itself is
                           enterprise/org-scoped
  --no-required-workflow   Drop the workflows rule (status checks still apply)
  --workflow-ref <ref>     Ref the required workflow file is read from
                           (default: the default branch)
  --workflow-repository-id <id>  Numeric id of the repo owning the workflow
                           (default: this repository)
  --bypass-actor <spec>    Org-scoped bypass, e.g. team:123:pull_request,
                           OrganizationAdmin, user:456 (repeatable)

Default required check: ${DEFAULT_REQUIRED_CONTEXTS.join(', ')}
  (runs on every PR head, so the merge button keeps working; a push-only
  workflow like "Main Push Validation / validate" would deadlock PR merges
  unless it also triggers on pull_request.)`;

async function jsonApi<T>(
  apiBase: string,
  path: string,
  headers: Record<string, string>,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  body?: unknown
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: T = undefined as T;
  if (res.status !== 204) {
    try {
      data = (await res.json()) as T;
    } catch {
      /* non-JSON error body - keep undefined */
    }
  }
  return { status: res.status, data };
}

function authHeaders(token: string, apiVersion: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': apiVersion,
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

function printSummary(repo: string, branch: string, body: ProtectionBody): void {
  const checks = body.required_status_checks?.contexts ?? [];
  console.log(`✓ Branch protection applied to ${repo}:${branch}`);
  console.log(`  Required checks: ${checks.map((c) => `"${c}"`).join(', ') || '(none)'}`);
  console.log(`  Strict (up-to-date): ${body.required_status_checks?.strict ?? false}`);
  console.log(`  Enforce for admins: ${body.enforce_admins === true}`);
  console.log(
    `  PR reviews required: ${
      body.required_pull_request_reviews
        ? `yes (${body.required_pull_request_reviews.required_approving_review_count} approval)`
        : 'no'
    }`
  );
  console.log('');
  console.log(
    'Direct pushes of commits without a passing required check are now rejected by\n' +
      'the server (GH006: ... "PR Validation / validate" is expected). PR merges keep\n' +
      'working because that check reports on every PR head. To undo, run:\n' +
      '  bun scripts/enforce-branch-protection.ts --remove --yes'
  );
}

interface RepoContext {
  repo: string;
  owner: string;
  name: string;
  branch: string;
  apiBase: string;
  headers: Record<string, string>;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const repo = opts.repo ?? detectRepo(process.env, gitRemoteUrl());
  if (!repo) {
    fail('could not determine the repository - pass --repo owner/name (or set GITHUB_REPOSITORY)');
  }
  const [owner, name, ...rest] = repo.split('/');
  if (!owner || !name || rest.length > 0) {
    fail(`invalid repository "${repo}" - expected owner/name`);
  }

  const token = opts.token ?? pickToken(process.env) ?? ghToken();
  if (!token) {
    fail(
      'no GitHub token found - pass --token, set GH_TOKEN/GITHUB_TOKEN, or log in with `gh auth login`'
    );
  }

  const apiBase = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
  const headers = authHeaders(token, '2022-11-28');
  const ctx: RepoContext = { repo, owner, name, branch: opts.branch, apiBase, headers };

  if (opts.rulesetMode) {
    await runRulesetMode(opts, ctx);
  } else {
    await runProtectionMode(opts, ctx);
  }
}

/** Classic branch protection: PUT /repos/{owner}/{repo}/branches/{branch}/protection. */
async function runProtectionMode(opts: CliOptions, ctx: RepoContext): Promise<void> {
  const { repo, branch, apiBase, headers } = ctx;
  const path = `/repos/${ctx.owner}/${ctx.name}/branches/${encodeURIComponent(branch)}/protection`;

  if (opts.remove) {
    if (!opts.yes) {
      fail('--remove deletes ALL branch protection on this branch - confirm with --yes');
    }
    const { status } = await jsonApi<unknown>(apiBase, path, headers, 'DELETE');
    if (status === 204 || status === 200) {
      console.log(`✓ Branch protection removed from ${repo}:${branch}`);
    } else {
      fail(`DELETE protection failed (HTTP ${status})`);
    }
    return;
  }

  const current = await jsonApi<unknown>(apiBase, path, headers, 'GET');
  const currentProtection =
    current.status === 404 ? null : current.status === 200 ? current.data : null;
  if (current.status !== 200 && current.status !== 404) {
    fail(`could not read current protection (HTTP ${current.status})`);
  }

  const body = buildProtectionBody(currentProtection, {
    strict: opts.strict,
    requirePr: opts.requirePr,
    enforceAdmins: opts.enforceAdmins,
    extraChecks: opts.extraChecks,
  });

  if (opts.dryRun) {
    console.log(
      `DRY RUN - ${repo}:${branch} is currently ${currentProtection ? 'protected' : 'unprotected'}`
    );
    console.log('Planned PUT body:');
    console.log(JSON.stringify(body, null, 2));
    console.log('\nNothing was changed.');
    return;
  }

  const { status, data } = await jsonApi<{ message?: string }>(apiBase, path, headers, 'PUT', body);
  if (status !== 200) {
    const detail = typeof data?.message === 'string' ? ` - ${data.message}` : '';
    fail(
      `update branch protection failed (HTTP ${status})${detail} - check that the token has Administration:write`
    );
  }
  printSummary(repo, branch, body);
}

/** Ruleset mode: find the named repo-level ruleset, then create or update it. */
async function runRulesetMode(opts: CliOptions, ctx: RepoContext): Promise<void> {
  const { repo, owner, name, branch, apiBase, headers } = ctx;
  const rulesetsPath = `/repos/${owner}/${name}/rulesets`;
  const rulesetName = opts.rulesetName ?? DEFAULT_RULESET_NAME;

  if (opts.remove) {
    if (!opts.yes) {
      fail('--remove deletes the ruleset - confirm with --yes');
    }
    const existing = await findRuleset(apiBase, rulesetsPath, headers, rulesetName);
    if (!existing) {
      fail(`no repository ruleset named "${rulesetName}" found on ${repo}`);
    }
    const { status } = await jsonApi<unknown>(
      apiBase,
      `${rulesetsPath}/${existing.id}`,
      headers,
      'DELETE'
    );
    if (status === 204 || status === 200) {
      console.log(`✓ Ruleset "${rulesetName}" removed from ${repo}`);
    } else {
      fail(`DELETE ruleset failed (HTTP ${status})`);
    }
    return;
  }

  let workflowRepositoryId = opts.workflowRepositoryId;
  if (workflowRepositoryId === null && opts.requiredWorkflowPath !== null) {
    const repoInfo = await jsonApi<{ id?: number }>(
      apiBase,
      `/repos/${owner}/${name}`,
      headers,
      'GET'
    );
    if (repoInfo.status !== 200 || typeof repoInfo.data?.id !== 'number') {
      fail(
        `could not resolve the repository id for ${repo} (HTTP ${repoInfo.status}) - pass --workflow-repository-id`
      );
    }
    workflowRepositoryId = repoInfo.data.id;
  }

  const existing = await findRuleset(apiBase, rulesetsPath, headers, rulesetName);
  const current = existing ? await getRuleset(apiBase, rulesetsPath, headers, existing.id) : null;

  const body = buildRulesetBody(current, {
    name: opts.rulesetName,
    enforcement: opts.enforcement,
    branch,
    excludeBranches: opts.excludeBranches,
    requiredWorkflowPath: opts.requiredWorkflowPath,
    workflowRef: opts.workflowRef,
    workflowRepositoryId: workflowRepositoryId ?? 0,
    strict: opts.strict,
    requirePr: opts.requirePr,
    requiredChecks: opts.extraChecks,
    bypassActors: opts.bypassActors,
  });

  if (opts.dryRun) {
    console.log(
      `DRY RUN - ${repo} ${
        existing
          ? `ruleset "${rulesetName}" exists (id ${existing.id}) - would UPDATE`
          : `no ruleset named "${rulesetName}" - would CREATE`
      }`
    );
    console.log('Planned ruleset body:');
    console.log(JSON.stringify(body, null, 2));
    console.log('\nNothing was changed.');
    return;
  }

  const endpoint = existing ? `${rulesetsPath}/${existing.id}` : rulesetsPath;
  const { status, data } = await jsonApi<{ message?: string }>(
    apiBase,
    endpoint,
    headers,
    existing ? 'PUT' : 'POST',
    body
  );
  if (status !== 200 && status !== 201) {
    const detail = typeof data?.message === 'string' ? ` - ${data.message}` : '';
    fail(
      `${existing ? 'update' : 'create'} ruleset failed (HTTP ${status})${detail} - check that the token has Administration:write`
    );
  }
  printRulesetSummary(repo, branch, body);
}

/** Find a REPO-level ruleset by name (org-level rulesets are excluded). */
async function findRuleset(
  apiBase: string,
  rulesetsPath: string,
  headers: Record<string, string>,
  name: string
): Promise<{ id: number } | null> {
  const list = await jsonApi<Array<{ id: number; name?: string; source_type?: string }>>(
    apiBase,
    `${rulesetsPath}?per_page=100&includes_parents=false`,
    headers,
    'GET'
  );
  const items = Array.isArray(list.data) ? list.data : [];
  const match = items.find(
    (r) => r.name === name && (r.source_type === 'Repository' || r.source_type === undefined)
  );
  return match ? { id: match.id } : null;
}

async function getRuleset(
  apiBase: string,
  rulesetsPath: string,
  headers: Record<string, string>,
  id: number
): Promise<unknown | null> {
  const res = await jsonApi<unknown>(apiBase, `${rulesetsPath}/${id}`, headers, 'GET');
  return res.status === 200 ? res.data : null;
}

function printRulesetSummary(repo: string, branch: string, body: RulesetBody): void {
  console.log(`✓ Ruleset "${body.name}" applied to ${repo} (${branch})`);
  console.log(`  Enforcement: ${body.enforcement}`);
  console.log('  Rules:');
  for (const rule of body.rules) {
    if (rule.type === 'required_status_checks') {
      console.log(
        `    - required_status_checks: ${
          rule.parameters.required_status_checks.map((c) => `"${c.context}"`).join(', ') || '(none)'
        }${rule.parameters.strict_required_status_checks_policy ? ' (strict)' : ''}`
      );
    } else if (rule.type === 'workflows') {
      console.log(
        `    - workflows: ${rule.parameters.workflows.map((w) => `${w.path} (repo ${w.repository_id})`).join(', ')}`
      );
    } else if (rule.type === 'pull_request') {
      console.log(
        `    - pull_request: ${rule.parameters.required_approving_review_count} approval`
      );
    } else {
      console.log(`    - ${rule.type}`);
    }
  }
  const bypasses = body.bypass_actors ?? [];
  console.log(
    bypasses.length > 0
      ? `  Bypass actors: ${bypasses.map((b) => `${b.actor_type}:${b.actor_id ?? '-'}:${b.bypass_mode}`).join(', ')}`
      : '  Bypass actors: none'
  );
  console.log('');
  console.log(
    'Direct pushes and PR merges on this branch must pass the rules above. To undo:\n' +
      '  bun scripts/enforce-branch-protection.ts --ruleset --remove --yes'
  );
}

if (import.meta.main) main();
