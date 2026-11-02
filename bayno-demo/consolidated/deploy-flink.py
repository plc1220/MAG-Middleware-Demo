#!/usr/bin/env python3
"""Apply versioned SQL sequentially; stop on any remote failure. Explicit operator invocation only."""
import base64,json,pathlib,sys,time,urllib.request,urllib.error,subprocess
from cloud import secret
ROOT=pathlib.Path(__file__).parent
base='https://flink.asia-southeast1.gcp.confluent.cloud/sql/v1/organizations/77c1b28e-7cc7-48b6-a48a-dad646769755/environments/env-pozpjk/statements'
key=secret('mag-bayno-confluent-mcp-auth');headers={'Authorization':'Basic '+base64.b64encode(key.encode()).decode(),'Content-Type':'application/json'}
def call(url,data=None):
    req=urllib.request.Request(url,headers=headers,data=json.dumps(data).encode() if data else None)
    try:
        with urllib.request.urlopen(req,timeout=60) as r:return json.load(r)
    except urllib.error.HTTPError as e:
        data=e.read().decode();raise RuntimeError(f'Flink HTTP {e.code}: {data[:1500]}') from None
for path in sorted((ROOT/'sql').glob('*.sql')):
    if path.name=='postgres.sql':continue
    if len(sys.argv)==1 and path.name in ('11-file-state.sql','12-final-events.sql','30-route.sql','31-route-with-values.sql','32-route-key-values.sql','33-route-complete.sql') and (ROOT/'sql'/'34-route-final.sql').exists():continue
    if len(sys.argv)>1 and path.name not in sys.argv[1:]:continue
    if path.name=='34-route-final.sql':subprocess.run([sys.executable,str(ROOT/'include-record-ids.py')],check=True)
    name='mag-bayno-demo-v2-'+path.stem.replace('_','-')
    sql=path.read_text()
    try:old=call(base+'/'+name)
    except RuntimeError as e:
        if 'HTTP 404' not in str(e):raise
        old=None
    if old:
        if old['spec']['statement']!=sql:raise RuntimeError('SQL drift for '+name+'; use a new version, do not overwrite')
        value=old
    else:
        value=call(base,dict(name=name,spec=dict(statement=sql,compute_pool_id='lfcp-xqky88x' if path.name.startswith(('10','14','30','31','32','33','34')) else 'lfcp-rr606r7',properties={'sql.current-catalog':'lumo-demo','sql.current-database':'lumo-demo','sql.state-ttl':'8 d'})))
    for _ in range(60):
        phase=value.get('status',{}).get('phase')
        if phase in ('RUNNING','COMPLETED'):break
        if phase in ('FAILED','FAILING','STOPPED'):raise RuntimeError(name+': '+json.dumps(value.get('status')))
        time.sleep(2);value=call(base+'/'+name)
    else:raise RuntimeError(name+' did not become ready')
    print(name,phase,flush=True)
