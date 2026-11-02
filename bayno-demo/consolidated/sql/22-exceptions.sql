CREATE TABLE bayno_exceptions_v2 (
 `record_id` STRING NOT NULL,
 `run_id` STRING,
 `file_id` STRING,
 `source_file` STRING,
 `line_number` BIGINT,
 `error_code` STRING,
 `explanation` STRING,
 PRIMARY KEY(record_id) NOT ENFORCED
) DISTRIBUTED BY HASH(record_id) INTO 1 BUCKETS WITH ('key.format'='avro-registry','value.format'='avro-registry','changelog.mode'='upsert','kafka.retention.time'='7 days');
