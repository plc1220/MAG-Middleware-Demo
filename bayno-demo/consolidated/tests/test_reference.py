import datetime,pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from reference import evaluate,generate,TOPICS
class OracleTests(unittest.TestCase):
 def fixture(self,scenario='valid',count=20):return generate('11111111-1111-1111-1111-111111111111',1,1,count,scenario,datetime.datetime(2026,11,1,tzinfo=datetime.timezone.utc))
 def test_valid(self):
  _,_,e,_=self.fixture();self.assertEqual(len(e[TOPICS[0]]),20);self.assertEqual(e[TOPICS[1]][0]['status'],'ACCEPTED')
 def test_threshold(self):
  n,c,_,_=self.fixture();c=c.replace('0000,KUL','9999,KUL') # independently set exactly four bad details
  lines=c.splitlines();
  for i in range(1,5):
   cells=lines[i].split(',');cells[4]='9999';lines[i]=','.join(cells)
  c='\n'.join(lines)+'\n';e=evaluate(c,n,'test');self.assertEqual(e[TOPICS[1]][0]['status'],'ACCEPTED');self.assertEqual(len(e[TOPICS[0]]),16)
  cells=lines[5].split(',');cells[4]='9999';lines[5]=','.join(cells);e=evaluate('\n'.join(lines)+'\n',n,'test');self.assertEqual(e[TOPICS[1]][0]['status'],'REJECTED');self.assertFalse(e[TOPICS[0]])
 def test_count_mismatch(self):
  n,c,_,_=self.fixture();e=evaluate(c.replace('99,FMCS0000,20','99,FMCS0000,21'),n,'test');self.assertEqual(e[TOPICS[2]][0]['error_code'],'COUNT_MISMATCH')
 def test_missing_trailer(self):
  n,c,_,_=self.fixture();e=evaluate('\n'.join(c.splitlines()[:-1])+'\n',n,'test');self.assertEqual(e[TOPICS[1]][0]['status'],'REJECTED')
 def test_filename_consistency(self):
  n,c,_,_=self.fixture();e=evaluate(c,n.replace('_00001_','_99999_'),'test');self.assertEqual(e[TOPICS[2]][0]['error_code'],'FILENAME_HEADER_MISMATCH')
 def test_incremental_identity(self):
  a=self.fixture()[2];b=generate('11111111-1111-1111-1111-111111111111',2,2,20,'valid')[2];self.assertNotEqual(a[TOPICS[1]][0]['file_id'],b[TOPICS[1]][0]['file_id'])
 def test_bad_csv_retains_detail_identity(self):
  n,c,_,_=self.fixture();lines=c.splitlines();lines[1]='01,"unclosed';e=evaluate('\n'.join(lines)+'\n',n,'test');self.assertEqual(e[TOPICS[1]][0]['actual_count'],20);self.assertEqual(e[TOPICS[1]][0]['invalid_count'],1);self.assertEqual(len(e[TOPICS[2]]),2)
 def test_zero_detail(self):
  n,c,_,_=self.fixture(count=0);e=evaluate(c,n,'test');self.assertEqual(e[TOPICS[1]][0]['status'],'ACCEPTED');self.assertFalse(e[TOPICS[0]])
 def test_replay_stable(self):
  n,c,e,_=self.fixture();self.assertEqual(e,evaluate(c,n,'11111111-1111-1111-1111-111111111111'))
if __name__=='__main__':unittest.main()
