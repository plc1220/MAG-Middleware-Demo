-- Parse the pipe-delimited STRING emitted by the local bridge. SPLIT_INDEX is
-- zero-based. The join is scoped to a demo file and then matches the
-- package-derived record-type predicate. FILE_SEQ is a synthetic fixture field.
INSERT INTO mag_bayno_hist
WITH text_rows AS (
  SELECT
    CAST(`val` AS STRING) AS `row_text`
  FROM mag_bayno_raw
),
parsed AS (
  SELECT
    SPLIT_INDEX(`row_text`, '|', 0) AS `RECORD_KIND`,
    SPLIT_INDEX(`row_text`, '|', 1) AS `FILE_SEQ`,
    SPLIT_INDEX(`row_text`, '|', 2) AS `SOURCE_SYSTEM`,
    SPLIT_INDEX(`row_text`, '|', 3) AS `FEED_TYPE`,
    SPLIT_INDEX(`row_text`, '|', 4) AS `EFFECTIVE_DATE`,
    SPLIT_INDEX(`row_text`, '|', 5) AS `EFFECTIVE_TIME`,
    SPLIT_INDEX(`row_text`, '|', 6) AS `DETAIL_REC_TYPE`,
    SPLIT_INDEX(`row_text`, '|', 7) AS `REC_TYPE`,
    SPLIT_INDEX(`row_text`, '|', 8) AS `CARRIER`,
    SPLIT_INDEX(`row_text`, '|', 9) AS `FLT_NBR`,
    SPLIT_INDEX(`row_text`, '|', 10) AS `FIRST_LEG_DEP_DT`,
    SPLIT_INDEX(`row_text`, '|', 11) AS `SCHED_DEP_TM`,
    SPLIT_INDEX(`row_text`, '|', 12) AS `DISCH_AIRPT`,
    SPLIT_INDEX(`row_text`, '|', 13) AS `BAY_NO`,
    SPLIT_INDEX(`row_text`, '|', 14) AS `TRAILER_COUNT`
  FROM text_rows
)
SELECT /*+ STATE_TTL('d' = '10m', 'h' = '10m') */
  CAST(SUBSTRING(d.`FILE_SEQ`, 2) AS BIGINT) AS `FILE_SEQ`,
  d.`CARRIER` AS `CARR`,
  d.`FLT_NBR` AS `FLT_NBR`,
  CAST(CONCAT(
    SUBSTRING(d.`FIRST_LEG_DEP_DT`, 7, 4), '-',
    SUBSTRING(d.`FIRST_LEG_DEP_DT`, 4, 2), '-',
    SUBSTRING(d.`FIRST_LEG_DEP_DT`, 1, 2)
  ) AS DATE) AS `FIRST_LEG_FLT_DT`,
  d.`SCHED_DEP_TM` AS `SCHED_DEP_TM`,
  d.`DISCH_AIRPT` AS `DEP_AIRPT`,
  d.`BAY_NO` AS `BAY_NO`,
  CURRENT_TIMESTAMP AS `REC_LD_TS`,
  h.`SOURCE_SYSTEM` AS `REC_SRC_SYS`
FROM parsed AS d
JOIN parsed AS h
  ON d.`FILE_SEQ` = h.`FILE_SEQ`
 AND d.`REC_TYPE` = h.`DETAIL_REC_TYPE`
WHERE d.`RECORD_KIND` = '01'
  AND h.`RECORD_KIND` = '00';
