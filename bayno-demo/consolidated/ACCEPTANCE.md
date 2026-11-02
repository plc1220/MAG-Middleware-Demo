# Observed acceptance — 1 November 2026

Recorded at 2026-11-01T03:21:52.535Z (UTC). Live demo: Cloud Run `mag-bayno-site` in Singapore.

| Live scenario | Run ID | Observed result |
|---|---|---|
| One file/minute, ten files | `5b52e61b-8531-44f3-b71b-de3613e223dc` | 10/10 RECONCILED at both destinations |
| 100-file backlog | `a9866317-dcb7-4ead-afed-11e95f0de930` | 100/100 RECONCILED at both destinations |
| Validation boundaries and failures | `d9c86954-721b-4424-912b-9193d7ff2f66` | 9/9 expected outcomes RECONCILED at both destinations |

All three runs have zero physical duplicates, no unexpected/missing/conflicting
records, matching PostgreSQL and SFTP canonical business data, matching ingested
source hashes and clean, readable DLQs. Rejected files correctly reconcile their
results/exceptions while producing no business rows. Recorded observations and
file identities are in `ACCEPTANCE.json`.

The timed run produced 134 business rows,
10 file results and
36 exceptions. Inter-file generation intervals
ranged from 60.181 to 65.968 seconds,
including worker restarts during generation. Backlog totals were
1274 business rows,
100 file results and
396 exceptions.

Validation cases: zero details; exactly 20% invalid details; above 20%; malformed
CSV; missing trailer; count mismatch; filename/header timestamp mismatch;
duplicate header; trailer source mismatch.

Additional observed checks:

- Dedicated isolated-PostgreSQL control test passed: concurrent starts admit one
  run, same-key retries return the original, changed settings conflict, stop is
  durable, invalid IDs and pagination are rejected.
- Sixteen Python reference/verifier cases passed on the VM, including threshold
  boundaries, missing/conflicting/duplicate output, malformed record identity,
  and exclusion of runtime timestamps from comparison.
- Each managed sink was paused separately while processing continued; delivery
  stayed incomplete. Both recovered and the backlog subsequently reconciled.
- Deployed start retry returned the same run. Replayed stop cards returned the
  same persisted result. Expired and wrong-session cards returned HTTP 400.
- The actual Vertex agent used run/MCP tools for a live reconciliation summary
  and prepared a scoped start card without executing it.
- Desktop and 390px mobile browser checks found no page JavaScript errors or
  horizontal overflow; walkthrough navigation and controls were visible.
- The VM worker resumed generation across restarts. The browser/Cloud Run do
  not run the generator. Unauthenticated demo API access returned HTTP 401.

Cutover retains all original resources. The legacy SFTP source is paused; five
legacy Flink processing statements and superseded v2 statements are stopped.
One failed superseded routing compile is retained as diagnostic history. The
three current jobs and all three managed connectors were verified running.
There was no local bridge/generator process to stop.

Early preflight runs intentionally remain visible with mismatches from schema
migration/replay and an initial test-oracle CSV count bug. They are not current
acceptance runs; no failed evidence was deleted to obtain the results above.

Build-source hygiene: explicit Docker/gcloud exclusions now omit local passwords,
local environment files and dependencies. Historical private source archives
containing the demo password were replaced with sanitized copies; application
images never copied that file. Cloud Storage version/soft-delete retention is a
provider setting; this does not assert historical secure erasure or external
access auditing. Rollback images and sanitized source remain retained.

These are demo observations. The missing SAS structure include and approved
production feed specification still prevent a production-parity certification.

Final deployment: Cloud Run revision `mag-bayno-site-00016-dg7`. The final upload was checked directly and excludes `.site-password`, local `.env` and `node_modules`. Thirteen affected historical build-source archives were sanitized; the build-source bucket has no public IAM members. This is not a claim that historical access was audited.
