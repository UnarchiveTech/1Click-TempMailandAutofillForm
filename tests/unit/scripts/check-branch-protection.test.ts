/**
 * Unit tests for scripts/check-branch-protection.ts.
 *
 * The guard reads the LIVE GitHub state (rulesets via the metadata-readable
 * rules endpoint, classic protection when the token has admin) and fails when
 * the required gate drifts or disappears. The pure pieces pinned here are the
 * extraction helpers and the verdict matrix:
 *   - contextsFromRules / workflowPathsFromRules - what active rulesets demand,
 *   - contextsFromProtection - what classic protection demands (null = the
 *     status-checks requirement is disabled),
 *   - evaluateGate - the fail-closed / skip-when-unverifiable semantics that
 *     keep CI honest without false alarms when the token cannot read classic
 *     protection (the GITHUB_TOKEN case).
 */

import { describe, expect, test } from 'bun:test';

import {
  contextsFromProtection,
  contextsFromRules,
  evaluateGate,
  type GateInput,
  workflowPathsFromRules,
} from '../../../scripts/check-branch-protection';
import { DEFAULT_REQUIRED_CONTEXTS } from '../../../scripts/enforce-branch-protection';

const baseGate: GateInput = {
  requiredContexts: DEFAULT_REQUIRED_CONTEXTS,
  requiredWorkflows: [],
  rules: [],
  protectionStatus: 404,
  protection: null,
};

describe('contextsFromRules', () => {
  test('collects contexts from repo and org ruleset entries, deduped', () => {
    const rules = [
      {
        type: 'required_status_checks',
        ruleset_source_type: 'Repository',
        parameters: { required_status_checks: [{ context: 'PR Validation / validate' }] },
      },
      {
        type: 'required_status_checks',
        ruleset_source_type: 'Organization',
        parameters: {
          required_status_checks: [
            { context: 'PR Validation / validate' },
            { context: 'org/mandatory' },
          ],
        },
      },
      { type: 'non_fast_forward', ruleset_source_type: 'Repository' },
    ];
    expect(contextsFromRules(rules)).toEqual(['PR Validation / validate', 'org/mandatory']);
  });

  test('returns [] for empty or non-array input', () => {
    expect(contextsFromRules([])).toEqual([]);
    expect(contextsFromRules(null)).toEqual([]);
    expect(contextsFromRules('nope')).toEqual([]);
  });
});

describe('workflowPathsFromRules', () => {
  test('collects workflow paths from workflows rules', () => {
    const rules = [
      {
        type: 'workflows',
        ruleset_source_type: 'Organization',
        parameters: {
          workflows: [
            { path: '.github/workflows/pr-validation.yml', repository_id: 1 },
            { path: '.github/workflows/security.yml', repository_id: 2 },
          ],
        },
      },
      { type: 'deletion' },
    ];
    expect(workflowPathsFromRules(rules)).toEqual([
      '.github/workflows/pr-validation.yml',
      '.github/workflows/security.yml',
    ]);
  });
});

describe('contextsFromProtection', () => {
  test('returns the contexts when status checks are enabled', () => {
    const protection = { required_status_checks: { strict: true, contexts: ['old/check'] } };
    expect(contextsFromProtection(protection)).toEqual(['old/check']);
  });

  test('returns [] when status checks are enabled with no contexts', () => {
    expect(
      contextsFromProtection({ required_status_checks: { strict: false, contexts: [] } })
    ).toEqual([]);
  });

  test('returns null when status checks are disabled entirely', () => {
    expect(contextsFromProtection({ required_status_checks: null })).toBeNull();
    expect(contextsFromProtection({})).toBeNull();
    expect(contextsFromProtection(null)).toBeNull();
  });
});

describe('evaluateGate', () => {
  test('passes when a ruleset requires every required context', () => {
    const verdict = evaluateGate({
      ...baseGate,
      rules: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'PR Validation / validate' }] },
        },
      ],
    });
    expect(verdict).toEqual({ pass: true, skip: false, messages: [] });
  });

  test('passes when classic protection requires every required context', () => {
    const verdict = evaluateGate({
      ...baseGate,
      protectionStatus: 200,
      protection: {
        required_status_checks: { strict: false, contexts: ['PR Validation / validate'] },
      },
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.skip).toBe(false);
  });

  test('passes when a workflows rule covers the required workflow alongside the status gate', () => {
    const verdict = evaluateGate({
      ...baseGate,
      requiredWorkflows: ['.github/workflows/pr-validation.yml'],
      rules: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'PR Validation / validate' }] },
        },
        {
          type: 'workflows',
          parameters: {
            workflows: [{ path: '.github/workflows/pr-validation.yml', repository_id: 1 }],
          },
        },
      ],
    });
    expect(verdict.pass).toBe(true);
  });

  test('fails when only a workflows rule exists and no status-check context is present', () => {
    const verdict = evaluateGate({
      ...baseGate,
      requiredWorkflows: ['.github/workflows/pr-validation.yml'],
      rules: [
        {
          type: 'workflows',
          parameters: {
            workflows: [{ path: '.github/workflows/pr-validation.yml', repository_id: 1 }],
          },
        },
      ],
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.messages.join(' ')).toContain('PR Validation / validate');
  });

  test('fails when a ruleset gate is missing one required context (drift)', () => {
    const verdict = evaluateGate({
      ...baseGate,
      rules: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'other/check' }] },
        },
      ],
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.skip).toBe(false);
    expect(verdict.messages.join(' ')).toContain('PR Validation / validate');
  });

  test('fails when classic protection exists but status checks are disabled', () => {
    const verdict = evaluateGate({
      ...baseGate,
      protectionStatus: 200,
      protection: { required_status_checks: null },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.messages.join(' ')).toContain('missing');
  });

  test('fails when a required workflow rule is absent', () => {
    const verdict = evaluateGate({
      ...baseGate,
      requiredWorkflows: ['.github/workflows/pr-validation.yml'],
      protectionStatus: 200,
      protection: {
        required_status_checks: { strict: false, contexts: ['PR Validation / validate'] },
      },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.messages.join(' ')).toContain('workflow');
  });

  test('fails when nothing protects the branch (rules empty, classic 404)', () => {
    const verdict = evaluateGate(baseGate);
    expect(verdict.pass).toBe(false);
    expect(verdict.skip).toBe(false);
    expect(verdict.messages.join(' ')).toContain('enforce-branch-protection');
  });

  test('skips when classic protection is unreadable (403) and no ruleset exists', () => {
    const verdict = evaluateGate({ ...baseGate, protectionStatus: 403 });
    expect(verdict.pass).toBe(false);
    expect(verdict.skip).toBe(true);
  });

  test('fails when rulesets exist but none requires the gate', () => {
    const verdict = evaluateGate({
      ...baseGate,
      rules: [{ type: 'non_fast_forward' }, { type: 'deletion' }],
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.skip).toBe(false);
    expect(verdict.messages.join(' ')).toContain('rulesets');
  });

  test('skips on unexpected protection endpoint states', () => {
    const verdict = evaluateGate({ ...baseGate, protectionStatus: 500 });
    expect(verdict.skip).toBe(true);
    expect(verdict.pass).toBe(false);
  });
});
