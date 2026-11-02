#!/usr/bin/env python3
"""Live negative/boundary fixtures, published exclusively through managed SFTP."""
import hashlib,pathlib,uuid
import psycopg2
from psycopg2.extras import Json
from reference import generate,evaluate
cases=['zero-details','threshold-20','threshold-25','bad-csv','missing-trailer','count-mismatch','filename-stamp','duplicate-header','source-mismatch']
run=str(uuid.uuid4());root=pathlib.Path('/srv/sftp/magdemo/incoming');db=psycopg2.connect('dbname=magbayno user=bayno_worker_login');files=[]
with db:
 with db.cursor() as c:
  c.execute("INSERT INTO demo.runs(id,idempotency_key,requested_by,scenario,file_count,detail_count,interval_seconds,generation_status,generated_count) VALUES(%s,%s,'implementation-validation-scenarios','sequence',9,20,60,'COMPLETED',9)",(run,run))
  for ordinal,case in enumerate(cases,1):
   c.execute("SELECT nextval('demo.file_sequence')");seq=c.fetchone()[0]
   name,content,_,_=generate(run,ordinal,seq,0 if case=='zero-details' else 20,'valid')
   lines=content.splitlines()
   if case.startswith('threshold-'):
    for i in range(1,5 if case=='threshold-20' else 6):
     cells=lines[i].split(',');cells[4]='9999';lines[i]=','.join(cells)
   elif case=='bad-csv':lines[1]='01,"unclosed'
   elif case=='missing-trailer':lines.pop()
   elif case=='count-mismatch':lines[-1]='99,FMCS0000,21'
   elif case=='filename-stamp':
    cells=lines[0].split(',');cells[3]='20261102';lines[0]=','.join(cells)
   elif case=='duplicate-header':lines.insert(1,lines[0])
   elif case=='source-mismatch':lines[-1]='99,OTHER000,20'
   content='\n'.join(lines)+'\n';expected=evaluate(content,name,run);file_id=hashlib.sha256(content.encode()).hexdigest()
   c.execute('INSERT INTO demo.files(file_id,run_id,ordinal,source_file,content,expected,scenario,generated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,now())',(file_id,run,ordinal,name,content,Json(expected),case));files.append((name,content))
for name,content in files:
 p=root/(name+'.tmp');p.write_text(content);p.rename(root/name)
print(run)
