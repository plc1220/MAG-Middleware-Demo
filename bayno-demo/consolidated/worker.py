#!/usr/bin/env python3
"""Durable VM generator and read-only destination verifier. Business writes use Connect only."""
import datetime, hashlib, json, logging, os, pathlib, threading, time
import psycopg2
from psycopg2.extras import RealDictCursor, Json
from reference import generate, canonical, TOPICS
ROOT=pathlib.Path(os.environ.get('BAYNO_SFTP_ROOT','/srv/sftp/magdemo'))
STATE=pathlib.Path(os.environ.get('BAYNO_STATE_DIR','/var/lib/bayno-demo'))
def connect():return psycopg2.connect(os.environ.get('BAYNO_WORKER_DSN','dbname=magbayno user=bayno_worker_login'),cursor_factory=RealDictCursor)
def event(c,run,file,stage,detail=None):c.execute('INSERT INTO demo.events(run_id,file_id,stage,detail) VALUES(%s,%s,%s,%s)',(run,file,stage,Json(detail or {})))
def publish(c,f):
    incoming=ROOT/'incoming'; incoming.mkdir(exist_ok=True)
    path=incoming/f['source_file']; archive=STATE/'sources'/f['source_file']; archive.parent.mkdir(parents=True,exist_ok=True)
    for existing in (path,archive):
        if existing.exists() and hashlib.sha256(existing.read_bytes()).hexdigest()!=f['file_id']:
            raise ValueError('Filename already exists with different content')
    # Durable manifest is committed before publication; recovery recognizes existing archive/source files.
    if not archive.exists():
        with archive.open('w') as handle:handle.write(f['content']);handle.flush();os.fsync(handle.fileno())
    # A published marker is fsynced before the manifest's generated_at is committed.
    marker=STATE/'published'/f['source_file']; marker.parent.mkdir(exist_ok=True)
    if not marker.exists():
        if not path.exists():
            tmp=incoming/(f['source_file']+'.tmp')
            with tmp.open('w') as handle:handle.write(f['content']);handle.flush();os.fsync(handle.fileno())
            os.replace(tmp,path)
            fd=os.open(incoming,os.O_RDONLY);os.fsync(fd);os.close(fd)
        marker.touch();fd=os.open(marker,os.O_RDONLY);os.fsync(fd);os.close(fd)
    c.execute('UPDATE demo.files SET generated_at=COALESCE(generated_at,now()) WHERE file_id=%s',(f['file_id'],))
    c.execute("UPDATE demo.runs SET generated_count=%s,next_at=CASE WHEN next_at+interval_seconds*interval '1 second'>now() THEN next_at+interval_seconds*interval '1 second' ELSE now()+interval_seconds*interval '1 second' END,updated_at=now(),generation_status=CASE WHEN %s>=file_count THEN 'COMPLETED' ELSE 'RUNNING' END WHERE id=%s",(f['ordinal'],f['ordinal'],f['run_id']))
    event(c,f['run_id'],f['file_id'],'GENERATED')
def tick(db):
    with db:
        with db.cursor() as c:
            # Run IDs never change. NO KEY UPDATE permits the verifier's event
            # foreign-key checks to coexist with generator progress updates.
            c.execute("SELECT * FROM demo.runs WHERE generation_status IN ('QUEUED','RUNNING') ORDER BY created_at LIMIT 1 FOR NO KEY UPDATE")
            r=c.fetchone()
            if not r:return
            if r['stop_requested']:
                c.execute("UPDATE demo.runs SET generation_status='STOPPED',updated_at=now() WHERE id=%s",(r['id'],));event(c,r['id'],None,'GENERATION_STOPPED');return
            if r['next_at']>datetime.datetime.now(datetime.timezone.utc):return
            ordinal=r['generated_count']+1
            c.execute('SELECT * FROM demo.files WHERE run_id=%s AND ordinal=%s',(r['id'],ordinal));f=c.fetchone()
            if not f:
                c.execute("SELECT nextval('demo.file_sequence') n");sequence=c.fetchone()['n']
                name,content,expected,scenario=generate(str(r['id']),ordinal,sequence,r['detail_count'],r['scenario'])
                file_id=hashlib.sha256(content.encode()).hexdigest()
                c.execute('INSERT INTO demo.files(file_id,run_id,ordinal,source_file,content,expected,scenario) VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING *',(file_id,r['id'],ordinal,name,content,Json(expected),scenario));f=c.fetchone()
    try:
        with db:
            with db.cursor() as c:publish(c,f)
    except ValueError:
        with db:
            with db.cursor() as c:
                c.execute("UPDATE demo.runs SET generation_status='FAILED',error='Filename content conflict',updated_at=now() WHERE id=%s",(f['run_id'],))
                event(c,f['run_id'],f['file_id'],'FILENAME_CONTENT_CONFLICT')
def scan_artifacts(c):
    records={t:[] for t in TOPICS}; observed=[]
    for path in (ROOT/'outgoing').rglob('*.json'):
        stat=path.stat()
        if time.time()-stat.st_mtime<75:continue
        if stat.st_size>20_000_000:continue
        raw=path.read_bytes()
        if path.stat().st_mtime_ns!=stat.st_mtime_ns:continue
        try:items=[json.loads(line) for line in raw.splitlines() if line.strip()]
        except (ValueError,UnicodeDecodeError):continue
        items=[x if isinstance(x,dict) else {'record_id':None} for x in items]
        topic=next((t for t in TOPICS if t in path.parts or t in path.name),None)
        if not topic:continue
        records[topic].extend(items)
        ids=sorted({str(x.get('run_id','')) for x in items})
        c.execute('INSERT INTO demo.artifacts(path,size,sha256,previews,run_ids,modified_at) VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(path) DO UPDATE SET size=EXCLUDED.size,sha256=EXCLUDED.sha256,previews=EXCLUDED.previews,run_ids=EXCLUDED.run_ids,modified_at=EXCLUDED.modified_at,observed_at=now()', (str(path.relative_to(ROOT)),len(raw),hashlib.sha256(raw).hexdigest(),Json(items[:3]),ids,datetime.datetime.fromtimestamp(stat.st_mtime,datetime.timezone.utc)))
        observed.append(str(path.relative_to(ROOT)))
    return records

def compare(expected,actual):
    wanted={r['record_id']:canonical(r) for r in expected}; seen={};duplicates=0;conflicts=[]
    for row in actual:
        key=row.get('record_id')
        if key is None:
            conflicts.append('<missing record_id>');continue
        value=canonical(row)
        if key in seen:duplicates+=1
        if key in seen and seen[key]!=value:conflicts.append(key)
        seen[key]=value
    missing=sorted(wanted.keys()-seen.keys());extra=sorted(seen.keys()-wanted.keys())
    different=sorted(k for k in wanted.keys()&seen.keys() if wanted[k]!=seen[k])
    return not (missing or extra or different or conflicts),duplicates,dict(missing=missing[:10],extra=extra[:10],different=different[:10],conflicts=conflicts[:10])
def dlq_health():
    from confluent_kafka import Consumer, TopicPartition
    key=os.environ.get('BAYNO_KAFKA_KEY');secret=os.environ.get('BAYNO_KAFKA_SECRET')
    if not key or not secret:return {'checked':False,'reason':'DLQ monitor is not configured'}
    client=Consumer({'bootstrap.servers':'pkc-ldvr1.asia-southeast1.gcp.confluent.cloud:9092','security.protocol':'SASL_SSL','sasl.mechanisms':'PLAIN','sasl.username':key,'sasl.password':secret,'group.id':'bayno-verifier','enable.auto.commit':False,'socket.timeout.ms':5000})
    counts={}
    try:
        for topic in ('bayno_dlq_sftp_v2','bayno_dlq_postgres_v2'):
            meta=client.list_topics(topic,timeout=5).topics[topic]
            if meta.error:return {'checked':False,'reason':'DLQ metadata unavailable'}
            counts[topic]=sum(hi-lo for lo,hi in (client.get_watermark_offsets(TopicPartition(topic,p),timeout=5) for p in meta.partitions))
        return {'checked':True,'counts':counts,'clean':not any(counts.values())}
    except Exception:return {'checked':False,'reason':'DLQ status unavailable'}
    finally:client.close()
def verify(db):
    with db:
        with db.cursor() as c:
            files=scan_artifacts(c)
            dlq=dlq_health()
            c.execute("SELECT * FROM demo.files WHERE generated_at IS NOT NULL AND generated_at>now()-interval '7 days'");pending=c.fetchall()
            for f in pending:
                expected=f['expected']; pg_ok=sftp_ok=True; duplicates=0;evidence={};pg_result=[]
                archived=ROOT/'archive'/f['source_file']
                archived_hash=hashlib.sha256(archived.read_bytes()).hexdigest() if archived.is_file() else None
                evidence['ingestion']={'source_archived':bool(archived_hash),'sha256':archived_hash}
                for topic in TOPICS:
                    c.execute(f'SELECT * FROM public.{topic} WHERE file_id=%s',(f['file_id'],));pgrows=[dict(r) for r in c.fetchall()]
                    if topic==TOPICS[1]:pg_result=pgrows
                    sf=[x for x in files[topic] if x.get('file_id')==f['file_id']]
                    a,_,ae=compare(expected[topic],pgrows);b,dup,be=compare(expected[topic],sf)
                    pg_ok &= a;sftp_ok &= b;duplicates+=dup;evidence[topic]={'postgres':ae,'sftp':be,'expected':len(expected[topic]),'pg_count':len(pgrows),'sftp_count':len(sf),'pg_hash':hashlib.sha256('\n'.join(sorted(canonical(x) for x in pgrows)).encode()).hexdigest(),'sftp_hash':hashlib.sha256('\n'.join(sorted(canonical(x) for x in sf)).encode()).hexdigest()}
                conflicts=(archived_hash is not None and archived_hash!=f['file_id']) or any(evidence[t][d]['different'] or evidence[t][d]['extra'] or evidence[t][d]['conflicts'] for t in TOPICS for d in ('postgres','sftp'))
                status='MISMATCH' if conflicts or duplicates or (dlq.get('checked') and not dlq.get('clean')) else 'RECONCILED' if pg_ok and sftp_ok and dlq.get('clean') else 'DELIVERY_PENDING'
                processing='REJECTED' if pg_result and pg_result[0]['status']=='REJECTED' else 'TRANSFORMED' if pg_result else 'INGESTED' if archived_hash else 'PROCESSING'
                evidence['dlq']=dlq
                evidence['overdue']=status=='DELIVERY_PENDING' and (datetime.datetime.now(datetime.timezone.utc)-f['generated_at']).total_seconds()>300
                evidence['hash_algorithm']='SHA-256 over canonical JSON, excluding rec_ld_ts';evidence['expected_hashes']={t:hashlib.sha256('\n'.join(sorted(canonical(x) for x in expected[t])).encode()).hexdigest() for t in TOPICS}
                c.execute('UPDATE demo.files SET processing_status=%s,delivery_status=%s,pg_match=%s,sftp_match=%s,duplicates=%s,evidence=%s,checked_at=now() WHERE file_id=%s',(processing,status,pg_ok,sftp_ok,duplicates,Json(evidence),f['file_id']))
                if f['delivery_status']!=status:event(c,f['run_id'],f['file_id'],status)
            c.execute("INSERT INTO demo.worker_status(name,heartbeat) VALUES('verifier',clock_timestamp()) ON CONFLICT(name) DO UPDATE SET heartbeat=clock_timestamp()")
GENERATOR_POLL_SECONDS=0.5
VERIFIER_POLL_SECONDS=15

def worker_loop(role,stop):
    # Each loop owns a connection and advisory lock. Slow destination reads
    # never occupy the generator's connection or delay its publication ticks.
    interval=GENERATOR_POLL_SECONDS if role=='generator' else VERIFIER_POLL_SECONDS
    lock=892014 if role=='generator' else 892015
    while not stop.is_set():
        db=None
        try:
            db=connect();db.autocommit=True
            with db.cursor() as c:
                c.execute('SELECT pg_try_advisory_lock(%s) locked',(lock,))
                if not c.fetchone()['locked']:raise RuntimeError('Another worker owns the '+role+' lock')
            db.autocommit=False
            while not stop.is_set():
                started=time.monotonic()
                if role=='generator':
                    tick(db)
                    with db:
                        with db.cursor() as c:c.execute("INSERT INTO demo.worker_status(name) VALUES('generator') ON CONFLICT(name) DO UPDATE SET heartbeat=now()")
                else:verify(db);cleanup(db)
                stop.wait(max(0,interval-(time.monotonic()-started)))
        except Exception as error:
            logging.error('%s cycle failed: %s',role,type(error).__name__)
            stop.wait(5)
        finally:
            if db is not None:
                try:db.close()
                except Exception:pass

def main():
    logging.basicConfig(level=logging.INFO);STATE.mkdir(parents=True,exist_ok=True)
    stop=threading.Event()
    verifier=threading.Thread(target=worker_loop,args=('verifier',stop),daemon=True,name='bayno-verifier')
    verifier.start()
    try:worker_loop('generator',stop)
    finally:stop.set();verifier.join(timeout=5)

def cleanup(db):
    cutoff=time.time()-7*86400
    for directory in (STATE/'sources',STATE/'published',ROOT/'archive',ROOT/'ingestion-error',ROOT/'outgoing'):
        if directory.exists():
            for p in directory.rglob('*'):
                if p.is_file() and not p.is_symlink() and p.stat().st_mtime<cutoff:p.unlink()
    with db:
        with db.cursor() as c:
            c.execute("DELETE FROM demo.runs WHERE created_at<now()-interval '7 days' AND generation_status NOT IN ('QUEUED','RUNNING')")
            c.execute("DELETE FROM demo.artifacts WHERE modified_at<now()-interval '7 days'")
            c.execute("DELETE FROM demo.approvals WHERE expires_at<now()-interval '7 days'")
if __name__=='__main__':main()

