CREATE TABLE bayno_processed_v2 (
 `record_id` STRING NOT NULL,
 `run_id` STRING,
 `file_id` STRING,
 `source_file` STRING,
 `line_number` BIGINT,
 `carr` STRING,
 `flt_nbr` STRING,
 `first_leg_flt_dt` STRING,
 `sched_dep_tm` STRING,
 `dep_airpt` STRING,
 `bay_no` STRING,
 `rec_src_sys` STRING,
 `file_sequence` STRING,
 `rec_ld_ts` STRING,
 PRIMARY KEY(record_id) NOT ENFORCED
) DISTRIBUTED BY HASH(record_id) INTO 1 BUCKETS WITH ('key.format'='avro-registry','value.format'='avro-registry','changelog.mode'='upsert','kafka.retention.time'='7 days');
