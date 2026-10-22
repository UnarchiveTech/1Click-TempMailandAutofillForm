# Browser coverage verification - 2026-10-10

The first complete shared matrix scheduled every scenario in all three engines.
These are engine-preview results, using the production target bundles and the
test API transport described in [README.md](README.md).

| Project | Scheduled | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| Chrome preview | 75 | 68 | 7 | 0 |
| Firefox preview | 75 | 67 | 6 | 2 |
| Safari-build WebKit preview | 75 | 66 | 7 | 2 |
| Total | 225 | 201 | 20 | 4 |

The four skips are WebMCP registration/execution on Firefox and WebKit, whose
tested engines do not expose the API. Their separate unavailable-path tests pass.
No test files or assertions were excluded for these projects.

## Follow-up corrections and regression runs

The Chrome WebMCP failure was an outdated test argument: `executeTool` now accepts
an input object, while the test sent a JSON string. Corrected the test and reran
both scenarios: **2/2 pass in Chrome preview and 2/2 in installed Chromium**.
The original full-matrix report remains unchanged as evidence. This targeted
rerun does not imply that a second full matrix passed.

The split-divider test sampled the restored pane before its first layout and
converted a missing bounding box to zero. It now polls the same width threshold
after reload and requires a measurable initial pane. **3/3 engine previews and
1/1 installed Chromium pass**; the storage and 130px resize requirements remain.

The final runtime/storage, email image network-capture, and WebMCP-unavailable
regression run passed **12/12** (four checks in each engine).

## Native evidence

Installed Firefox (Selenium's cached Firefox 155 on Windows):

| Check | Result |
|---|---|
| Popup document + production background/storage handler | Passed |
| Full app document + production background/storage handler | Passed |
| Sidebar document + production background/storage handler | Passed |
| Actual content-script injection into the signup page | Passed |
| Real pointer click on closed-root Autofill All; email, names, matching passwords filled | Passed |
| Native Alt+Shift+F command event and resulting fill | Failed - command event not observed |

All six native checks run even when another fails. Screenshots and outcomes are
saved to `.wxt/e2e-firefox/`. The temporary XPI seeds real storage and grants
localhost; the release manifest/build are unchanged. The sidebar document test
does not validate the browser's sidebar container. Native Chromium's seven shared
autofill checks plus two runtime/storage checks and the WebMCP-unavailable check
also passed in a separate focused regression run.

Native Safari extension assertions remain unimplemented. A Windows WebKit preview
does not provide installed Safari coverage; macOS with an enabled Safari Web
Extension is the remaining native milestone.

## Remaining matrix failures

| Scenario | Engines failing | Observed evidence |
|---|---|---|
| Activity reset | All three | Confirmation button repeatedly detaches while click waits |
| Compact address-selector bottom sheet | All three | Action strip reports XS where the existing assertion requires a different tier; Responsive Button Layout remains with its assigned owner |
| Icon surface walk (three shells each) | All three | Tag editor fails Escape dismissal; Firefox compact shells also leave an overlay intercepting the next control. Icon ink checks themselves report no unresolved/blank icons |
| Label save/filter | Firefox | Expected `e2e-priority (1)` tab never appears |
| Locale-pack roundtrip | WebKit | Page errors report DNS-over-HTTPS access-control failures. Preview origins lack native extension network privileges; this does not establish a locale decoding bug |

These failures remain visible in `.wxt/e2e-mirror/all/coverage.json` and its
adjacent report/traces/screenshots. No thresholds were relaxed to turn them green.
The original split-divider failures also remain in that report; their subsequent
passing evidence is `.wxt/e2e-mirror/split-layout-ready/coverage.json`. The final
contract evidence is `.wxt/e2e-mirror/final-contracts/coverage.json`.

## Other checks

- All three production builds passed, including nav and stale-build checks.
- The new discovery/reporting unit tests and Biome checks passed.
- Typecheck remains blocked by two existing `marker` narrowing errors in
  `src/entrypoints/background/runtime/message-handler.ts`.
- Audit passed 26/27 gates; the remaining failure is the responsive generator's
  Bun 1.4.2 pin versus the installed Bun 1.4.3. Its assigned owner retains that work.

This is complete shared **scenario discovery**, with recorded passes and gaps.
It is not 100% passing or native Firefox/Safari coverage.
