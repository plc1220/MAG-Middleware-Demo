# Chat rate-limit correction — 2026-11-01

Root cause: GET polling and POST actions incremented the same per-session
counter while applying different thresholds (180 for GET, 24 for POST).
The normal dashboard makes about 40 reads per minute, so it could block the
first chat message. Cloud Run recorded `/api/chat` responses with HTTP 429
at 03:59:41, 03:59:45 and 03:59:47 UTC (11:59 Kuala Lumpur).

The server now uses separate `read`, `chat` and `write` counters. Limits remain
180/24/24 per session per minute; limited responses include `Retry-After: 60`.
Deployed revision `mag-bayno-site-00019-c2c` serves 100% of traffic.
Image: `sha256:0cda50c46195e0b2ede9ef4d814abd4af51f940a132f98cfe03f85d5e308717c`.

Validation:

- All seven auth tests pass, including an HTTP regression that exhausts the
  read limit, then confirms chat still reaches input validation, exhausts
  chat's separate limit, and confirms control routing remains available.
- Live operator smoke test (`scripts/chat-rate-check.mjs`): 40 authenticated
  reads returned 200, followed by a real Gemini/Confluent MCP chat request
  returning 200 and a nonempty live-health answer, with no pending action.
- The live smoke uses a synthetic signed operator session; it does not replace
  the real Google login acceptance recorded in `AUTH-ACCEPTANCE.md`.

Browser verification was unavailable because the connected browser reported
`browser.user is unavailable`; live verification used the app's HTTP API.
