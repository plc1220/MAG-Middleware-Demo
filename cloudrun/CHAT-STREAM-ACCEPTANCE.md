# Streamed agent chat — 2026-11-01

Production revision: `mag-bayno-site-00021-t7n`, 100% traffic.
Image digest: `sha256:e42d35e03b442519f263151640372764468f1cab6f83c42fde5779bcbb6c9eff`.
Previous production revisions are retained for rollback.

## Template and behavior

Executed the user's Astryx template command with CLI/Core 0.7.5. The generated
React reference is at `src/app/ai-chat/page.tsx`, with provenance and MIT license.
The existing native browser app adapts its message/avatar metadata, assistant
bubbles, collapsible tool-call list, review cards and composer patterns. No
Next.js migration or sample template conversations were introduced into production.

The same authenticated `/api/chat` endpoint supports JSON and SSE. Gemini's
`generateContentStream` drives progressive public-answer snapshots. Actual
operations emit start/end, source, observation time and measured duration.
Model thought text/signatures and raw tool arguments/results are not exposed in
events. Signatures needed for tool continuation remain server-side. Existing
Google Workspace restrictions, per-bucket rate limits and approval controls remain.

## Automated validation

All 13 tests passed:

```sh
node --test cloudrun/test/chat-stream.test.js cloudrun/test/auth-http.test.js cloudrun/test/google-auth.test.js
```

New coverage includes incremental output before completion; hidden thought and
signature exclusion; redaction across provider chunk boundaries; failed tools;
cancellation before subsequent tool execution; byte-split UTF-8 and CRLF SSE;
malformed/truncated streams; flushed headers; approval events; safe provider
errors; timeouts; disconnected-work cleanup; escaped Markdown; unauthenticated
and cross-origin stream requests. Existing domain/signature/session and isolated
rate-limit regression tests also passed.

## Live API verification on final revision

`scripts/chat-stream-check.mjs` used an operator synthetic session and actual
Gemini/Confluent reads. The first status arrived in 98 ms. Seven operations had
matching starts and successful ends. Fourteen progressive answer snapshots arrived
before `done`, at 10.573 seconds. These are observed timings, not service targets.

`scripts/chat-rate-check.mjs` then verified 40 authenticated reads followed by a
successful HTTP 200 JSON chat answer, confirming polling isolation and backward
compatibility. Both checks performed reads and prepared no actions.

## Browser verification

The existing Google-authenticated browser session loaded the deployed UI.
Verified formatted live answers, tool source and timing, activity expansion,
chat expansion, New chat, Stop reply and enabled input after stopping. Stopped
replies explicitly remain incomplete. A draft start card (10 valid files,
20 details, 60-second interval) was prepared and dismissed without execution.
No demo run or Flink change was executed for this chat implementation.

The final live read of `mag-bayno-demo-v2-34-route-final` showed a completed
Confluent Singapore MCP operation and a grounded public answer. Screenshot:
`chat-stream-verified.png`. Browser console returned no errors or warnings during
the streaming checks. The observed browser width was 700 px; the responsive
single-column layout was inspected without forcing a viewport override.

No VM worker, connector, topic, processing SQL or reconciliation rules changed.
Pipeline acceptance remains separately recorded under
`bayno-demo/consolidated/ACCEPTANCE.md`.
