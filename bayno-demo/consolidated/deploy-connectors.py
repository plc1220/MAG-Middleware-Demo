#!/usr/bin/env python3
"""Provision dedicated managed connectors without persisting their secret config."""
import base64,json,pathlib,os
from cloud import request,secret,ENV,CLUSTER,list_all
ORG='77c1b28e-7cc7-48b6-a48a-dad646769755';BASE=f'/connect/v1/environments/{ENV}/clusters/{CLUSTER}'
existing=list_all('/iam/v2/service-accounts')
roles=[]
def sa(name):
    found=next((x for x in existing if x['display_name']==name),None)
    return (found or request('/iam/v2/service-accounts','POST',dict(display_name=name,description='Consolidated BAYNO managed connector')))['id']
def grant(principal,role,suffix):
    if os.environ.get('BAYNO_SKIP_ACLS'):return
    from kafka_admin import kafka
    kind,name=suffix.split('=',1)
    operations={'DeveloperRead':['READ','DESCRIBE'],'DeveloperWrite':['WRITE','DESCRIBE'],'DeveloperManage':['CREATE','DESCRIBE_CONFIGS']}
    for op in operations[role]:
        kafka('/acls','POST',dict(resource_type=kind.upper(),resource_name=name.rstrip('*') if name!='*' else '*',pattern_type='PREFIXED' if name.endswith('*') and name!='*' else 'LITERAL',principal='User:'+principal,host='*',operation=op,permission='ALLOW'))
def create(name,config):
    config.update(name=name,**{'tasks.max':'1','kafka.auth.mode':'SERVICE_ACCOUNT'})
    names=request(BASE+'/connectors')
    if name in names:
        if os.environ.get('BAYNO_UPDATE_CONNECTOR')==name:
            request(BASE+'/connectors/'+name+'/config','PUT',config);print(name,'updated');return
        print(name,'already exists; no config overwritten');return
    # Validation responses may contain credentials. Only sanitized errors are printed.
    validation=request(BASE+'/connector-plugins/'+config['connector.class']+'/config/validate','PUT',config)
    errors=[{'name':c.get('definition',{}).get('name'), 'count':len(c.get('value',{}).get('errors',[]))} for c in validation.get('configs',[]) if c.get('value',{}).get('errors')]
    if validation.get('error_count',0):raise RuntimeError('Connector validation failed: '+json.dumps(errors))
    request(BASE+'/connectors','POST',dict(name=name,config=config));print(name,'created')
source_sa=sa('mag-bayno-v2-source');pg_sa=sa('mag-bayno-v2-postgres');sftp_sa=sa('mag-bayno-v2-sftp')
for who in [source_sa,pg_sa,sftp_sa]:
    grant(who,'DeveloperRead','group=*')
    grant(who,'DeveloperRead','topic=bayno_*')
    grant(who,'DeveloperWrite','topic=bayno_dlq_*')
    grant(who,'DeveloperManage','topic=bayno_dlq_*')
grant(source_sa,'DeveloperWrite','topic=bayno_raw_lines')
key=pathlib.Path('infra/private/sftp_source_rsa').read_text()
sftp={'sftp.host':'34.87.74.134','sftp.port':'22','sftp.username':'magdemo','tls.pemfile':key,'tls.passphrase':'unused'}
source=json.loads(pathlib.Path('bayno-demo/consolidated/snapshots/source-config.json').read_text())
source={k:v for k,v in source.items() if v!='[redacted]' and k not in ('cloud.environment','cloud.provider','kafka.endpoint','kafka.region')}
source.update(sftp);source.update({'kafka.service.account.id':source_sa,'input.path':'/incoming','finished.path':'/archive','error.path':'/ingestion-error','input.file.pattern':'.*_R[0-9a-f-]{36}_O[0-9]{4}[.]csv','file.minimum.age.ms':'3000'})
create('mag-bayno-demo-v2-source',source)
topics='bayno_processed_v2,bayno_file_results_v2,bayno_exceptions_v2'
create('mag-bayno-demo-v2-sftp-sink',dict(sftp,**{'connector.class':'SftpSink','kafka.service.account.id':sftp_sa,'topics':topics,'input.data.format':'AVRO','output.data.format':'JSON','time.interval':'HOURLY','sftp.working.dir':'/outgoing','flush.size':'1000','rotate.schedule.interval.ms':'60000','timezone':'UTC','errors.tolerance':'all','errors.deadletterqueue.topic.name':'bayno_dlq_sftp_v2'}))
create('mag-bayno-demo-v2-postgres-sink',{'connector.class':'PostgresSink','kafka.service.account.id':pg_sa,'topics':topics,'input.data.format':'AVRO','connection.host':'34.87.74.134','connection.port':'5432','connection.user':'bayno_sink_login','connection.password':secret('mag-bayno-sink-postgres-password'),'db.name':'magbayno','insert.mode':'UPSERT','pk.mode':'record_key','input.key.format':'AVRO','pk.fields':'record_id','auto.create':'false','auto.evolve':'false','ssl.mode':'verify-ca','ssl.rootcertfile':'data:application/x-x509-ca-cert;base64,'+base64.b64encode(secret('mag-bayno-postgres-ca').encode()).decode(),'errors.tolerance':'all','errors.deadletterqueue.topic.name':'bayno_dlq_postgres_v2'})
print('Service accounts:',source_sa,pg_sa,sftp_sa)
