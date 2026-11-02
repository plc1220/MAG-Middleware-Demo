// Administrative synthetic session fixture; this is not a Google sign-in acceptance test.
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const base='https://mag-bayno-site-452883396851.asia-southeast1.run.app';
const secret=execFileSync('gcloud',['secrets','versions','access','latest','--secret=mag-bayno-site-session-secret','--project=my-rd-coe-demo-gen-ai'],{encoding:'utf8'});
const payload=Buffer.from(JSON.stringify({sid:'implementation-acceptance',authVersion:2,sub:'synthetic-operator-test',email:'acceptance-test@mile.cloud',hd:'mile.cloud',exp:Date.now()+3600000})).toString('base64url');
const cookie=`__Host-mag_bayno_session=${payload}.${createHmac('sha256',secret).update('session.'+payload).digest('base64url')}`;
async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie,origin:base,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(r.status+' '+JSON.stringify(d));return d;}
const unauthorized=await fetch(base+'/api/demo/runs');console.log('Unauthenticated API:',unauthorized.status);
const runs=await api('/api/demo/runs');console.log('Worker heartbeats:',runs.workers);
let id=process.argv[2];
if(id==='chat'){const d=await api('/api/chat',{messages:[{role:'user',text:'Use your live tools to list recent demo runs and explain the most recent run reconciliation. Do not propose or execute any changes.'}]});console.log('Agent live response:',d.answer);process.exit(0);}
if(id==='stop'){const r=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../infra/private/acceptance-run.json',import.meta.url),'utf8'));console.log(await api('/api/demo/runs/'+r.id+'/stop',{}));process.exit(0);}
if(id==='start'){
 const key=randomUUID();const run=await api('/api/demo/runs',{scenario:'sequence',file_count:10,detail_count:20,idempotency_key:key});
 const replay=await api('/api/demo/runs',{scenario:'sequence',file_count:10,detail_count:20,idempotency_key:key});
 if(run.run.id!==replay.run.id)throw Error('Idempotency failed');id=run.run.id;
 await writeFile(new URL('../../infra/private/acceptance-run.json',import.meta.url),JSON.stringify({id,key}),{mode:0o600});console.log('Ten-file acceptance run:',id);
}
if(id){console.log(JSON.stringify(await api('/api/demo/runs/'+id)));const f=await api('/api/demo/runs/'+id+'/files');console.log('Files:',f.rows.map(x=>({ordinal:x.ordinal,processing:x.processing_status,delivery:x.delivery_status,pg:x.pg_match,sftp:x.sftp_match,duplicates:x.duplicates,dlq:x.evidence?.dlq}))); }
const health=await api('/api/overview');console.log('Connectors:',health.connectors);console.log('v2 jobs:',health.statements.filter(s=>s.name.startsWith('mag-bayno-demo-v2')));
