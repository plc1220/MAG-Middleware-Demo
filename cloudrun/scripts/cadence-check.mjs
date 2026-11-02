// Read-only acceptance monitor. Start a real default run through the dashboard first.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';

const base='https://mag-bayno-site-452883396851.asia-southeast1.run.app';
const secret=execFileSync('gcloud',['secrets','versions','access','latest','--secret=mag-bayno-site-session-secret','--project=my-rd-coe-demo-gen-ai'],{encoding:'utf8'});
const payload=Buffer.from(JSON.stringify({sid:randomUUID(),authVersion:2,sub:'synthetic-cadence-observer',email:'acceptance-test@mile.cloud',hd:'mile.cloud',exp:Date.now()+900000})).toString('base64url');
const cookie=`__Host-mag_bayno_session=${payload}.${createHmac('sha256',secret).update('session.'+payload).digest('base64url')}`;
async function api(path){const r=await fetch(base+path,{headers:{cookie},signal:AbortSignal.timeout(15000)});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
const history=await api('/api/demo/runs');
const selected=process.argv[2]?history.runs.find(r=>r.id===process.argv[2]):history.runs[0];
assert.ok(selected);assert.equal(selected.file_count,30);assert.equal(selected.interval_seconds,10);assert.equal(selected.detail_count,20);assert.equal(selected.scenario,'valid');
console.log('Observing run:',selected.id);
const deadline=Date.now()+600000;
while(Date.now()<deadline){
  const [{run},{rows:files}]=await Promise.all([api('/api/demo/runs/'+selected.id),api('/api/demo/runs/'+selected.id+'/files?limit=100')]);
  console.log(new Date().toISOString(),run.generation_status,`${run.generated_count}/30 generated`,JSON.stringify(run.delivery_totals));
  assert.ok(!['FAILED','STOPPED'].includes(run.generation_status),'Generation did not complete');
  assert.ok(!files.some(f=>f.delivery_status==='MISMATCH'),'Destination mismatch');
  if(run.generation_status==='COMPLETED'&&files.length===30&&files.every(f=>f.delivery_status==='RECONCILED')){
    const stamps=files.map(f=>new Date(f.generated_at).getTime()),gaps=stamps.slice(1).map((t,i)=>(t-stamps[i])/1000);
    const cadence={minSeconds:Math.min(...gaps),maxSeconds:Math.max(...gaps),meanSeconds:gaps.reduce((a,b)=>a+b,0)/gaps.length,firstToLastSeconds:(stamps.at(-1)-stamps[0])/1000,lastFileAfterRunCreatedSeconds:(stamps.at(-1)-new Date(run.created_at).getTime())/1000};
    assert.ok(gaps.every(s=>s>=9&&s<=11),JSON.stringify(cadence));assert.ok(cadence.lastFileAfterRunCreatedSeconds<=301);
    assert.ok(files.every(f=>f.pg_match&&f.sftp_match&&f.duplicates===0&&f.evidence.dlq?.clean));
    const pgRows=files.reduce((n,f)=>n+f.evidence.bayno_processed_v2.pg_count,0),sftpRows=files.reduce((n,f)=>n+f.evidence.bayno_processed_v2.sftp_count,0);
    assert.equal(pgRows,600);assert.equal(sftpRows,600);
    const report={checkedAt:new Date().toISOString(),runId:run.id,fileCount:30,intervalSeconds:10,detailsPerFile:20,generationStatus:run.generation_status,deliveryTotals:run.delivery_totals,pgRows,sftpRows,cadence,files:files.map(f=>({ordinal:f.ordinal,fileId:f.file_id,generatedAt:f.generated_at,deliveryStatus:f.delivery_status,pgMatch:f.pg_match,sftpMatch:f.sftp_match,duplicates:f.duplicates}))};
    await writeFile(new URL('../CADENCE-ACCEPTANCE.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
    console.log('PASS:',JSON.stringify({...report,files:undefined}));process.exit(0);
  }
  await new Promise(resolve=>setTimeout(resolve,15000));
}
throw new Error('Timed out waiting for both destinations to reconcile');
