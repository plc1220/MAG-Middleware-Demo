CREATE VIEW bayno_final_events_v2 AS
SELECT * FROM (
 SELECT *, ROW_NUMBER() OVER(PARTITION BY source_file ORDER BY file_id ASC) rn
 FROM (
  SELECT * FROM TO_CHANGELOG(input => TABLE bayno_file_state_v2, op => DESCRIPTOR(change_kind))
  WHERE complete AND status IN ('ACCEPTED','REJECTED') AND change_kind IN ('INSERT','UPDATE_AFTER')
 )
) WHERE rn=1;
