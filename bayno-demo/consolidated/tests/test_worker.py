import pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from worker import compare
class ReconciliationTests(unittest.TestCase):
 def test_exact(self):self.assertTrue(compare([{'record_id':'a','v':1}],[{'record_id':'a','v':1}])[0])
 def test_missing(self):self.assertFalse(compare([{'record_id':'a'}],[])[0])
 def test_conflicting_duplicate(self):
  ok,dup,e=compare([{'record_id':'a','v':1}],[{'record_id':'a','v':1},{'record_id':'a','v':2}]);self.assertFalse(ok);self.assertEqual(dup,1);self.assertEqual(e['conflicts'],['a'])
 def test_identical_duplicate_detected(self):self.assertEqual(compare([{'record_id':'a'}],[{'record_id':'a'},{'record_id':'a'}])[1],1)
 def test_missing_record_identity_is_mismatch(self):self.assertFalse(compare([{'record_id':'a'}],[{'v':1}])[0])
 def test_runtime_timestamp_excluded(self):self.assertTrue(compare([{'record_id':'a'}],[{'record_id':'a','rec_ld_ts':'runtime'}])[0])
 def test_rejected_has_no_business_rows(self):self.assertFalse(compare([],[{'record_id':'unexpected'}])[0])
if __name__=='__main__':unittest.main()
