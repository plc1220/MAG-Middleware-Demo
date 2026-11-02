#!/usr/bin/env python3
"""Explicit statement lifecycle operations; preserves SQL and stopped statements."""
import base64,json,sys,time,urllib.request,urllib.error
def report(t,e,tb):
 if isinstance(e,urllib.error.HTTPError):print(e.code,e.read().decode()[:1500],file=sys.stderr)
 else:sys.__excepthook__(t,e,tb)
sys.excepthook=report
from cloud import secret
base='https://flink.asia-southeast1.gcp.confluent.cloud/sql/v1/organizations/77c1b28e-7cc7-48b6-a48a-dad646769755/environments/env-pozpjk/statements/'
headers={'Authorization':'Basic '+base64.b64encode(secret('mag-bayno-confluent-mcp-auth').encode()).decode(),'Content-Type':'application/json'}
def read(name):
 with urllib.request.urlopen(urllib.request.Request(base+name,headers=headers)) as r:return json.load(r)
def patch(name,ops):
 with urllib.request.urlopen(urllib.request.Request(base+name,method='PATCH',headers=headers,data=json.dumps(ops).encode())) as r:return json.load(r)
def stopped(name,stop):return patch(name,[{'path':'/spec/stopped','op':'replace','value':stop}])
if __name__=='__main__':
 action,name=sys.argv[1:3]
 if action=='move':
  stopped(name,True)
  for _ in range(45):
   if read(name)['status']['phase']=='STOPPED':break
   time.sleep(2)
  else:raise RuntimeError('Statement did not stop')
  old=read(name);old['spec']['compute_pool_id']=sys.argv[3];old['spec']['stopped']=False
  body={'name':name,'organization_id':old['organization_id'],'environment_id':old['environment_id'],'spec':old['spec'],'metadata':{'resource_version':old['metadata']['resource_version']}}
  with urllib.request.urlopen(urllib.request.Request(base+name,method='PUT',headers=headers,data=json.dumps(body).encode())) as response:response.read()
 else:stopped(name,action=='stop')
 print(name,action,'requested')
