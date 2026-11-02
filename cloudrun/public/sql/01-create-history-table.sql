CREATE TABLE mag_bayno_hist (
  `CARR` STRING NOT NULL,
  `FLT_NBR` STRING NOT NULL,
  `FIRST_LEG_FLT_DT` DATE NOT NULL,
  `SCHED_DEP_TM` STRING NOT NULL,
  `DEP_AIRPT` STRING NOT NULL,
  `BAY_NO` STRING,
  `REC_LD_TS` TIMESTAMP_LTZ(3) NOT NULL,
  `FILE_SEQ` BIGINT NOT NULL,
  `REC_SRC_SYS` STRING NOT NULL
)
WITH (
  'value.format' = 'json-registry',
  'kafka.retention.time' = '7 days',
  'changelog.mode' = 'append'
);
