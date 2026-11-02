# Ten-second demo preset — 2026-11-01

The default is now 30 immutable files, 20 details per file, one file every
10 seconds across a five-minute generation window. The first file is immediate;
subsequent slots run through approximately 290 seconds. The dashboard displays
the cadence and duration, and the agent shares these defaults and includes the
interval in approval settings. Existing 60-second runs remain readable/replayable.

Final Cloud Run revision: `mag-bayno-site-00023-xlj`, 100% traffic.
Image: `sha256:2fc966e79491a8eb67bf50467576305d81a04978d0bf57d12506af2bcc90d8a0`.
Final VM worker SHA-256: `a24342adbd3ba636d09226ecce87193e9c1bfb34d20125d765b5fcfe0cf50037`.
Timing acceptance used the same generator logic at worker hash
`301ae3604bf1eed10edbef549a579181525053be80e62ce6c83adc5d6acbebcf`; the
final change only stamps the verifier heartbeat at actual completion with
`clock_timestamp()` instead of the transaction start timestamp.
The prior worker is retained at `/opt/bayno-demo/worker.py.before-10s-20261101`.

The generator and verifier now have independent loops, PostgreSQL connections
and advisory locks. Generator polling is 0.5 seconds. Persisted publication slots
avoid cumulative drift. Run rows use `FOR NO KEY UPDATE`: run IDs are immutable,
and audit-event foreign keys must not block generation progress.

## Live result

Dashboard-started run: `61aa24a3-5705-4f8e-9874-933fe3c18a39`.
All 30 files reconciled at **12:41:46 Kuala Lumpur time**. Each destination has
600 matching business rows. File-result/exception checks, canonical hashes,
duplicates and DLQs also passed through the independent verifier.

| Measurement | Observed |
|---|---:|
| Generated / reconciled | 30 / 30 |
| PostgreSQL / SFTP detail rows | 600 / 600 |
| Mean interval | 9.992 seconds |
| Minimum / maximum interval | 9.217 / 10.756 seconds |
| First-to-last publication | 289.769 seconds |
| Last publication after run creation | 290.277 seconds |
| Duplicates / mismatches | 0 / 0 |

These are measured timings, not a scheduling SLA. Delivery completion follows
generation because source ingestion, sink rotation and stable-file verification
have their own cadence. Detailed evidence is in `CADENCE-ACCEPTANCE.json`.

The initial trial (`65ffc9ba-5e49-4047-9dda-088b82220763`) reconciled all files but
failed timing validation because of an audit foreign-key lock conflict. It remains
in history, and `CADENCE-PREFLIGHT.json` retains that failure. It is excluded from
timing acceptance; the fresh run above validates the corrected worker.

## Verification

- 16 web/auth/stream/settings tests passed, including preservation of original
  defaults on idempotent retries and rejection of explicit setting changes.
- 17 worker/reference tests passed on the VM.
- A real PostgreSQL lock regression passed in an isolated random schema in the
  `postgres` test database, reproducing the old conflict and validating the new
  compatible lock. Its own test schema was removed afterward.
- The final browser preset displays 30 files, every 10 seconds, five minutes.
- A live retry of a historical 60-second run returned the original run, while
  explicitly changing its interval under the same key returned HTTP 409. No
  new run was created by that retry check.
- Final browser evidence shows 30/30 generated and reconciled, zero pending,
  zero mismatches and no stale-heartbeat message: `cadence-10s-verified.png`.
- Source, Flink and sink configuration were retained. No business-table writes
  bypassed the managed connectors.

The HTTP test harness now handles an already-exited child server during cleanup,
so a startup/fixture failure cannot leave the test runner hanging. A fresh full
16-test run passed after that harness correction.
