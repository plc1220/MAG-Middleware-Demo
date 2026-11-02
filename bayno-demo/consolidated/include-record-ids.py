#!/usr/bin/env python3
"""Add a backward-compatible value copy of the Kafka key to the Avro output schemas."""
import base64,json,urllib.request,urllib.error,pathlib,subprocess
from cloud import secret,request,PROJECT,auth
base='https://psrc-qzvrm.asia-southeast1.gcp.confluent.cloud'
name='mag-bayno-schema-admin-auth'
if subprocess.run(['gcloud','secrets','describe',name,'--project='+PROJECT],capture_output=True).returncode:
 d=request('/iam/v2/api-keys','POST',{'spec':{'display_name':'mag-bayno-schema-deployment','owner':{'id':request('/iam/v2/api-keys/'+auth()[0])['spec']['owner']['id']},'resource':{'id':'lsrc-v7kn5g0','environment':'env-pozpjk'}}})
 key=d['id']+':'+d['spec']['secret']
 subprocess.run(['gcloud','secrets','create',name,'--replication-policy=automatic','--project='+PROJECT],check=True,capture_output=True)
 subprocess.run(['gcloud','secrets','versions','add',name,'--data-file=-','--project='+PROJECT],input=key.encode(),check=True,capture_output=True)
else:key=secret(name)
headers={'Authorization':'Basic '+base64.b64encode(key.encode()).decode(),'Content-Type':'application/vnd.schemaregistry.v1+json'}
for topic in ['bayno_processed_v2','bayno_file_results_v2','bayno_exceptions_v2']:
 path='/subjects/'+topic+'-value/versions'
 req=urllib.request.Request(base+path+'/latest',headers=headers)
 with urllib.request.urlopen(req) as r:old=json.load(r)
 schema=json.loads(old['schema'])
 if any(f['name']=='record_id' for f in schema['fields']):print(topic,'record_id already present');continue
 pathlib.Path('bayno-demo/consolidated/snapshots/'+topic+'-value-before.json').write_text(json.dumps(old,indent=2))
 schema['fields'].insert(0,{'name':'record_id','type':'string','default':''})
 req=urllib.request.Request(base+path,headers=headers,data=json.dumps({'schemaType':'AVRO','schema':json.dumps(schema)}).encode())
 try:
  with urllib.request.urlopen(req) as r:print(topic,'schema updated:',r.status)
 except urllib.error.HTTPError as e:raise RuntimeError(str(e.code)+' '+e.read().decode()[:1000]) from None
