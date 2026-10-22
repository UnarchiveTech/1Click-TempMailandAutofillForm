/**
 * scripts/git.ts
 *
 * Shared git spawn helpers for release-facing tooling (bump-version.ts, …).
 *
 * All commands spawn with an arg array - never a shell string - so they behave
 * identically on Windows cmd/PowerShell and POSIX shells and no quoting can
 * mangle arguments. On failure, `runGit` prints a descriptive error (with a
 * Windows-specific hint when git itself cannot be launched) and throws
 * `GitCommandError`; the caller decides how to exit.
 */

/** Thrown by `runGit` when git cannot be started or exits non-zero. */
export class GitCommandError extends Error {
  /** The git exit code, or null when the process could not be spawned. */
  readonly exitCode: number | null;

  constructor(message: string, exitCode: number | null) {
    super(message);
    this.name = 'GitCommandError';
    this.exitCode = exitCode;
  }
}

export interface RunGitOptions {
  /** Human description of the step, used in the ✓/✗ output lines. */
  okMessage?: string;
  /** Working directory for the git process (defaults to the script's cwd). */
  cwd?: string;
}

interface SpawnResult {
  /** Captured stdout when `capture` is true, else null. */
  output: string | null;
}

/**
 * Core spawn shared by `runGit` / `runGitCapture`. Arg array, no shell. On
 * failure prints the reason plus a Windows PATH hint and throws
 * `GitCommandError` carrying the exit code (or null if git could not be
 * launched). With `capture: true` stdout is piped back instead of inherited.
 */
function spawnGit(
  args: string[],
  okMessage: string,
  options: RunGitOptions & { capture: boolean }
): SpawnResult {
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync(['git', ...args], {
      stdout: options.capture ? 'pipe' : 'inherit',
      stderr: 'inherit',
      cwd: options.cwd,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${okMessage}: could not launch git (${detail})`);
    if (process.platform === 'win32') {
      console.error(
        '  Ensure Git for Windows is installed and `git` is on your PATH (e.g. C:\\Program Files\\Git\\cmd).'
      );
    }
    throw new GitCommandError(`could not launch git: ${detail}`, null);
  }
  if (!result.success) {
    const exitCode = result.exitCode ?? null;
    console.error(`✗ ${okMessage}: git exited with code ${exitCode ?? 'unknown'}`);
    if (process.platform === 'win32') {
      console.error(
        '  Tip: run `git --version` to confirm git resolves, and check the stderr output above.'
      );
    }
    throw new GitCommandError(
      `git ${args.join(' ')} failed with exit code ${exitCode ?? 'unknown'}`,
      exitCode
    );
  }
  return { output: options.capture ? (result.stdout?.toString() ?? '') : null };
}

/**
 * Spawn `git <args>` (arg array, no shell). On success prints
 * `✓ <okMessage>`; on failure prints the reason plus a Windows PATH hint and
 * throws `GitCommandError` carrying the exit code (or null if git could not
 * be launched).
 */
export function runGit(args: string[], options: RunGitOptions = {}): void {
  const okMessage = options.okMessage ?? `git ${args.join(' ')}`;
  spawnGit(args, okMessage, { ...options, capture: false });
  console.log(`✓ ${okMessage}`);
}

/**
 * Like `runGit` but returns the command's stdout (UTF-8, trimmed of nothing)
 * instead of printing `✓`. Same error behavior: prints the reason and throws
 * `GitCommandError`. Use for commands whose output is inspected (e.g.
 * `status --porcelain`, `describe --tags`).
 */
export function runGitCapture(args: string[], options: RunGitOptions = {}): string {
  const okMessage = options.okMessage ?? `git ${args.join(' ')}`;
  return spawnGit(args, okMessage, { ...options, capture: true }).output ?? '';
}
