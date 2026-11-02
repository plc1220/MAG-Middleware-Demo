CREATE VIEW bayno_stage_events_v2 AS
SELECT * FROM TO_CHANGELOG(input => TABLE bayno_staging_v2, op => DESCRIPTOR(change_kind))
WHERE change_kind IN ('INSERT','UPDATE_AFTER');
