#!/usr/bin/env python3
import pathlib,subprocess,secrets
from cloud import PROJECT,secret
path=pathlib.Path('infra/private/consolidated-roles.sql');path.parent.mkdir(exist_ok=True);sql=[]
for role,group in [('bayno_web_login','bayno_web'),('bayno_sink_login','bayno_sink')]:
    name='mag-bayno-'+('web' if group=='bayno_web' else 'sink')+'-postgres-password'
    exists=subprocess.run(['gcloud','secrets','describe',name,'--project='+PROJECT],capture_output=True).returncode==0
    if exists:password=secret(name)
    else:
        password=secrets.token_hex(32)
        subprocess.run(['gcloud','secrets','create',name,'--replication-policy=automatic','--project='+PROJECT],check=True,capture_output=True)
        subprocess.run(['gcloud','secrets','versions','add',name,'--data-file=-','--project='+PROJECT],input=password.encode(),check=True,capture_output=True)
    escaped=password.replace("'","''")
    sql.append(f"DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='{role}') THEN CREATE ROLE {role} LOGIN; END IF; END $$;\nALTER ROLE {role} PASSWORD '{escaped}';\nGRANT {group} TO {role};")
path.touch(mode=0o600);path.write_text('\n'.join(sql))
print('Separate web/sink credentials prepared in Secret Manager; private SQL file ready for VM application.')
