# MAG BAYNO Cloud Run control room

The Google-authenticated app controls durable demo runs and renders live
Confluent health, file timelines, PostgreSQL results, SFTP previews and
reconciliation evidence. Start/stop uses a PostgreSQL command store; the VM
worker generates files and verifies delivery independently of Cloud Run.
Business records reach both destinations through managed Confluent connectors.

The Vertex AI agent uses Confluent's global and Singapore regional MCP servers
for infrastructure reads and scoped application tools for run progress. Start,
stop and app-owned Flink actions require exact action cards. Approvals are
session-bound, expire after five minutes, and are consumed durably once. Run
starts share the dashboard's idempotency and single-generator protections.
Confluent's console blocks iframe embedding; native cards link to it.

See [the consolidated guide](../bayno-demo/consolidated/README.md) for schemas,
infrastructure, provisioning, testing and rollback. The current cluster is
`lumo-demo` (`lkc-pg690ym`) in environment `env-pozpjk`; the original
`MAG-BAYNO-DEMO` cluster is retained.

## Data and access

Chat stays in browser memory and clears on reload. Chat text and MCP responses
are not persisted. Operational settings, manifests, transformed records, action
approvals and reconciliation evidence persist separately in PostgreSQL with
seven-day demo retention. The web DB role submits commands and reads results;
a separate connector role writes business tables. The worker writes control
and audit data, sources and bounded previews, never destination business rows.

Google OAuth sessions use signed HttpOnly/Secure/SameSite=Lax cookies. POSTs
require the site's origin. Credentials stay in Secret Manager or restricted
VM environment files. Browser responses contain sanitized statuses rather than
connector credentials/configuration. HTTP responses use Cache-Control: no-store.
Application error logs contain request IDs and error classes. Cloud Run platform
logs and Vertex logging/caching are provider settings; no provider-wide
zero-retention claim is made.

## Deploy and validate

`./cloudrun/scripts/deploy-cloudrun.sh` builds the runtime, including
`demo-control.js`, and configures its dedicated web DB login/secret, MAG VPC and
Singapore region. Subsequent source deployments preserve existing settings.
The service scales to zero.

`npm run check` checks backend syntax. The control integration test requires an
isolated PostgreSQL fixture with the consolidated SQL migration:

```sh
node --test cloudrun/test/control.test.js
```

TEST_DATABASE_URL overrides its local fixture URL. Tests truncate fixture run
records: never point it at a live database. Live acceptance scripts in scripts/
explicitly target the deployed demo and never print credentials.


## Google sign-in

Only verified mile.cloud Google Workspace identities are accepted. The backend
checks Google's signed identity token (signature, audience, issuer, expiry),
OAuth state and nonce; it requires both hosted-domain `hd=mile.cloud` and a
verified mile.cloud email. An email suffix alone does not grant access.

Existing OAuth web client: `Web client (auto created by Google Service)`,
ID `452883396851-0du09eabj8qt3le8bh7l6h2hs7ne6ppl.apps.googleusercontent.com`.
Authorized JavaScript origin:
`https://mag-bayno-site-452883396851.asia-southeast1.run.app`.

Google Identity Services renders the official sign-in button. Its nonce-bound
ID token is posted to `/api/auth/google`, with a browser-bound signed HttpOnly
state cookie, a CSRF token and same-origin validation. The backend verifies the
Google token and Workspace identity before issuing an application session.
No client secret, code exchange, refresh token or provider-token storage is used.
The public client ID is supplied through GOOGLE_OAUTH_CLIENT_ID. PUBLIC_ORIGIN
pins the sign-in host. The login page alone permits Google's GIS script/frame/
style resources; the main app keeps its existing restrictive CSP.
The login page uses `strict-origin-when-cross-origin` so Google can validate
the registered origin, and `same-origin-allow-popups` for the sign-in window.

Password login and the old hashing tool are removed. Auth version 2 invalidates
all old password sessions. POST origin checks and session-bound one-use action
approvals remain in place. New run audit entries identify the signed-in email.

Auth verification:
`node --test cloudrun/test/google-auth.test.js cloudrun/test/auth-http.test.js`

These tests cover wrong Workspace/domain, unverified email, state/nonce/CSRF,
legacy-session rejection, logout, and signature/audience/issuer/expiry rejection.
Live Google account sign-in additionally requires a registered client and consent.

The operational smoke scripts mint administrative synthetic sessions using the session-signing secret. They test application controls, not Google sign-in; verify the real provider flow separately in a browser.

Authenticated dashboard reads, chat messages and control writes have separate
per-session, one-minute rate windows (180 reads, 24 chat messages, 24 control
writes). Polling cannot consume the chat or action allowance. Rate-limited
responses include `Retry-After: 60`. The HTTP auth test saturates reads and chat
independently and checks that control routing remains available.
`node cloudrun/scripts/chat-rate-check.mjs` verifies a real agent reply after
40 authenticated reads using an operator-only synthetic session.

## Streamed agent chat

The production UI adapts the Astryx `ai-chat` template generated under
`src/app/ai-chat` with CLI/Core 0.7.5. It uses native browser modules to fit the
existing app: message avatars and timestamps, Markdown, collapsible operation
rows, an anchored composer, New chat, Stop reply, expand/restore and approval
cards. The generated React reference is retained with its provenance and license.

`POST /api/chat` accepts `Accept: text/event-stream` for SSE and retains JSON
responses for existing API clients. The stream emits `status`, `tool_start`,
`tool_end`, cumulative `answer` snapshots, `approval` and `done`, or `error`.
Keepalives run every 15 seconds; replies time out at 150 seconds. Disconnects
abort generation/MCP reads. The UI does not retry interrupted chat requests
automatically, preserves partial text as incomplete, and excludes incomplete
assistant responses from later model context.

Activity labels describe actual operations and sources, with observed timestamps,
success/failure and measured duration. They are not private model reasoning.
Thought text/signatures, raw tool arguments, raw tool results and credentials are
never placed in activity events. Provider signatures needed for subsequent tool
rounds are preserved only server-side. Text redaction waits for unfinished words
so credentials and credential-bearing URLs split across chunks remain protected.
Approval cards retain the existing session binding, exact parameters, expiry and
one-use execution controls; streaming cannot execute a proposed action.

Validation:

```sh
node --test cloudrun/test/chat-stream.test.js cloudrun/test/auth-http.test.js cloudrun/test/google-auth.test.js
node cloudrun/scripts/chat-stream-check.mjs
```

The second command uses an operator synthetic session and real Gemini/MCP reads;
it checks progressive answers, matched operation starts/ends and completion.

Default demo generation: 30 files, one every 10 seconds across a five-minute
window, with 20 details per file. The dashboard and agent share these defaults.
The VM generator polls independently of destination verification.

## Original SAS graph

Chapter 03 includes a native HTML/SVG flow graph alongside the six job definitions
and table-lineage explanation. Select a job node to focus its detailed exported
steps. It shows the invalid-file route, validated header/detail paths, staging,
SAS load table, DB2 target and processed-file archive. It is a logical reconstruction
from `SAS Package File/TransportMetadata.xml`; missing scheduler dependencies and
the external detail-validation include remain explicit. The latest-file SAS policy
is distinguished from the demo's every-file streaming policy.

Deployed in revision `mag-bayno-site-00024-j5f`. Syntax checks and local/live browser
verification passed: all six nodes navigate, node labels fit, and the live browser
returned no errors/warnings. Screenshot: `original-sas-process-verified.jpg`.
