import pathlib,sys,threading,time,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import worker

class FakeDB:
 def __init__(self):self.locks=[];self.closed=False
 def cursor(self):return self
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def execute(self,sql,args=None):
  if 'pg_try_advisory_lock' in sql:self.locks.append(args[0])
 def fetchone(self):return {'locked':True}
 def close(self):self.closed=True

class CadenceTests(unittest.TestCase):
 def test_slow_verification_does_not_block_generation(self):
  stop=threading.Event();verifying=threading.Event();progress=threading.Event();dbs=[];ticks=[]
  def connect():
   db=FakeDB();dbs.append(db);return db
  def tick(db):
   ticks.append(time.monotonic())
   if len(ticks)>=3 and verifying.is_set():progress.set()
  def verify(db):verifying.set();stop.wait(2)
  with patch.object(worker,'connect',connect),patch.object(worker,'tick',tick),patch.object(worker,'verify',verify),patch.object(worker,'cleanup',lambda db:None),patch.object(worker,'GENERATOR_POLL_SECONDS',0.01):
   threads=[threading.Thread(target=worker.worker_loop,args=(role,stop)) for role in ('generator','verifier')]
   for thread in threads:thread.start()
   try:self.assertTrue(progress.wait(1),'Generator was delayed by the blocked verifier')
   finally:
    stop.set()
    for thread in threads:thread.join(2)
  self.assertEqual(sorted(db.locks[0] for db in dbs),[892014,892015])
  self.assertTrue(all(db.closed for db in dbs))

if __name__=='__main__':unittest.main()
