#!/usr/bin/env python3
import json,pathlib,subprocess
from cloud import list_all,request,PROJECT,ENV,CLUSTER,secret
from kafka_admin import kafka
name='mag-bayno-v2-verifier';found=next((x for x in list_all('/iam/v2/service-accounts') if x['display_name']==name),None)
sa=(found or request('/iam/v2/service-accounts','POST',{'display_name':name,'description':'Read DLQ watermarks for destination acceptance'}))['id']
for typ,resource in [('TOPIC','bayno_dlq_'),('GROUP','bayno-verifier')]:
 for op in ['READ','DESCRIBE']:
  kafka('/acls','POST',dict(resource_type=typ,resource_name=resource,pattern_type='PREFIXED' if typ=='TOPIC' else 'LITERAL',principal='User:'+sa,host='*',operation=op,permission='ALLOW'))
secret_name='mag-bayno-dlq-monitor'
if subprocess.run(['gcloud','secrets','describe',secret_name,'--project='+PROJECT],capture_output=True).returncode:
 value=request('/iam/v2/api-keys','POST',{'spec':{'display_name':name,'owner':{'id':sa},'resource':{'id':CLUSTER,'environment':ENV}}})
 value=json.dumps({'key':value['id'],'secret':value['spec']['secret']})
 subprocess.run(['gcloud','secrets','create',secret_name,'--replication-policy=automatic','--project='+PROJECT],check=True,capture_output=True)
 subprocess.run(['gcloud','secrets','versions','add',secret_name,'--data-file=-','--project='+PROJECT],input=value.encode(),check=True,capture_output=True)
else:value=secret(secret_name)
d=json.loads(value);p=pathlib.Path('infra/private/worker.env');p.touch(mode=0o600);p.write_text(f'BAYNO_KAFKA_KEY={d["key"]}\nBAYNO_KAFKA_SECRET={d["secret"]}\n')
# Create explicit DLQs before the first error; absence must not be interpreted as clean.
for topic in ['bayno_dlq_sftp_v2','bayno_dlq_postgres_v2']:
 try:kafka('/topics/'+topic)
 except RuntimeError as e:
  if '404' not in str(e):raise
  kafka('/topics','POST',{'topic_name':topic,'partitions_count':1,'configs':[{'name':'retention.ms','value':'604800000'}]})
kafka('/topics/bayno_raw_lines/configs/retention.ms','PUT',{'value':'604800000'})
print('DLQ monitor and seven-day replay retention prepared.')
