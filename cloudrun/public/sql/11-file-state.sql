CREATE TABLE bayno_file_state_v2 (
 PRIMARY KEY (source_file) NOT ENFORCED
) DISTRIBUTED BY HASH(source_file) INTO 1 BUCKETS
WITH ('changelog.mode'='upsert') AS
WITH stats AS (
 SELECT source_file,COUNT(*) AS received_rows,
   MIN(line_number) AS first_line,MAX(line_number) AS last_line,
   MAX(file_length) AS expected_bytes,SUM(CAST(CHAR_LENGTH(HEX(raw_line))/2 AS BIGINT)+1) AS received_bytes,
   SUM(CASE WHEN record_type='00' THEN 1 ELSE 0 END) AS header_count,
   SUM(CASE WHEN record_type='99' THEN 1 ELSE 0 END) AS trailer_count,
   MAX(CASE WHEN record_type='00' THEN line_number ELSE NULL END) AS header_line,
   MAX(CASE WHEN record_type='99' THEN line_number ELSE NULL END) AS trailer_line,
   MAX(CASE WHEN record_type='00' THEN c2 ELSE NULL END) AS source_system,
   MAX(CASE WHEN record_type='00' THEN c3 ELSE NULL END) AS feed_type,
   MAX(CASE WHEN record_type='00' THEN c6 ELSE NULL END) AS file_sequence,
   MAX(CASE WHEN record_type='99' THEN c2 ELSE NULL END) AS trailer_source,
   MAX(CASE WHEN record_type='99' THEN TRY_CAST(c3 AS BIGINT) ELSE NULL END) AS declared_count,
   SUM(CASE WHEN record_type='01' THEN 1 ELSE 0 END) AS actual_count,
   SUM(CASE WHEN record_type='01' AND row_error IS NOT NULL THEN 1 ELSE 0 END) AS invalid_count,
   SUM(CASE WHEN parse_error IS NOT NULL THEN 1 ELSE 0 END) AS parse_errors,
   SUM(CASE WHEN row_error IN ('INVALID_HEADER','INVALID_TRAILER','INVALID_RECORD_TYPE') THEN 1 ELSE 0 END) AS structural_errors,
   SHA2(CONCAT(REGEXP_REPLACE(ARRAY_JOIN(ARRAY_SORT(ARRAY_AGG(CONCAT(LPAD(CAST(line_number AS STRING),12,'0'),':',raw_line))),CHR(10)),
     '(?m)^[0-9]{12}:',''),CHR(10)),256) AS file_id
 FROM bayno_staging_v2 GROUP BY source_file
), checked AS (
 SELECT s.*,
   COALESCE(100.0 * invalid_count / NULLIF(actual_count,0),0.0) AS error_percent,
   CASE WHEN first_line=1 AND received_rows=last_line AND received_bytes=expected_bytes THEN TRUE ELSE FALSE END AS complete,
   CASE
     WHEN parse_errors>0 THEN 'CSV_PARSE_ERROR'
     WHEN header_count<>1 OR header_line<>1 THEN 'INVALID_HEADER'
     WHEN trailer_count<>1 OR trailer_line<>last_line THEN 'INVALID_TRAILER'
     WHEN structural_errors>0 THEN 'FILE_STRUCTURE_ERROR'
     WHEN s.source_system<>trailer_source THEN 'SOURCE_MISMATCH'
     WHEN NOT REGEXP(s.source_file,CONCAT('^',s.source_system,'_',s.feed_type,'_[0-9]{14}_',s.file_sequence,'_R[0-9a-f-]{36}_O[0-9]{4}[.]csv$')) THEN 'FILENAME_HEADER_MISMATCH'
     WHEN actual_count>1000 THEN 'FILE_TOO_LARGE'
     WHEN declared_count<>actual_count THEN 'COUNT_MISMATCH'
     WHEN c.source_system IS NULL OR NOT COALESCE(c.enabled,FALSE) THEN 'UNKNOWN_OR_DISABLED_FEED'
     ELSE CAST(NULL AS STRING)
   END AS file_error,
   COALESCE(c.max_error_percent,CAST(20 AS DECIMAL(5,2))) AS max_error_percent
 FROM stats s LEFT JOIN bayno_feed_control c
   ON s.source_system=c.source_system AND s.feed_type=c.feed_type
)
SELECT source_file,file_id,source_system,feed_type,file_sequence,
 declared_count,actual_count,invalid_count,error_percent,complete,file_error,
 expected_bytes,received_bytes,trailer_line,
 CASE WHEN NOT complete THEN 'PENDING'
      WHEN file_error IS NOT NULL OR error_percent>max_error_percent THEN 'REJECTED'
      ELSE 'ACCEPTED' END AS status,
 CASE WHEN NOT complete THEN 'INGEST_INCOMPLETE'
      WHEN file_error IS NOT NULL THEN 'FILE_VALIDATION_FAILED'
      WHEN error_percent>max_error_percent THEN 'DETAIL_ERROR_THRESHOLD_EXCEEDED'
      WHEN invalid_count>0 THEN 'ACCEPTED_WITH_DETAIL_ERRORS'
      ELSE 'OK' END AS reason
FROM checked;
