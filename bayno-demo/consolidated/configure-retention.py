#!/usr/bin/env python3
"""Bound active demo topic history without changing the persistent feed-control dimension."""
import json,pathlib
from kafka_admin import kafka
snapshots={}
for topic in ['bayno_raw_lines','bayno_staging_v2','bayno_file_state_v21','bayno_processed_v2','bayno_file_results_v2','bayno_exceptions_v2']:
 current=kafka('/topics/'+topic+'/configs');snapshots[topic]=current
 kafka('/topics/'+topic+'/configs/retention.ms','PUT',{'value':'604800000'})
 if topic!='bayno_raw_lines':kafka('/topics/'+topic+'/configs/cleanup.policy','PUT',{'value':'compact,delete'})
 print(topic,'seven-day retention configured',flush=True)
pathlib.Path('bayno-demo/consolidated/snapshots/topic-configs-before-retention.json').write_text(json.dumps(snapshots,indent=2))
