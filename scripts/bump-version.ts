#!/usr/bin/env bun

/**
 * Version bumper — keeps package.json as the single source of truth for the
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
 *
 * Validates the result is a parseable SemVer string. Exits non-zero on error
 * so CI can gate releases on it.
 *
 * After bumping:
 *   git tag v<version>           # tag must match (release.yml enforces this)
 *   git push origin v<version>   # triggers the release workflow
 */

import { join } from 'node:path';

const PKG_PATH = join(import.meta.dir, '..', 'package.json');

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

function gitTag(version: string, opts: { tag: boolean; push: boolean }): void {
  if (!opts.tag && !opts.push) return;
  const tagName = `v${version}`;
  if (opts.tag) {
    const r = Bun.spawnSync(['git', 'tag', '-a', tagName, '-m', `Release ${tagName}`], {
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if (!r.success) process.exit(r.exitCode ?? 1);
    console.log(`✓ Created tag ${tagName}`);
  }
  if (opts.push) {
    const r1 = Bun.spawnSync(['git', 'push', 'origin', 'HEAD'], {
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if (!r1.success) process.exit(r1.exitCode ?? 1);
    const r2 = Bun.spawnSync(['git', 'push', 'origin', tagName], {
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if (!r2.success) process.exit(r2.exitCode ?? 1);
    console.log(`✓ Pushed branch and tag ${tagName}`);
  }
}

interface Args {
  kind: BumpKind | null;
  explicit: string | null;
  preid: string;
  tag: boolean;
  push: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    kind: null,
    explicit: null,
    preid: 'rc',
    tag: false,
    push: false,
    dryRun: false,
  };

  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === '--tag') args.tag = true;
    else if (arg === '--push') args.push = true;
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
  --dry-run      Show the new version without writing anything
  --help, -h     Show this help

Examples:
  bun run bump-version patch
  bun run bump-version minor --tag
  bun run bump-version 3.1.0 --push
  bun run bump-version prerelease --preid=beta
`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const current = await readVersion();
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
  console.log('(dry run — no changes written)');
  process.exit(0);
}

await writeVersion(next);
gitTag(next, { tag: args.tag || args.push, push: args.push });
