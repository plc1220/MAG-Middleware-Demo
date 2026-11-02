# Google sign-in acceptance — 2026-11-01

Deployed revision: `mag-bayno-site-00018-jzb` (100% traffic).
Image digest: `sha256:1e3a3a756cec36c5aa478e7c1104d28e651dbca761862755c910763a78bb0823`.

Reused the existing Google OAuth web client `452883396851-0du09eabj8qt3le8bh7l6h2hs7ne6ppl.apps.googleusercontent.com`.
The BAYNO origin persisted after reloading the Google Cloud client configuration.
Other origins, redirect URIs, project consent/audience settings and client secrets
were retained. The application needs no OAuth client secret.

## Verified live

- The deployed login page contains the Google sign-in control and no password form.
- Google Identity Services recognized the existing mile.cloud account.
- Clicking Continue as Licheng authenticated successfully and opened the dashboard.
- Authenticated `/api/session` returned `licheng.phan@mile.cloud` / `Licheng Phan`.
- Dashboard loaded durable run history, current worker/connector/Flink health,
  and nine reconciled files from the most recent existing run.
- Unauthenticated run reads and the obsolete password-login POST return 401.
- Token submission without state returns 400. Sign-in config returns public client
  ID and random nonce/CSRF values with a Secure, HttpOnly, SameSite=Strict cookie.
- The live service has no `SITE_PASSWORD_HASH` secret binding. The local shared
  password file was removed. Historical revisions/configuration are retained.

Evidence screenshot: `google-sign-in-verified.png`.

## Automated coverage

`node --test cloudrun/test/google-auth.test.js cloudrun/test/auth-http.test.js`
passed all seven tests. Coverage includes verified Workspace ownership, rejection
of foreign domains and unverified email, state/nonce/CSRF, tampered/expired state,
forged signature, wrong audience/issuer/expiry, legacy-session rejection and logout.
The signature tests use the real Google verification library with a generated
test certificate. HTTP session fixtures are synthetic and are distinct from the
real browser sign-in above. Foreign-account rejection was tested automatically;
no separate real foreign Google account was used.

The login page uses Google's documented CSP allowances, popup opener policy and
`strict-origin-when-cross-origin` referrer policy. The latter resolved the live
origin-validation failure found during initial deployment.

No new demo runs were generated for this authentication change. Existing pipeline
acceptance is recorded separately under `bayno-demo/consolidated/ACCEPTANCE.md`.
