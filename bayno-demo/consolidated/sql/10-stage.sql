CREATE TABLE bayno_staging_v2 (PRIMARY KEY(source_file,line_number) NOT ENFORCED) DISTRIBUTED BY HASH(source_file,line_number) INTO 1 BUCKETS WITH ('changelog.mode'='upsert') AS
WITH extracted AS (
 SELECT COALESCE(REGEXP_EXTRACT(CAST(headers AS STRING),'file[.]name=([^,}]+)',1),'') AS source_file,
   COALESCE(TRY_CAST(REGEXP_EXTRACT(CAST(headers AS STRING),'file[.]offset=([0-9]+)',1) AS BIGINT),-1) AS line_number,
   TRY_CAST(REGEXP_EXTRACT(CAST(headers AS STRING),'file[.]length=([0-9]+)',1) AS BIGINT) AS file_length,
   raw_line,kafka_offset
 FROM bayno_raw_lines WHERE REGEXP(CAST(headers AS STRING),'file[.]name=FMCS0000_BAYNO000_[0-9]{14}_[0-9]+_R[0-9a-f-]{36}_O[0-9]{4}[.]csv')
), dedup AS (
 SELECT * FROM (SELECT *,ROW_NUMBER() OVER (
   PARTITION BY source_file,line_number ORDER BY kafka_offset ASC) AS rn FROM extracted) WHERE rn=1
), parsed AS (
 SELECT source_file,line_number,file_length,raw_line,bayno_parse_csv(raw_line) AS parsed FROM dedup
), columns_parsed AS (
 SELECT source_file,line_number,file_length,raw_line,
   TRY_CAST(JSON_VALUE(parsed,'$.field_count') AS INT) AS field_count,
   JSON_VALUE(parsed,'$.parse_error') AS parse_error,
   JSON_VALUE(parsed,'$.c1') AS record_type,
   JSON_VALUE(parsed,'$.c2') AS c2,JSON_VALUE(parsed,'$.c3') AS c3,
   JSON_VALUE(parsed,'$.c4') AS c4,JSON_VALUE(parsed,'$.c5') AS c5,
   JSON_VALUE(parsed,'$.c6') AS c6,JSON_VALUE(parsed,'$.c7') AS c7
 FROM parsed WHERE source_file<>'' AND line_number>=1
)
SELECT *,
 CASE
   WHEN parse_error IS NOT NULL THEN 'CSV_PARSE_ERROR'
   WHEN record_type='00' AND (field_count<>6 OR COALESCE(TRIM(c2),'')='' OR COALESCE(TRIM(c3),'')='') THEN 'INVALID_HEADER'
   WHEN record_type='99' AND (field_count<>3 OR COALESCE(TRIM(c2),'')='' OR TRY_CAST(c3 AS BIGINT) IS NULL OR TRY_CAST(c3 AS BIGINT)<0) THEN 'INVALID_TRAILER'
   WHEN record_type='01' AND (field_count<>7 OR
     COALESCE(TRIM(c2),'')='' OR COALESCE(TRIM(c3),'')='' OR COALESCE(TRIM(c4),'')='' OR
     COALESCE(TRIM(c5),'')='' OR COALESCE(TRIM(c6),'')='' OR COALESCE(TRIM(c7),'')='') THEN 'INVALID_DETAIL'
   WHEN record_type='01' AND (NOT REGEXP(c4,'^[0-9]{4}-[0-9]{2}-[0-9]{2}$') OR TRY_CAST(c4 AS DATE) IS NULL OR
     NOT REGEXP(c5,'^[0-9]{4}$') OR TRY_CAST(SUBSTRING(c5,1,2) AS INT) NOT BETWEEN 0 AND 23 OR
     TRY_CAST(SUBSTRING(c5,3,2) AS INT) NOT BETWEEN 0 AND 59) THEN 'INVALID_DETAIL'
   WHEN record_type NOT IN ('00','01','99') OR record_type IS NULL THEN 'INVALID_RECORD_TYPE'
   ELSE CAST(NULL AS STRING)
 END AS row_error,
 TRY_CAST(CASE WHEN record_type='01' THEN c4 ELSE NULL END AS DATE) AS flight_date,
 CASE WHEN record_type='01' AND REGEXP(c5,'^[0-9]{4}$') AND
   TRY_CAST(SUBSTRING(c5,1,2) AS INT) BETWEEN 0 AND 23 AND TRY_CAST(SUBSTRING(c5,3,2) AS INT) BETWEEN 0 AND 59
   THEN TRY_CAST(CONCAT(SUBSTRING(c5,1,2),':',SUBSTRING(c5,3,2),':00') AS TIME) ELSE CAST(NULL AS TIME) END AS scheduled_time
FROM columns_parsed;
