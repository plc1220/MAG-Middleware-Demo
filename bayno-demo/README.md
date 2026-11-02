> Current implementation: see [the consolidated demo](consolidated/README.md). The flow below documents the retained original bridge-based demo.

# MAG BAYNO Cloud demo

The demo uses a generated, synthetic BAYNO feed because the SAS export contains package and job metadata, not business input rows. The generated pipe-delimited layout is inferred from visible mappings and is not a recovered production feed specification.

## Cloud flow

```text
Local generator → GCP SFTP VM → local SFTP-to-Kafka bridge → mag_bayno_raw
  → Confluent Flink → mag_bayno_hist → JDBC Sink → PostgreSQL on the VM
```

- Kafka cluster: `MAG-BAYNO-DEMO` (`lkc-0xy8qdp`) in Confluent environment `lumo-demo` (`env-pozpjk`).
- Flink pool: `lfcp-rr606r7`, GCP `asia-southeast1`.
- SFTP and PostgreSQL host: `mag-bayno-demo`, GCP project `my-rd-coe-demo-gen-ai`, `asia-southeast1-a`.
- Database/table: `magbayno.public.mag_bayno_hist`.
- Cloud Run walkthrough: `https://mag-bayno-site-452883396851.asia-southeast1.run.app`.

The VM has its own VPC. SFTP port 22 is IAP-only; the feed generator and bridge each use a temporary Google IAP TCP tunnel. PostgreSQL port 5432 is reachable from Cloud Run inside the VPC and from Confluent's shared regional connector egress ranges for the JDBC sink.

## Provisioning and operation

1. Provision the VM, static address, VPC and limited firewall rules with `./infra/mag-bayno-vm/scripts/deploy.sh`.
2. Wait for the VM's startup script to finish. The generator and bridge use the local SFTP client key created by provisioning.
3. Topic `mag_bayno_raw` is provisioned in `MAG-BAYNO-DEMO` and appears as an inferred Flink table. Flink will create `mag_bayno_hist` with its JSON Schema and compacted upsert key.
4. Start the history table statement and history `INSERT` from the SQL files in `confluent/` after approving their exact SQL in Codex. The raw table is inferred, so `00-inspect-raw-table.sql` shows its live definition rather than recreating it.
5. Create the managed PostgreSQL Sink connector after the Flink history schema is registered. The SFTP-to-Kafka bridge runs locally because the source SFTP server is intentionally not exposed to Confluent.
6. In separate terminals, run `./bayno-demo/start-cloud-feed-bridge.sh` and `./bayno-demo/start-cloud-feed-generator.sh`. Each opens an IAP tunnel. The bridge reads the Kafka client key from Secret Manager and forwards completed files; the generator uploads a mock file every 10 seconds. Press `Ctrl-C` to stop either process; pass `--max-files 1` to the generator to upload one file.
7. Open the Cloud Run site, visit **Transformed table**, and select **Refresh rows**. The page queries PostgreSQL on demand and sorts rows by the SAS sort columns; Kafka does not promise a globally sorted output order.

## Synthetic file shape

Each generated file has a pipe-delimited column header, one `00` header record, three deliberately unsorted `01` details, and a `99` trailer. The bridge validates the file, skips the column-name row, and publishes each accepted record as a raw Kafka string. A synthetic `FILE_SEQ` is repeated on every row to scope the Flink join to one demo file; the business predicate remains `REC_TYPE = DETAIL_REC_TYPE`. Flink parses fields with `SPLIT_INDEX` and writes a JSON Schema history topic.

## Limits of the SAS reconstruction

The package metadata identifies the job graph, mappings, a `LEFT JOIN`, the record-type predicate, staging/load/history tables and a DB2 target library. It does not include actual business rows or a complete feed-layout document. The streaming demo therefore uses an inner detail-to-header join and a synthetic per-file correlation field. Compare against an approved feed specification before claiming production parity.
