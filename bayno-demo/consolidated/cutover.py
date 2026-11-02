#!/usr/bin/env python3
"""Pause replaced inputs/jobs only after recorded live acceptance; retain rollback resources."""
import base64,json,pathlib,subprocess,urllib.request
from cloud import request,secret,ENV,CLUSTER
import importlib.util
spec=importlib.util.spec_from_file_location('flink_control',pathlib.Path(__file__).with_name('flink-control.py'))
control=importlib.util.module_from_spec(spec);spec.loader.exec_module(control)
root=pathlib.Path(__file__).parent
legacy=['mag-bayno-file-checks','mag-bayno-history-live','mag-bayno-latest','mag-bayno-route-results','mag-bayno-stage-validated']
for name in legacy:
 current=control.read(name);saved=json.loads((root/'snapshots'/f'{name}.json').read_text())
 if current['spec']['statement']!=saved['spec']['statement']:raise RuntimeError('Concurrent SQL change found: '+name+'; no cutover performed')
for name in ['mag-bayno-demo-v2-10-stage','mag-bayno-demo-v2-14-file-state-complete','mag-bayno-demo-v2-34-route-final']:
 if control.read(name)['status']['phase']!='RUNNING':raise RuntimeError('Current pipeline is not ready: '+name)
p=f'/connect/v1/environments/{ENV}/clusters/{CLUSTER}/connectors/'
for name in ['mag-bayno-demo-v2-source','mag-bayno-demo-v2-sftp-sink','mag-bayno-demo-v2-postgres-sink']:
 status=request(p+name+'/status')
 if status['connector']['state']!='RUNNING' or any(t['state']!='RUNNING' for t in status['tasks']):raise RuntimeError('Connector is not ready: '+name)
request(p+'mag-sftp-bayno-source/pause','PUT');print('Legacy SFTP source pause requested.')
for name in legacy:control.stopped(name,True);print('Stopped legacy statement:',name)
(root/'snapshots'/'cutover.json').write_text(json.dumps({'legacy_source':'PAUSE_REQUESTED','legacy_statements':legacy,'current_statements':['mag-bayno-demo-v2-10-stage','mag-bayno-demo-v2-14-file-state-complete','mag-bayno-demo-v2-34-route-final']},indent=2))
