"""Optional real-PostgreSQL regression; use a disposable/admin test database."""
import os,unittest,uuid
import psycopg2
from psycopg2 import sql

@unittest.skipUnless(os.environ.get('BAYNO_LOCK_TEST_DSN'),'Set BAYNO_LOCK_TEST_DSN for PostgreSQL lock coverage')
class GeneratorLockTests(unittest.TestCase):
 def test_audit_foreign_key_does_not_block_progress_lock(self):
  namespace='bayno_cadence_test_'+uuid.uuid4().hex[:12]
  a=psycopg2.connect(os.environ['BAYNO_LOCK_TEST_DSN']);b=psycopg2.connect(os.environ['BAYNO_LOCK_TEST_DSN'])
  parent=sql.Identifier(namespace,'runs');child=sql.Identifier(namespace,'events')
  try:
   with a:
    with a.cursor() as c:
     c.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(namespace)))
     c.execute(sql.SQL('CREATE TABLE {} (id int PRIMARY KEY)').format(parent))
     c.execute(sql.SQL('CREATE TABLE {} (run_id int REFERENCES {}(id))').format(child,parent))
     c.execute(sql.SQL('INSERT INTO {} VALUES (1)').format(parent))
   with a.cursor() as c:c.execute(sql.SQL('INSERT INTO {} VALUES (1)').format(child))
   # The verifier's event FK holds a key-share lock until its transaction ends.
   with b.cursor() as c:
    c.execute("SET LOCAL lock_timeout='200ms'")
    with self.assertRaises(psycopg2.errors.LockNotAvailable):c.execute(sql.SQL('SELECT * FROM {} FOR UPDATE').format(parent))
   b.rollback()
   with b.cursor() as c:
    c.execute("SET LOCAL lock_timeout='1s'")
    c.execute(sql.SQL('SELECT * FROM {} FOR NO KEY UPDATE').format(parent))
    self.assertEqual(c.fetchone(),(1,))
  finally:
   b.rollback();b.close();a.rollback()
   with a:
    with a.cursor() as c:c.execute(sql.SQL('DROP SCHEMA IF EXISTS {} CASCADE').format(sql.Identifier(namespace)))
   a.close()

if __name__=='__main__':unittest.main()
