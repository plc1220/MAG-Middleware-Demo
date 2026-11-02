# BAYNO consolidated demo

The Cloud Run app is the operator interface. PostgreSQL holds durable commands,
source manifests, run progress, action approvals and destination evidence. The VM
worker generates immutable incremental CSV files on demand; Confluent's managed
SFTP Source, Flink, SFTP Sink and PostgreSQL Sink carry all business data.

## Runtime

- Cloud Run: `mag-bayno-site`, Singapore, project `my-rd-coe-demo-gen-ai`.
- VM: `mag-bayno-demo`, zone `asia-southeast1-a`; SFTP chroot `/srv/sftp/magdemo`.
- Environment `env-pozpjk`, Kafka cluster `lkc-pg690ym` (`lumo-demo`).
- Raw: `bayno_raw_lines`; outputs: `bayno_processed_v2`,
  `bayno_file_results_v2`, `bayno_exceptions_v2`.
- Managed connectors: `mag-bayno-demo-v2-source`, `mag-bayno-demo-v2-sftp-sink`,
  `mag-bayno-demo-v2-postgres-sink`. Each has a separate service account.
- VM service: `bayno-demo-worker`. Its generator ticks every 0.5 seconds, independently of
  its verifier, which runs every 15 seconds. This continues with Cloud Run at zero
  instances or with no browser open.
- Default run: 30 files, 20 details each, one file every 10 seconds across a
  five-minute generation window. Stop generation
  leaves published files in flight. One generator is permitted at a time;
  HTTP retries reuse an idempotency key. VM restarts resume the next ordinal.

The first file is published immediately; the 30 publication slots occupy the
five-minute window at approximately 0, 10, …, 290 seconds. The generator advances
the persisted schedule without accumulating polling drift. After a prolonged
interruption it resumes the remaining files without a catch-up burst. Generation
and verification use separate PostgreSQL connections and advisory locks. The
generator locks run rows with `FOR NO KEY UPDATE`, allowing the verifier's audit
event foreign-key checks to coexist with progress updates on immutable run IDs.

## Identity and delivery contract

Each UTF-8/LF CSV has a six-field `00` header, seven-field `01` details and a
three-field `99` trailer. A filename contains source, feed, UTC effective stamp,
sequence, run UUID and ordinal. Content SHA-256 is the file ID. Input is
published by atomic rename; files are immutable. Reusing a filename with
conflicting bytes fails the run. Source duplicates are deduplicated by filename
and line position before whole-file counting.

Flink proves contiguous positions and complete byte count, validates feed,
header/trailer, filename metadata and counts, and rejects detail error rates
strictly greater than 20%. Valid rows from accepted files are enriched with
header metadata. Invalid details are emitted as exceptions even in rejected
files; a rejected file emits no business rows. File size is capped at 1,000
details in the demo. State TTL is eight days for a seven-day replay contract.

Outputs use flat Avro schemas. `record_id` must be in **both key and value**:
Confluent Flink defaults to excluding key fields from values. The managed
PostgreSQL sink uses `pk.mode=record_key`, AVRO keys and UPSERT. The SFTP sink
writes JSON files using the value. `include-record-ids.py` performs compatible
schema evolution with a default for existing data, without deleting history.
It must be followed by routing compilation against the current registry schema.

SFTP rotation is scheduled every minute, with flush.size 1000 on the Basic
cluster. Scheduled rotation is not an exactly-once guarantee. Physical duplicate
records are reported as MISMATCH. Files are inspected only after at least 75
seconds without modification. The verifier checks every expected record in all
three output streams against PostgreSQL and actual SFTP JSON, including hashes,
missing/extra/conflicting IDs, duplicates and both DLQs. Runtime load timestamps
are excluded from canonical comparisons. DLQ visibility failures prevent a clean
result. Generation completion is separate from delivery reconciliation.

The first implementation/preflight runs intentionally retain their failure
and migration evidence. Use a fresh run after cutover for acceptance; do not
clear evidence to turn failed runs green.

## Provision / update

Run from repository root. Credentials are read from Secret Manager or written
only beneath ignored `infra/private/`; never print connector configuration or
commit private files. `prepare-credentials.py` creates dedicated web/sink DB
credentials. `install-vm.sh` installs the SQL migration, worker and systemd unit;
`configure-vm-access.sh` installs credential SQL and limited database access.
The regional connector egress allowlist must reach ports 22 and 5432. Cloud Run
uses the VM's private address; SSH administration stays behind IAP.

1. Export current statements and secret-redacted connector configuration; retain
   snapshots and the prior Cloud Run revision.
2. Apply `sql/postgres.sql`, install the worker, its restricted login, and its
   root-owned `/etc/bayno-demo/worker.env`. Install `python3-psycopg2` and
   `python3-confluent-kafka`. Web login inherits `bayno_web`; sink login inherits
   `bayno_sink`; worker login inherits `bayno_worker`.
3. Apply SQL with `python3 bayno-demo/consolidated/deploy-flink.py` in dependency
   order. Historical superseded routing SQL is retained for audit but skipped by
   the default deployment. An existing stopped statement is not silently resumed.
4. Run `deploy-connectors.py` to create missing connectors and topic/group ACLs.
   Basic clusters require Kafka ACLs rather than resource RBAC. An explicit
   `BAYNO_UPDATE_CONNECTOR=<exact name>` updates only that connector;
   `BAYNO_SKIP_ACLS=1` can be used for an already-provisioned identity.
5. Run `prepare-monitor.py` to configure scoped DLQ monitoring and seven-day raw
   retention. Install its secret environment file on the VM with mode 0640.
6. Use `cloudrun/scripts/deploy-cloudrun.sh` for initial deployment; subsequent
   `gcloud run deploy ... --source=cloudrun` preserves configured runtime secrets.
   No browser or backend contains connector credentials in responses.
7. Complete live acceptance before pausing replaced connectors and statements.
   `flink-control.py stop <name>` retains statements; it never deletes them.

`build_sql.py` reconstructs baseline SQL from snapshots; versioned policy and
schema migrations in `sql/` remain authoritative. Do not regenerate and overwrite
current versions during a rollout. Resolve SQL drift by creating a new version.

## Web API and agent

Authenticated same-origin POSTs:

- `POST /api/demo/runs`: scenario (`valid`, `mixed`, `rejected`, `sequence`),
  file_count (1–100), detail_count (1–1000), interval_seconds (10–3600, default 10), and
  idempotency_key (8–128 characters).
- `POST /api/demo/runs/:id/stop`: stop future file generation.
- `GET /api/demo/runs`, `GET /api/demo/runs/:id`, and the `files`, `rows`,
  `exceptions`, `artifacts`, `events` subresources. Pagination: limit 1–100,
  offset 0–100000.

The existing Vertex agent uses global and regional Confluent MCP. Application
read tools add run/reconciliation context. Start/stop cards call the same run
functions as buttons, with signed session-bound five-minute approvals and durable
one-use nonces. Exact-SQL approval remains required for app-owned Flink actions.
No shell command or arbitrary URL execution is exposed. Chat stays ephemeral;
operational records persist. Confluent console blocks iframe embedding, so live
native cards link to the console in a separate tab.

## Tests and rollback

- `node --test cloudrun/test/control.test.js` against an isolated PostgreSQL
  fixture (`TEST_DATABASE_URL`), after applying the SQL migration.
- `python3 -m unittest discover -s bayno-demo/consolidated/tests -v` with
  psycopg2 installed: independent reference and verifier comparisons.
- Optional real PostgreSQL lock regression: set `BAYNO_LOCK_TEST_DSN` to a
  disposable/admin test database and run `tests/test_cadence_db.py`. It creates
  and removes its own random schema and reproduces the audit-FK conflict.
- `live-check.mjs` exercises the deployed authenticated app without printing
  credentials. `stage-backlog.py` is an operator-only 100-file acceptance fixture;
  it publishes only source files and manifests, never destination business rows.
- Live acceptance includes default cadence, backlog, separate sink pause/resume,
  replay/duplicates, worker restart, reload, action approval expiry/session/retry,
  desktop/mobile rendering and actual agent tool use. Record observed results
  separately from planned tests in `ACCEPTANCE.md`.

For rollback, stop new generation, retain manifests and evidence, pause the v2
source, stop versioned routing/state statements, then resume the exported legacy
statements and source connector. Route Cloud Run to its prior revision if needed.
Do not run both routing versions concurrently. Preserve all topics, schemas,
clusters and original files; these scripts do not delete historical resources.

The SAS structure include and approved production layout are missing. ISO/HHMM
CSV, every-file incremental processing and valid-detail filtering are demo
policies, not a production-parity certification. Display ordering follows SAS
sort fields; neither JSON file order nor database physical order is guaranteed.
