CREATE TABLE bayno_file_results_v2 (
 `record_id` STRING NOT NULL,
 `run_id` STRING,
 `file_id` STRING,
 `source_file` STRING,
 `status` STRING,
 `reason` STRING,
 `declared_count` BIGINT,
 `actual_count` BIGINT,
 `invalid_count` BIGINT,
 `error_percent` STRING,
 PRIMARY KEY(record_id) NOT ENFORCED
) DISTRIBUTED BY HASH(record_id) INTO 1 BUCKETS WITH ('key.format'='avro-registry','value.format'='avro-registry','changelog.mode'='upsert','kafka.retention.time'='7 days');
