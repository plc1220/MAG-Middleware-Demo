# Confluent Cloud setup

Target: environment `lumo-demo` (`env-pozpjk`), Kafka cluster `MAG-BAYNO-DEMO` (`lkc-0xy8qdp`), GCP `asia-southeast1`, Flink pool `lfcp-rr606r7`.

The `mag_bayno_raw` topic is created on the MAG cluster and is visible to Flink as an inferred table. The empty `mag_bayno_hist` placeholder topic was removed so Flink can create it with its JSON Schema and compacted upsert key. The new Cloud resource-management key and cluster-scoped Kafka key are stored in Secret Manager in project `my-rd-coe-demo-gen-ai` as `mag-bayno-confluent-connect-auth` and `mag-bayno-demo-kafka-auth`.

1. `00-inspect-raw-table.sql` shows the inferred raw topic definition. Its `val` column is BYTES; the insert casts it to STRING before parsing.
2. `01-create-history-table.sql` declares the history topic and its composite upsert key. The empty placeholder topic has been removed, so this DDL can create the topic and JSON Schema subjects.
3. `02-insert-history.sql` uses zero-based `SPLIT_INDEX` positions to parse each pipe-delimited value, joins each detail to its file header using the synthetic `FILE_SEQ` plus the package-derived record-type predicate, normalizes the date, and adds a load timestamp.
4. Start `./bayno-demo/start-cloud-feed-bridge.sh` on the Mac. It opens an IAP tunnel to the SFTP VM and reads the Kafka key from Secret Manager. It forwards records to the raw topic and moves fully delivered files to `/dropbox/finished`.
5. Create the managed PostgreSQL Sink connector after the Flink history schema exists. Its configuration passed the Confluent plugin validator with zero errors; it uses JSON Schema, the composite Kafka key, UPSERT, and CA-validated PostgreSQL TLS.

The history `CREATE TABLE` and the insert's parse/join `SELECT` passed Flink SQL validation through MCP. The raw topic is inferred and needs no DDL. The generated column layout and repeated `FILE_SEQ` are explicit synthetic assumptions, not the production BAYNO layout. The site sorts rows when it queries PostgreSQL; Kafka streaming writes do not guarantee a globally sorted arrival order.
