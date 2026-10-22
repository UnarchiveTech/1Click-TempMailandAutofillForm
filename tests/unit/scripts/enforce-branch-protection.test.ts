/**
 * Unit tests for scripts/enforce-branch-protection.ts.
 *
 * The script configures GitHub branch protection so direct pushes of
 * unvalidated commits are rejected server-side. The pure helpers pinned here
 * are the parts that decide WHAT gets sent to GitHub:
 *   - parseRepoFromRemote / detectRepo - where the owner/repo comes from,
 *   - pickToken - which credential wins,
 *   - buildProtectionBody - the merge of the enforcement policy on top of the
 *     branch's CURRENT protection (must be non-destructive: existing contexts,
 *     review counts, restrictions and linear-history settings survive).
 *
 * DEFAULT_REQUIRED_CONTEXTS is asserted explicitly so a rename of the required
 * check (which would silently change the merge-button behavior the script
 * documents) breaks CI.
 */

import { describe, expect, test } from 'bun:test';

import {
  buildProtectionBody,
  buildRulesetBody,
  DEFAULT_REQUIRED_CONTEXTS,
  DEFAULT_REQUIRED_WORKFLOW,
  DEFAULT_RULESET_NAME,
  detectRepo,
  type EnforceOptions,
  type ProtectionBody,
  parseBypassActor,
  parseRepoFromRemote,
  pickToken,
  type RulesetOptions,
} from '../../../scripts/enforce-branch-protection';

const baseOptions: EnforceOptions = {
  strict: false,
  requirePr: false,
  enforceAdmins: true,
  extraChecks: [],
};

describe('parseRepoFromRemote', () => {
  test('parses scp-like remotes (git@github.com:owner/repo.git)', () => {
    expect(parseRepoFromRemote('git@github.com:owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  test('parses https and ssh URL remotes', () => {
    expect(parseRepoFromRemote('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseRepoFromRemote('ssh://git@github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseRepoFromRemote('git://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  test('rejects non-remote strings and nested paths', () => {
    expect(parseRepoFromRemote('not-a-url')).toBeNull();
    expect(parseRepoFromRemote('https://github.com/owner/repo/extra')).toBeNull();
    expect(parseRepoFromRemote('')).toBeNull();
  });
});

describe('detectRepo', () => {
  test('GITHUB_REPOSITORY env wins over the remote', () => {
    expect(
      detectRepo({ GITHUB_REPOSITORY: 'env/owner-repo' }, 'git@github.com:remote/repo.git')
    ).toBe('env/owner-repo');
  });

  test('falls back to parsing the origin remote', () => {
    expect(detectRepo({}, 'git@github.com:owner/repo.git')).toBe('owner/repo');
  });

  test('returns null when nothing is available', () => {
    expect(detectRepo({}, null)).toBeNull();
    expect(detectRepo({}, 'not-a-url')).toBeNull();
  });
});

describe('pickToken', () => {
  test('GH_TOKEN takes precedence over GITHUB_TOKEN', () => {
    expect(pickToken({ GH_TOKEN: 'gh', GITHUB_TOKEN: 'github' })).toBe('gh');
  });

  test('GITHUB_TOKEN is used when GH_TOKEN is absent', () => {
    expect(pickToken({ GITHUB_TOKEN: 'github' })).toBe('github');
  });

  test('returns null for missing or whitespace-only values', () => {
    expect(pickToken({})).toBeNull();
    expect(pickToken({ GH_TOKEN: '   ' })).toBeNull();
  });
});

describe('buildProtectionBody', () => {
  test('fresh protection: default contexts, admins enforced, nothing else', () => {
    const body = buildProtectionBody(null, baseOptions);
    expect(body.required_status_checks).toEqual({
      strict: false,
      contexts: [...DEFAULT_REQUIRED_CONTEXTS],
    });
    expect(body.enforce_admins).toBe(true);
    expect(body.required_pull_request_reviews).toBeNull();
    expect(body.restrictions).toBeNull();
    expect(body.required_linear_history).toBe(false);
    expect(body.allow_force_pushes).toBe(false);
    expect(body.allow_deletions).toBe(false);
    expect(body.required_conversation_resolution).toBe(false);
    expect(body.required_signatures).toBe(false);
  });

  test('the required check is pinned so a rename breaks CI', () => {
    expect(DEFAULT_REQUIRED_CONTEXTS).toEqual(['PR Validation / validate']);
  });

  test('merges existing contexts with the defaults and extra checks, deduped', () => {
    const current = { required_status_checks: { strict: true, contexts: ['old/check'] } };
    const body = buildProtectionBody(current, {
      ...baseOptions,
      extraChecks: ['new/check', 'PR Validation / validate'],
    });
    expect(body.required_status_checks?.contexts).toEqual([
      'old/check',
      'PR Validation / validate',
      'new/check',
    ]);
    // Existing strict setting is preserved unless --strict forces it.
    expect(body.required_status_checks?.strict).toBe(true);
  });

  test('--strict forces up-to-date even when the current rule is loose', () => {
    const current = { required_status_checks: { strict: false, contexts: [] } };
    const body = buildProtectionBody(current, { ...baseOptions, strict: true });
    expect(body.required_status_checks?.strict).toBe(true);
  });

  test('--require-pr adds a 1-approval review rule when none exists', () => {
    const body = buildProtectionBody(null, { ...baseOptions, requirePr: true });
    expect(body.required_pull_request_reviews).toEqual({
      required_approving_review_count: 1,
      dismiss_stale_reviews: false,
      require_code_owner_reviews: false,
      require_last_push_approval: false,
    });
  });

  test('existing review settings are carried over untouched', () => {
    const current = {
      required_pull_request_reviews: {
        required_approving_review_count: 2,
        dismiss_stale_reviews: true,
        require_code_owner_reviews: true,
        require_last_push_approval: true,
      },
    };
    const body = buildProtectionBody(current, baseOptions);
    expect(body.required_pull_request_reviews).toEqual({
      required_approving_review_count: 2,
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
      require_last_push_approval: true,
    });
  });

  test('restrictions are mapped from user/team/app objects to identifiers', () => {
    const current = {
      restrictions: {
        users: [{ login: 'alice' }, { login: 'bob' }],
        teams: [{ slug: 'core' }],
        apps: [{ slug: 'ci-app' }],
      },
    };
    const body = buildProtectionBody(current, baseOptions);
    expect(body.restrictions).toEqual({
      users: ['alice', 'bob'],
      teams: ['core'],
      apps: ['ci-app'],
    });
  });

  test('enabled boolean policies are preserved', () => {
    const current = {
      required_linear_history: { enabled: true },
      required_conversation_resolution: { enabled: true },
      allow_force_pushes: { enabled: false },
    };
    const body = buildProtectionBody(current, baseOptions);
    expect(body.required_linear_history).toBe(true);
    expect(body.required_conversation_resolution).toBe(true);
    expect(body.allow_force_pushes).toBe(false);
  });

  test('enforce_admins is forced on (the point of "blocked outright")', () => {
    const current = { enforce_admins: { enabled: false } };
    const body = buildProtectionBody(current, baseOptions);
    expect(body.enforce_admins).toBe(true);
    const optOut = buildProtectionBody(current, { ...baseOptions, enforceAdmins: false });
    expect(optOut.enforce_admins).toBe(false);
  });

  test('output is JSON-serializable (what PUT sends)', () => {
    const body: ProtectionBody = buildProtectionBody(null, baseOptions);
    expect(() => JSON.stringify(body)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(body)) as ProtectionBody;
    expect(parsed).toEqual(body);
  });
});

const baseRulesetOptions: RulesetOptions = {
  name: null,
  enforcement: null,
  branch: 'main',
  excludeBranches: [],
  requiredWorkflowPath: DEFAULT_REQUIRED_WORKFLOW,
  workflowRef: null,
  workflowRepositoryId: 12345,
  strict: false,
  requirePr: false,
  requiredChecks: [],
  bypassActors: null,
};

describe('parseBypassActor', () => {
  test('parses team:123:pull_request', () => {
    expect(parseBypassActor('team:123:pull_request')).toEqual({
      actor_type: 'Team',
      actor_id: 123,
      bypass_mode: 'pull_request',
    });
  });

  test('accepts OrganizationAdmin and DeployKey without an id', () => {
    expect(parseBypassActor('OrganizationAdmin')).toEqual({
      actor_type: 'OrganizationAdmin',
      actor_id: null,
      bypass_mode: 'always',
    });
    expect(parseBypassActor('deploykey')).toEqual({
      actor_type: 'DeployKey',
      actor_id: null,
      bypass_mode: 'always',
    });
  });

  test('rejects ids on id-less types and missing ids on id-full types', () => {
    expect(parseBypassActor('OrganizationAdmin:5')).toBeNull();
    expect(parseBypassActor('Team')).toBeNull();
    expect(parseBypassActor('User:abc')).toBeNull();
    expect(parseBypassActor('User:0')).toBeNull();
  });

  test('rejects unknown types, modes, and DeployKey with pull_request mode', () => {
    expect(parseBypassActor('Alien:1')).toBeNull();
    expect(parseBypassActor('User:1:sometimes')).toBeNull();
    expect(parseBypassActor('DeployKey::pull_request')).toBeNull();
  });
});

describe('buildRulesetBody', () => {
  test('fresh ruleset: status checks + required workflow + no force push/deletion', () => {
    const body = buildRulesetBody(null, baseRulesetOptions);
    expect(body.name).toBe(DEFAULT_RULESET_NAME);
    expect(body.target).toBe('branch');
    expect(body.enforcement).toBe('active');
    expect(body.conditions).toEqual({
      ref_name: { include: ['refs/heads/main'], exclude: [] },
    });
    expect(body.rules).toEqual([
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [{ context: 'PR Validation / validate' }],
          strict_required_status_checks_policy: false,
        },
      },
      {
        type: 'workflows',
        parameters: {
          workflows: [{ path: DEFAULT_REQUIRED_WORKFLOW, repository_id: 12345 }],
        },
      },
      { type: 'non_fast_forward' },
      { type: 'deletion' },
    ]);
    expect(body.bypass_actors).toBeUndefined();
  });

  test('--no-required-workflow drops the workflows rule', () => {
    const body = buildRulesetBody(null, { ...baseRulesetOptions, requiredWorkflowPath: null });
    expect(body.rules.some((r) => r.type === 'workflows')).toBe(false);
    expect(body.rules.some((r) => r.type === 'required_status_checks')).toBe(true);
  });

  test('throws when a required workflow is configured without a repository id', () => {
    expect(() =>
      buildRulesetBody(null, { ...baseRulesetOptions, workflowRepositoryId: 0 })
    ).toThrow(/workflowRepositoryId/);
  });

  test('--strict and --require-pr add their rules and set the policy', () => {
    const body = buildRulesetBody(null, {
      ...baseRulesetOptions,
      strict: true,
      requirePr: true,
      requiredChecks: ['PR Validation / e2e-chrome'],
    });
    const checks = body.rules.find((r) => r.type === 'required_status_checks');
    expect(checks).toBeDefined();
    if (checks?.type === 'required_status_checks') {
      expect(checks.parameters.required_status_checks.map((c) => c.context)).toEqual([
        'PR Validation / validate',
        'PR Validation / e2e-chrome',
      ]);
      expect(checks.parameters.strict_required_status_checks_policy).toBe(true);
    }
    expect(body.rules.find((r) => r.type === 'pull_request')).toEqual({
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    });
  });

  test('workflow ref is included when set', () => {
    const body = buildRulesetBody(null, { ...baseRulesetOptions, workflowRef: 'release' });
    const workflows = body.rules.find((r) => r.type === 'workflows');
    if (workflows?.type === 'workflows') {
      expect(workflows.parameters.workflows[0]).toEqual({
        path: DEFAULT_REQUIRED_WORKFLOW,
        repository_id: 12345,
        ref: 'release',
      });
    }
  });

  test('preserves name, enforcement and bypass actors from the existing ruleset', () => {
    const current = {
      name: 'Existing gate',
      enforcement: 'evaluate',
      bypass_actors: [
        { actor_type: 'Team', actor_id: 999, bypass_mode: 'pull_request' },
        { actor_type: 'User', actor_id: 7, bypass_mode: 'always' },
      ],
    };
    const body = buildRulesetBody(current, baseRulesetOptions);
    expect(body.name).toBe('Existing gate');
    expect(body.enforcement).toBe('evaluate');
    expect(body.bypass_actors).toEqual([
      { actor_type: 'Team', actor_id: 999, bypass_mode: 'pull_request' },
      { actor_type: 'User', actor_id: 7, bypass_mode: 'always' },
    ]);
  });

  test('explicit --bypass-actor replaces the preserved list; explicit name/enforcement win', () => {
    const current = {
      name: 'Existing gate',
      enforcement: 'disabled',
      bypass_actors: [{ actor_type: 'Team', actor_id: 999, bypass_mode: 'always' }],
    };
    const body = buildRulesetBody(current, {
      ...baseRulesetOptions,
      name: 'Renamed',
      enforcement: 'active',
      bypassActors: [{ actor_type: 'OrganizationAdmin', actor_id: null, bypass_mode: 'always' }],
    });
    expect(body.name).toBe('Renamed');
    expect(body.enforcement).toBe('active');
    expect(body.bypass_actors).toEqual([
      { actor_type: 'OrganizationAdmin', actor_id: null, bypass_mode: 'always' },
    ]);
  });

  test('custom branch and excludes shape the conditions', () => {
    const body = buildRulesetBody(null, {
      ...baseRulesetOptions,
      branch: 'release',
      excludeBranches: ['refs/heads/main'],
    });
    expect(body.conditions).toEqual({
      ref_name: { include: ['refs/heads/release'], exclude: ['refs/heads/main'] },
    });
  });

  test('output is JSON-serializable (what POST/PUT sends)', () => {
    const body = buildRulesetBody(null, baseRulesetOptions);
    expect(() => JSON.stringify(body)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(body)) as typeof body;
    expect(parsed).toEqual(body);
  });
});
