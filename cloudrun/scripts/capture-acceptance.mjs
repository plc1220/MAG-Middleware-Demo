import pg from 'pg';import {execFileSync} from 'node:child_process';import {writeFile} from 'node:fs/promises';
const secret=name=>execFileSync('gcloud',['secrets','versions','access','latest','--secret='+name,'--project=my-rd-coe-demo-gen-ai'],{encoding:'utf8'});
const pool=new pg.Pool({host:'127.0.0.1',port:15432,user:'bayno_web_login',database:'magbayno',password:secret('mag-bayno-web-postgres-password').trim(),ssl:{ca:secret('mag-bayno-postgres-ca'),servername:'mag-bayno-demo',rejectUnauthorized:true}});
const cases={timed:'5b52e61b-8531-44f3-b71b-de3613e223dc',backlog:'a9866317-dcb7-4ead-afed-11e95f0de930',validation:'d9c86954-721b-4424-912b-9193d7ff2f66'};
try{
 for(let attempt=0;attempt<32;attempt++){
  const report={observedAt:new Date().toISOString(),cases:{}};let complete=true;
  for(const [name,id] of Object.entries(cases)){
   const run=(await pool.query('SELECT id,generation_status,file_count,generated_count,created_at,updated_at FROM demo.runs WHERE id=$1',[id])).rows[0];
   const files=(await pool.query('SELECT ordinal,file_id,generated_at,processing_status,delivery_status,pg_match,sftp_match,duplicates,evidence FROM demo.files WHERE run_id=$1 ORDER BY ordinal',[id])).rows;
   const statuses=files.reduce((a,f)=>(a[f.delivery_status]=(a[f.delivery_status]||0)+1,a),{});
   const counts={};for(const topic of ['bayno_processed_v2','bayno_file_results_v2','bayno_exceptions_v2'])counts[topic]=Number((await pool.query(`SELECT count(*) n FROM public.${topic} WHERE run_id=$1`,[id])).rows[0].n);
   const verified=run.generation_status==='COMPLETED'&&files.length===run.file_count&&files.every(f=>f.delivery_status==='RECONCILED'&&f.pg_match&&f.sftp_match&&f.duplicates===0&&f.evidence.dlq?.clean&&f.evidence.ingestion?.sha256===f.file_id);
   const cadence=name==='timed'?files.slice(1).map((f,i)=>(new Date(f.generated_at)-new Date(files[i].generated_at))/1000):[];
   report.cases[name]={run,verified,statuses,counts,generatedIntervalSeconds:cadence,fileIds:files.map(f=>f.file_id)};complete&&=verified;
   console.log(name,run.generated_count+'/'+run.file_count,JSON.stringify(statuses));
  }
  if(complete){
   await writeFile(new URL('../../bayno-demo/consolidated/ACCEPTANCE.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log('All acceptance runs verified at both destinations.');break;
  }
  if(attempt===31)throw Error('Acceptance did not finish within the observation window.');
  await new Promise(r=>setTimeout(r,15000));
 }
}finally{await pool.end();}
