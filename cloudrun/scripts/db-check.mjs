import pg from 'pg';import {execFileSync} from 'node:child_process';
const secret=name=>execFileSync('gcloud',['secrets','versions','access','latest','--secret='+name,'--project=my-rd-coe-demo-gen-ai'],{encoding:'utf8'});
const pool=new pg.Pool({host:'127.0.0.1',port:15432,user:'bayno_web_login',database:'magbayno',password:secret('mag-bayno-web-postgres-password').trim(),ssl:{ca:secret('mag-bayno-postgres-ca'),servername:'mag-bayno-demo',rejectUnauthorized:true},connectionTimeoutMillis:5000});
try{
 console.log('Runs:',(await pool.query('SELECT r.id,r.generation_status,r.generated_count,f.delivery_status,count(*) FROM demo.runs r JOIN demo.files f ON f.run_id=r.id GROUP BY r.id,f.delivery_status ORDER BY r.created_at DESC')).rows);
 if(process.argv[2]) console.log('Requested run mismatches:',JSON.stringify((await pool.query("SELECT ordinal,scenario,evidence FROM demo.files WHERE run_id=$1 AND delivery_status='MISMATCH'",[process.argv[2]])).rows,null,2));
 console.log('Most recent evidence:',(await pool.query("SELECT ordinal,processing_status,delivery_status,pg_match,sftp_match,evidence FROM demo.files WHERE run_id=(SELECT id FROM demo.runs ORDER BY created_at DESC LIMIT 1) ORDER BY ordinal LIMIT 1")).rows);
}finally{await pool.end();}
