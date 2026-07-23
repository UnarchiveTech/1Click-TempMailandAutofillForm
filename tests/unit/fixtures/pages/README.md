# Autofill QA fixtures

Static HTML pages for verifying the content-script autofill UX without real third-party sites.

## Serve locally

```bash
bunx serve tests/fixtures/pages -p 4173
```

Then open:

| URL | Expect |
|-----|--------|
| http://localhost:4173/signup-basic.html | Field icons + **Autofill All** |
| http://localhost:4173/login-only.html | Field icons maybe; **no** Autofill All |
| http://localhost:4173/otp-wait.html | OTP fill / Wait-for-OTP panel |

## In-extension playground

Settings → Developer → **Open playground**, or navigate to the Playground view from About / Diagnostics.
