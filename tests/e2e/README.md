# Browser scenario coverage

`playwright.config.ts` runs the installed Chrome extension. `playwright.mirror.config.ts`
runs **the same scenario files and assertions** in three browser engines using each
target's production build:

| Project | WXT build | Engine | Extension installed? |
|---|---|---|---|
| `extension-chrome` | Chrome | Chromium | Yes |
| `mirror-chrome` | Chrome | Chromium | No - preview control |
| `mirror-firefox` | Firefox | Firefox | No - engine preview |
| `mirror-safari-webkit` | Safari | WebKit | No - engine preview |

```sh
bun run build:all
bun x playwright install chromium firefox webkit
bun run test:e2e:mirror
```

Individual projects: `bun run test:e2e:firefox:ui`, `bun run test:e2e:safari:ui`, or
`bun run test:e2e:mirror --project=mirror-chrome`. The PR workflow runs all three
projects separately and uploads their evidence. Native Chrome and the separate
Firefox Selenium native checks remain independent checks. Firefox packages a temporary
test XPI that grants localhost and seeds real browser storage before loading the
unchanged production background. It enables browser UI automation only in that
disposable profile to open the actual popup, app, and sidebar documents and test
their real runtime/storage API. This does not test the browser's sidebar container.
The shortcut check requires an actual command event and filled email, names and
matching passwords. An unchanged page fails; the release manifest is untouched.
The native control check uses WebDriver's closed-shadow-root lookup and real
pointer input, then asserts that the signup fields actually contain the seed.
Results and screenshots are written to `.wxt/e2e-firefox/` and uploaded in CI.
Its demo server uses port 5174 (`FIREFOX_E2E_PORT` can override it), separately
from the shared matrix on 5173 so one runner cannot stop another's fixture.

## What the preview proves

The test transport loads the target's actual `background.js` in a background page.
UI/content messages execute those production handlers; responses are not canned
success objects. Storage updates/events, tab operations, script execution, timers,
and a context-scoped clipboard are supplied by the adapter. Unknown API operations
reject. Runtime contract scenarios check stored data, rejected invalid requests,
cross-shell storage events, default values, and independent storage areas.

Autofill controls remain in closed shadow roots. A test-only probe retains their
references, and the driver uses trusted mouse input at their real coordinates.
Native Chrome continues to inspect the roots through CDP without this probe.

## What it does not prove

An engine preview does not prove installed-extension permissions, isolated-world
security, service-worker suspension, OS clipboard/notification permissions, native
sidebar controls, installation/update behavior, or actual Safari on macOS.
Native Safari currently has a packaging/app-boot workflow, not equivalent extension
assertions. Completing those native checks is a remaining milestone.

## Remaining work for native parity

- Run every shared workflow through an installed Firefox extension, beyond the
  three document/runtime checks. Resolve native shortcut input: the registered
  binding is observable, but WebDriver key sequences currently do not emit its
  command event on the tested Windows Firefox session. Keep this check failing
  until the event and resulting fill are both proved.
- Add a macOS lane with an enabled Safari Web Extension and actual extension UI,
  background, permission, content-world, and native sidebar assertions. Windows
  WebKit cannot provide that evidence.
- Exercise permission denial/revocation, background restart, install/update,
  native clipboard/notifications, and iframe isolation in the installed lanes.
- Investigate the shared matrix's failures using the recorded traces. Identical
  discovery does not make a failing scenario covered successfully.

WebMCP execution tests explicitly skip when the browser lacks the API. The separate
unavailable-path scenario waits for the final registration result and checks that
the signup page remains usable. A skip is not a mirrored pass.

## Evidence

`.wxt/e2e-mirror/all/coverage.json` records every scenario, attempt, outcome, error,
and skip annotation; the adjacent report contains traces/screenshots. Every shared
scenario is scheduled in every project. Discovery parity is
not a claim that all scenarios passed or that native browser coverage is complete.
Run outputs and preview documentation screenshots are separate from published docs
images. `E2E_MIRROR_RUN` can name an isolated output directory for separate concurrent
runs; do not run two commands with the same output directory simultaneously.

New scenarios belong in this shared directory. Keep assertions unchanged between
projects. Browser-specific exceptions must feature-detect the actual capability and
record why coverage was skipped; never silently exclude a test file for a target.

See [the verification snapshot](MIRROR_RESULTS.md) for the first complete run and
the remaining failures; fresh runs always take precedence over that snapshot.

## Opt-in local backup audit

Set `BACKUP_AUDIT_FILE` to an absolute local JSON backup path, then run
`bun x playwright test tests/e2e/backup-import-local.e2e.ts --project=extension-chrome`.
The test imports through the actual first-run dialog into an isolated profile,
compares every backed-up message field, checks record counts and selected
preferences, and rescans live and archived messages through the background
handler. It reports aggregate results under `audit/backup-import-local` without
writing credential values to the report. External endpoint DNS resolution is
blocked; this does not prove provider access or recovery of secrets encrypted
under a different vault key. The private backup is never a committed fixture.

## Opt-in production signup

The [time-limited RunSignup test](../live/README.md) runs separately through
`bun run test:live:runsignup`. It creates a real account and polls real Guerrilla
Mail; it is deliberately excluded from this suite and its browser mirror.
