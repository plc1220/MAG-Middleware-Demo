#!/usr/bin/env python3
"""Roll routing forward after table format changes; retain the prior stopped statement."""
import base64,json,pathlib,time,urllib.request,sys
from cloud import secret
base='https://flink.asia-southeast1.gcp.confluent.cloud/sql/v1/organizations/77c1b28e-7cc7-48b6-a48a-dad646769755/environments/env-pozpjk/statements/'
headers={'Authorization':'Basic '+base64.b64encode(secret('mag-bayno-confluent-mcp-auth').encode()).decode(),'Content-Type':'application/json'}
name=sys.argv[1] if len(sys.argv)>1 else 'mag-bayno-demo-v2-30-route'
with urllib.request.urlopen(urllib.request.Request(base+name,headers=headers)) as r:old=json.load(r)
old['spec']['stopped']=True
req=urllib.request.Request(base+name,method='PATCH',headers=headers,data=json.dumps([{'path':'/spec/stopped','op':'replace','value':True}]).encode())
with urllib.request.urlopen(req) as r:print('Old routing stop requested:',r.status)
for _ in range(30):
 with urllib.request.urlopen(urllib.request.Request(base+name,headers=headers)) as r:d=json.load(r)
 if d['status']['phase']=='STOPPED':break
 time.sleep(2)
else:raise RuntimeError('Routing did not stop; no replacement started')
p=pathlib.Path(__file__).parent/'sql';target=p/(sys.argv[2] if len(sys.argv)>2 else '31-route-with-values.sql')
if not target.exists():target.write_text((p/'30-route.sql').read_text())
