-- A keyed history topic supports idempotent/upsert delivery into PostgreSQL.
CREATE TABLE mag_bayno_hist (
  `FILE_SEQ` BIGINT NOT NULL,
  `CARR` STRING NOT NULL,
  `FLT_NBR` STRING NOT NULL,
  `FIRST_LEG_FLT_DT` DATE NOT NULL,
  `SCHED_DEP_TM` STRING NOT NULL,
  `DEP_AIRPT` STRING NOT NULL,
  `BAY_NO` STRING,
  `REC_LD_TS` TIMESTAMP_LTZ(3) NOT NULL,
  `REC_SRC_SYS` STRING NOT NULL,
  PRIMARY KEY (`FILE_SEQ`, `CARR`, `FLT_NBR`, `FIRST_LEG_FLT_DT`, `SCHED_DEP_TM`, `DEP_AIRPT`) NOT ENFORCED
)
WITH (
  'key.format' = 'json-registry',
  'value.format' = 'json-registry',
  'kafka.retention.time' = '7 days',
  'changelog.mode' = 'upsert'
);
