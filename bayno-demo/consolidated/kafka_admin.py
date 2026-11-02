"""Cluster-scoped administrative access; secret stored only in Secret Manager."""
import base64,json,subprocess,urllib.request,urllib.error
from cloud import request,secret,PROJECT,CLUSTER,ENV,auth
NAME='mag-bayno-lumo-admin-auth';ENDPOINT='https://pkc-ldvr1.asia-southeast1.gcp.confluent.cloud:443'
def ensure():
 if subprocess.run(['gcloud','secrets','describe',NAME,'--project='+PROJECT],capture_output=True).returncode:return create()
 return secret(NAME)
def create():
 data=request('/iam/v2/api-keys','POST',{'spec':{'display_name':'mag-bayno-consolidation-admin','description':'Deploy managed connector ACLs and bounded replay configuration','owner':{'id':request('/iam/v2/api-keys/'+auth()[0])['spec']['owner']['id']},'resource':{'id':CLUSTER,'environment':ENV}}})
 value=data['id']+':'+data['spec']['secret']
 subprocess.run(['gcloud','secrets','create',NAME,'--replication-policy=automatic','--project='+PROJECT],check=True,capture_output=True)
 subprocess.run(['gcloud','secrets','versions','add',NAME,'--data-file=-','--project='+PROJECT],input=value.encode(),check=True,capture_output=True)
 return value
def kafka(path,method='GET',data=None):
 req=urllib.request.Request(ENDPOINT+'/kafka/v3/clusters/'+CLUSTER+path,method=method,headers={'Authorization':'Basic '+base64.b64encode(ensure().encode()).decode(),'Content-Type':'application/json'},data=json.dumps(data).encode() if data is not None else None)
 try:
  with urllib.request.urlopen(req,timeout=60) as r:
   raw=r.read();return json.loads(raw) if raw else {}
 except urllib.error.HTTPError as e:raise RuntimeError(f'Kafka {method} {path}: {e.code} '+e.read().decode()[:500]) from None
if __name__=='__main__':print('Cluster ACL access:',len(kafka('/acls')['data']))
