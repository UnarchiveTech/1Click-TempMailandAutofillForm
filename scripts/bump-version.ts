#!/usr/bin/env bun

/**
 * Version bumper - keeps package.json as the single source of truth for the
 * extension version. The WXT manifest version is derived from package.json at
 * build time (see wxt.config.ts), so editing package.json is enough.
 *
 * Usage:
 *   bun run bump-version                  # shows current version
 *   bun run bump-version patch            # 3.0.0 → 3.0.1
 *   bun run bump-version minor            # 3.0.0 → 3.1.0
 *   bun run bump-version major            # 3.0.0 → 4.0.0
 *   bun run bump-version 3.1.0            # explicit SemVer
 *   bun run bump-version --preid=beta 3.1.0-rc.1   # prerelease
 *   bun run bump-version --check           # release-state preflight only
 *
 * With --check (alone or combined with a bump), verifies the working tree is
 * clean and the latest reachable git tag matches package.json's version
 * (v<version>) before doing anything, exiting 1 on mismatch. This is the
 * guard CI release runs use to fail early.
 *
 * Validates the result is a parseable SemVer string. Exits non-zero on error
 * so CI can gate releases on it.
 *
 * After bumping:
 *   git tag v<version>           # tag must match (release.yml enforces this)
 *   git push origin v<version>   # triggers the release workflow
 */

import { GitCommandError, runGit, runGitCapture } from './git';

const PKG_PATH = `${import.meta.dir}/../package.json`;

type BumpKind = 'patch' | 'minor' | 'major' | 'prerelease';

interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  preRelease: string | null;
  preReleaseNum: number;
}

const SEMVER_RE =
  /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<pre>[0-9A-Za-z-.]+?)(?:\.(?<prenum>\d+))?)?$/;

function parseSemVer(version: string): ParsedSemVer {
  const m = SEMVER_RE.exec(version);
  if (!m?.groups) {
    throw new Error(`Invalid SemVer: "${version}"`);
  }
  return {
    major: Number(m.groups.major),
    minor: Number(m.groups.minor),
    patch: Number(m.groups.patch),
    preRelease: m.groups.pre ?? null,
    preReleaseNum: m.groups.prenum ? Number(m.groups.prenum) : 0,
  };
}

function bump(parsed: ParsedSemVer, kind: BumpKind, preid: string): string {
  const next = { ...parsed };
  switch (kind) {
    case 'major':
      next.major += 1;
      next.minor = 0;
      next.patch = 0;
      next.preRelease = null;
      next.preReleaseNum = 0;
      break;
    case 'minor':
      next.minor += 1;
      next.patch = 0;
      next.preRelease = null;
      next.preReleaseNum = 0;
      break;
    case 'patch':
      next.patch += 1;
      next.preRelease = null;
      next.preReleaseNum = 0;
      break;
    case 'prerelease':
      if (next.preRelease) {
        next.preReleaseNum += 1;
      } else {
        next.preRelease = preid;
        next.preReleaseNum = 1;
      }
      break;
  }
  const base = `${next.major}.${next.minor}.${next.patch}`;
  return next.preRelease ? `${base}-${next.preRelease}.${next.preReleaseNum}` : base;
}

async function readVersion(): Promise<string> {
  const pkg = (await Bun.file(PKG_PATH).json()) as { version?: string };
  if (!pkg.version) {
    throw new Error('package.json is missing "version" field');
  }
  return pkg.version;
}

async function writeVersion(newVersion: string): Promise<void> {
  const pkg = (await Bun.file(PKG_PATH).json()) as Record<string, unknown>;
  pkg.version = newVersion;
  await Bun.write(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`✓ package.json version: ${newVersion}`);
}

/**
 * Release-state preflight: refuses to proceed unless the working tree is
 * clean and the latest reachable git tag matches package.json's version
 * (`v<version>`). Prints ✓ lines on success and exits 1 with a descriptive
 * message on any mismatch, so release runs (local or CI) fail before any
 * work happens.
 */
function verifyReleaseState(currentVersion: string): void {
  const expectedTag = `v${currentVersion}`;

  const dirtyLines = runGitCapture(['status', '--porcelain'])
    .trim()
    .split('\n')
    .filter((line) => line.length > 0);
  if (dirtyLines.length > 0) {
    console.error(
      `✗ Working tree is not clean - expected tag ${expectedTag} to match package.json version ${currentVersion}.`
    );
    for (const line of dirtyLines.slice(0, 20)) console.error(`  ${line}`);
    if (dirtyLines.length > 20) {
      console.error(`  … and ${dirtyLines.length - 20} more`);
    }
    process.exit(1);
  }
  console.log('✓ Working tree is clean');

  let latestTag: string;
  try {
    latestTag = runGitCapture(['describe', '--tags', '--abbrev=0']).trim();
  } catch (error) {
    if (error instanceof GitCommandError) {
      console.error(
        `✗ No git tags found - expected ${expectedTag} to match package.json version ${currentVersion}.`
      );
      process.exit(1);
    }
    throw error;
  }

  if (latestTag !== expectedTag) {
    console.error(
      `✗ Latest tag ${latestTag} does not match package.json version ${currentVersion} (expected ${expectedTag}).`
    );
    console.error('  Bump the version first, or tag this commit:');
    console.error(`    git tag -a ${expectedTag} -m "Release ${expectedTag}"`);
    process.exit(1);
  }
  console.log(`✓ Latest tag ${latestTag} matches package.json version ${currentVersion}`);
}

function gitTag(version: string, opts: { tag: boolean; push: boolean }): void {
  if (!opts.tag && !opts.push) return;
  const tagName = `v${version}`;
  try {
    if (opts.tag) {
      runGit(['tag', '-a', tagName, '-m', `Release ${tagName}`], {
        okMessage: `Created tag ${tagName}`,
      });
    }
    if (opts.push) {
      runGit(['push', 'origin', 'HEAD'], { okMessage: 'Pushed branch to origin' });
      runGit(['push', 'origin', tagName], { okMessage: `Pushed tag ${tagName}` });
      console.log(`✓ Pushed branch and tag ${tagName}`);
    }
  } catch (error) {
    // Preserve the previous CLI contract: exit with git's code (1 when git
    // could not be launched). The descriptive ✗ message is already printed by
    // runGit.
    if (error instanceof GitCommandError) process.exit(error.exitCode ?? 1);
    throw error;
  }
}

interface Args {
  kind: BumpKind | null;
  explicit: string | null;
  preid: string;
  tag: boolean;
  push: boolean;
  dryRun: boolean;
  check: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    kind: null,
    explicit: null,
    preid: 'rc',
    tag: false,
    push: false,
    dryRun: false,
    check: false,
  };

  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === '--tag') args.tag = true;
    else if (arg === '--push') args.push = true;
    else if (arg === '--check') args.check = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--preid=')) args.preid = arg.slice('--preid='.length);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === 'patch' || arg === 'minor' || arg === 'major' || arg === 'prerelease') {
      args.kind = arg;
    } else if (SEMVER_RE.test(arg)) {
      args.explicit = arg;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 0) {
    console.error(`Unknown argument(s): ${positional.join(' ')}`);
    printHelp();
    process.exit(1);
  }
  return args;
}

function printHelp(): void {
  console.log(`
Usage: bun run bump-version [kind|version] [flags]

Kinds:
  patch, minor, major, prerelease

Flags:
  --preid=<id>   Prerelease identifier (default: rc)
  --tag          Create a v<version> git tag after bumping
  --push         Push branch and tag to origin (implies --tag)
  --check        Verify release state (clean tree + latest tag matches
                 package.json) and fail early on mismatch
  --dry-run      Show the new version without writing anything
  --help, -h     Show this help

Examples:
  bun run bump-version patch
  bun run bump-version minor --tag
  bun run bump-version 3.1.0 --push
  bun run bump-version prerelease --preid=beta
  bun run bump-version --check
`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const current = await readVersion();

if (args.check) {
  verifyReleaseState(current);
}

const parsed = parseSemVer(current);

let next: string;
if (args.explicit) {
  next = args.explicit;
  if (next === current && !args.dryRun) {
    console.log(`Version is already ${current}; nothing to do.`);
    process.exit(0);
  }
} else if (args.kind) {
  next = bump(parsed, args.kind, args.preid);
} else {
  console.log(`Current version: ${current}`);
  console.log('\nPass a kind (patch|minor|major|prerelease) or an explicit version.');
  console.log('Run with --help for usage.');
  process.exit(0);
}

console.log(`${current} → ${next}`);
if (args.dryRun) {
  console.log('(dry run - no changes written)');
  process.exit(0);
}

await writeVersion(next);
gitTag(next, { tag: args.tag || args.push, push: args.push });
