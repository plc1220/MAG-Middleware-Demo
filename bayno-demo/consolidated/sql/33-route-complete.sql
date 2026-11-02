EXECUTE STATEMENT SET
BEGIN
 INSERT INTO bayno_file_results_v2
 SELECT f.file_id,REGEXP_EXTRACT(f.source_file,'_R([0-9a-f-]{36})_O',1),f.file_id,f.source_file,f.status,f.reason,
 CAST(f.declared_count AS BIGINT),CAST(f.actual_count AS BIGINT),CAST(f.invalid_count AS BIGINT),CAST(f.error_percent AS STRING)
 FROM bayno_final_events_v21 f;
 INSERT INTO bayno_processed_v2
 SELECT CONCAT(f.file_id,':',CAST(s.line_number AS STRING)),REGEXP_EXTRACT(f.source_file,'_R([0-9a-f-]{36})_O',1),f.file_id,s.source_file,s.line_number,
 s.c2,s.c3,s.c4,s.c5,s.c6,s.c7,f.source_system,f.file_sequence,CAST(CURRENT_TIMESTAMP AS STRING)
 FROM bayno_stage_events_v2 s JOIN bayno_final_events_v21 f ON s.source_file=f.source_file
 WHERE f.status='ACCEPTED' AND s.record_type='01' AND s.row_error IS NULL;
 INSERT INTO bayno_exceptions_v2
 SELECT CONCAT(f.file_id,':',CAST(s.line_number AS STRING),':',s.row_error),REGEXP_EXTRACT(f.source_file,'_R([0-9a-f-]{36})_O',1),f.file_id,s.source_file,s.line_number,
 s.row_error,'Invalid detail: required fields, ISO date, HHMM time and field count'
 FROM bayno_stage_events_v2 s JOIN bayno_final_events_v21 f ON s.source_file=f.source_file
 WHERE s.record_type='01' AND s.row_error IS NOT NULL
 UNION ALL
 SELECT CONCAT(f.file_id,':0:',f.file_error),REGEXP_EXTRACT(f.source_file,'_R([0-9a-f-]{36})_O',1),f.file_id,f.source_file,CAST(0 AS BIGINT),f.file_error,f.file_error
 FROM bayno_final_events_v21 f WHERE f.file_error IS NOT NULL;
END;
