// Operator-only synthetic session: exercises API rate isolation, not Google login.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';

const base='https://mag-bayno-site-452883396851.asia-southeast1.run.app';
const secret=execFileSync('gcloud',['secrets','versions','access','latest','--secret=mag-bayno-site-session-secret','--project=my-rd-coe-demo-gen-ai'],{encoding:'utf8'});
const payload=Buffer.from(JSON.stringify({sid:randomUUID(),authVersion:2,sub:'synthetic-operator-test',email:'acceptance-test@mile.cloud',hd:'mile.cloud',exp:Date.now()+600000})).toString('base64url');
const cookie=`__Host-mag_bayno_session=${payload}.${createHmac('sha256',secret).update('session.'+payload).digest('base64url')}`;
for(let i=0;i<40;i++){
  const r=await fetch(base+'/api/session',{headers:{cookie}});
  assert.equal(r.status,200,`Polling request ${i+1}`);
  await r.arrayBuffer();
}
console.log('40 authenticated reads accepted.');
const r=await fetch(base+'/api/chat',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',text:'Use live tools to report current BAYNO connector and active Flink job health. Do not propose any changes.'}]}),signal:AbortSignal.timeout(150000)});
const body=await r.json();
assert.equal(r.status,200,JSON.stringify(body));
assert.ok(body.answer?.trim());
assert.equal(body.pendingAction,null);
console.log('Chat after polling:',r.status,'Model:',body.model,'Answer:',body.answer);
