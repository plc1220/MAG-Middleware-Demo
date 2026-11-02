"""Generate versioned SQL from exported working pipeline; do not run it implicitly."""
import json,pathlib
ROOT=pathlib.Path(__file__).parent
load=lambda name:json.loads((ROOT/'snapshots'/f'{name}.json').read_text())['spec']['statement']
write=lambda name,text:(ROOT/'sql'/name).write_text(text)
stage=load('mag-bayno-stage-validated').replace('INSERT INTO bayno_staging','CREATE TABLE bayno_staging_v2 (PRIMARY KEY(source_file,line_number) NOT ENFORCED) DISTRIBUTED BY HASH(source_file,line_number) INTO 1 BUCKETS WITH (\'changelog.mode\'=\'upsert\') AS')
# Bound ingestion input to the explicitly named consolidated generator files.
stage=stage.replace("FROM bayno_raw_lines", "FROM bayno_raw_lines WHERE REGEXP(CAST(headers AS STRING),'file[.]name=FMCS0000_BAYNO000_[0-9]{14}_[0-9]+_R[0-9a-f-]{36}_O[0-9]{4}[.]csv')")
write('10-stage.sql',stage)
stats=load('mag-bayno-file-checks').replace('bayno_file_state','bayno_file_state_v2').replace('bayno_staging','bayno_staging_v2')
stats=stats.replace("WHEN declared_count", "WHEN NOT REGEXP(s.source_file,CONCAT('^',s.source_system,'_',s.feed_type,'_[0-9]{14}_',s.file_sequence,'_R[0-9a-f-]{36}_O[0-9]{4}[.]csv$')) THEN 'FILENAME_HEADER_MISMATCH'\n     WHEN actual_count>1000 THEN 'FILE_TOO_LARGE'\n     WHEN declared_count")
write('11-file-state.sql',stats)
write('12-final-events.sql',"""CREATE VIEW bayno_final_events_v2 AS
SELECT * FROM (
 SELECT *, ROW_NUMBER() OVER(PARTITION BY source_file ORDER BY file_id ASC) rn
 FROM (
  SELECT * FROM TO_CHANGELOG(input => TABLE bayno_file_state_v2, op => DESCRIPTOR(change_kind))
  WHERE complete AND status IN ('ACCEPTED','REJECTED') AND change_kind IN ('INSERT','UPDATE_AFTER')
 )
) WHERE rn=1;
""")
write('13-stage-events.sql',"""CREATE VIEW bayno_stage_events_v2 AS
SELECT * FROM TO_CHANGELOG(input => TABLE bayno_staging_v2, op => DESCRIPTOR(change_kind))
WHERE change_kind IN ('INSERT','UPDATE_AFTER');
""")
columns={
'processed':[('line_number','BIGINT'),('carr','STRING'),('flt_nbr','STRING'),('first_leg_flt_dt','STRING'),('sched_dep_tm','STRING'),('dep_airpt','STRING'),('bay_no','STRING'),('rec_src_sys','STRING'),('file_sequence','STRING'),('rec_ld_ts','STRING')],
'file_results':[('status','STRING'),('reason','STRING'),('declared_count','BIGINT'),('actual_count','BIGINT'),('invalid_count','BIGINT'),('error_percent','STRING')],
'exceptions':[('line_number','BIGINT'),('error_code','STRING'),('explanation','STRING')]}
for n,(kind,fields) in enumerate(columns.items(),20):
    cols=[('record_id','STRING NOT NULL'),('run_id','STRING'),('file_id','STRING'),('source_file','STRING')]+fields
    write(f'{n}-{kind}.sql',f"CREATE TABLE bayno_{kind}_v2 (\n"+',\n'.join(f' `{k}` {v}' for k,v in cols)+",\n PRIMARY KEY(record_id) NOT ENFORCED\n) DISTRIBUTED BY HASH(record_id) INTO 1 BUCKETS WITH ('key.format'='avro-registry','value.format'='avro-registry','changelog.mode'='upsert','kafka.retention.time'='7 days');\n")
run="REGEXP_EXTRACT(f.source_file,'_R([0-9a-f-]{36})_O',1)"
write('30-route.sql',f"""EXECUTE STATEMENT SET
BEGIN
 INSERT INTO bayno_file_results_v2
 SELECT f.file_id,{run},f.file_id,f.source_file,f.status,f.reason,
 CAST(f.declared_count AS BIGINT),CAST(f.actual_count AS BIGINT),CAST(f.invalid_count AS BIGINT),CAST(f.error_percent AS STRING)
 FROM bayno_final_events_v2 f;
 INSERT INTO bayno_processed_v2
 SELECT CONCAT(f.file_id,':',CAST(s.line_number AS STRING)),{run},f.file_id,s.source_file,s.line_number,
 s.c2,s.c3,s.c4,s.c5,s.c6,s.c7,f.source_system,f.file_sequence,CAST(CURRENT_TIMESTAMP AS STRING)
 FROM bayno_stage_events_v2 s JOIN bayno_final_events_v2 f ON s.source_file=f.source_file
 WHERE f.status='ACCEPTED' AND s.record_type='01' AND s.row_error IS NULL;
 INSERT INTO bayno_exceptions_v2
 SELECT CONCAT(f.file_id,':',CAST(s.line_number AS STRING),':',s.row_error),{run},f.file_id,s.source_file,s.line_number,
 s.row_error,'Invalid detail: required fields, ISO date, HHMM time and field count'
 FROM bayno_stage_events_v2 s JOIN bayno_final_events_v2 f ON s.source_file=f.source_file
 WHERE s.record_type='01' AND s.row_error IS NOT NULL
 UNION ALL
 SELECT CONCAT(f.file_id,':0:',f.file_error),{run},f.file_id,f.source_file,CAST(0 AS BIGINT),f.file_error,f.file_error
 FROM bayno_final_events_v2 f WHERE f.file_error IS NOT NULL;
END;
""")
if __name__=='__main__':print('SQL files prepared; no statements executed.')
