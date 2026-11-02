#!/usr/bin/env python3
"""Operator-only live acceptance fixture: release 100 completed synthetic incremental files.
Does not write Kafka or destination tables; every fixture goes through the managed source.
"""
import datetime,hashlib,json,os,pathlib,uuid
import psycopg2
from psycopg2.extras import Json
from reference import generate
run=str(uuid.uuid4());root=pathlib.Path('/srv/sftp/magdemo/incoming');spool=pathlib.Path('/var/lib/bayno-demo/backlog')/run;spool.mkdir(parents=True)
db=psycopg2.connect('dbname=magbayno user=bayno_worker_login')
with db:
 with db.cursor() as c:
  c.execute("INSERT INTO demo.runs(id,idempotency_key,requested_by,scenario,file_count,detail_count,interval_seconds,generation_status,generated_count) VALUES(%s,%s,'implementation-acceptance-backlog','sequence',100,20,60,'COMPLETED',100)",(run,run))
  for ordinal in range(1,101):
   c.execute("SELECT nextval('demo.file_sequence')");seq=c.fetchone()[0]
   name,content,expected,scenario=generate(run,ordinal,seq,20,'sequence')
   file_id=hashlib.sha256(content.encode()).hexdigest()
   c.execute('INSERT INTO demo.files(file_id,run_id,ordinal,source_file,content,expected,scenario,generated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,now())',(file_id,run,ordinal,name,content,Json(expected),scenario))
   (spool/name).write_text(content)
  c.execute("INSERT INTO demo.events(run_id,stage,detail) VALUES(%s,'BACKLOG_RELEASED',%s)",(run,Json({'files':100,'details_per_file':20,'path':'managed SFTP source only'})))
for path in spool.iterdir():os.replace(path,root/path.name)
spool.rmdir();print(run)
