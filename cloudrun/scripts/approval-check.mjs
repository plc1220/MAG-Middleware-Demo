// Administrative synthetic session fixture; this is not a Google sign-in acceptance test.
import {execFileSync} from 'node:child_process';import {createHmac,randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
const base='https://mag-bayno-site-452883396851.asia-southeast1.run.app';
const secret=execFileSync('gcloud',['secrets','versions','access','latest','--secret=mag-bayno-site-session-secret','--project=my-rd-coe-demo-gen-ai'],{encoding:'utf8'});
const sid='approval-acceptance';
const sign=(purpose,data)=>{const p=Buffer.from(JSON.stringify(data)).toString('base64url');return p+'.'+createHmac('sha256',secret).update(purpose+'.'+p).digest('base64url');};
const cookie='__Host-mag_bayno_session='+sign('session',{sid,authVersion:2,sub:'synthetic-operator-test',email:'acceptance-test@mile.cloud',hd:'mile.cloud',exp:Date.now()+3600000});
async function approve(token){const r=await fetch(base+'/api/approve',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({approvalToken:token})});return [r.status,await r.json()];}
const action={type:'stop_demo',run_id:'013efffd-e052-4dc1-a2da-84a3177e0986'};
const token=sign('action',{action,sessionId:sid,exp:Date.now()+300000,nonce:randomUUID()});
const a=await approve(token),b=await approve(token);assert.equal(a[0],200);assert.deepEqual(a,b);console.log('Stop card retry: same persisted result, no repeated execution.');
const wrong=await approve(sign('action',{action,sessionId:'other',exp:Date.now()+300000,nonce:randomUUID()}));assert.notEqual(wrong[0],200);
const expired=await approve(sign('action',{action,sessionId:sid,exp:Date.now()-1,nonce:randomUUID()}));assert.notEqual(expired[0],200);console.log('Wrong session and expired cards rejected:',wrong[0],expired[0]);
const res=await fetch(base+'/api/chat',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',text:'Prepare a start demo action card for one valid file with 20 details. Do not execute it.'}]})});
const d=await res.json();assert.equal(d.pendingAction?.type,'start_demo');assert.equal(d.pendingAction.settings.file_count,1);console.log('Actual agent prepared scoped start card; no start executed.');
