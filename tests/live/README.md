# Real RunSignup signup

This opt-in test creates **one real account per run** using a real Guerrilla Mail
inbox and the fictional test profile approved by the maintainer through the user.
It is separate from the offline, demo and browser-mirror suites. It never runs in
their default discovery or CI. There are no retries, purchases or race registrations.

Permission is bounded conservatively to **11-17 October 2026, Asia/Kolkata**;
the guard refuses execution from **18 October 2026 at 00:00 IST**. New permission
must be obtained before changing that window. Every account-creation click checks
the window again. A failed run after submission can still have created an account.

Build the current extension and install Playwright Chromium, then run in PowerShell:

```powershell
bun run build
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.playwright-browsers'
$env:RUNSIGNUP_LIVE = '1'
bun run test:live:runsignup
Remove-Item Env:RUNSIGNUP_LIVE
```

The test launches a temporary native Chromium profile with a temporary copy of
the built extension. Only that copy receives the RunSignup host grant, to avoid
a manual permission prompt in automated tests. This does not test the installed
extension's permission UX and does not alter the production manifest or user profile.
Neither the signup page nor mail provider responses are mocked. Inbox creation and
mail polling use the extension's production background handlers and provider DSL.

Assertions cover real review Cancel/Fill controls, identity and address filling,
matching valid passwords, native form validity, successful signup, exactly one
signup POST, absence of stale autofill controls, and delivery of RunSignup mail.
The test stops on a visible CAPTCHA and never bypasses a site rejection.

Artifacts under `.wxt/runsignup-automated` include a success screenshot and mail
subjects/senders/classification. Traces, videos, raw storage and mail bodies are
disabled to keep passwords, provider tokens and security-mail IPs out of reports.
The externally created account remains after the temporary browser profile is removed.
This Chromium run does not establish native Firefox/Safari behavior or acceptance
of every disposable-email domain.
