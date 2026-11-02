// Operator synthetic session, independent of the real browser Google sign-in.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {consumeChatEvents} from '../public/chat-events.js';

const base='https://mag-bayno-site-452883396851.asia-southeast1.run.app';
const secret=execFileSync('gcloud',['secrets','versions','access','latest','--secret=mag-bayno-site-session-secret','--project=my-rd-coe-demo-gen-ai'],{encoding:'utf8'});
const payload=Buffer.from(JSON.stringify({sid:randomUUID(),authVersion:2,sub:'synthetic-stream-test',email:'acceptance-test@mile.cloud',hd:'mile.cloud',exp:Date.now()+600000})).toString('base64url');
const cookie=`__Host-mag_bayno_session=${payload}.${createHmac('sha256',secret).update('session.'+payload).digest('base64url')}`;
const started=Date.now(),events=[];
const response=await fetch(base+'/api/chat',{method:'POST',headers:{cookie,origin:base,accept:'text/event-stream','content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',text:'Use live tools to check the three BAYNO v2 connectors and the three active Flink jobs. Give a concise health summary. Do not propose or execute changes.'}]}),signal:AbortSignal.timeout(160000)});
await consumeChatEvents(response,(type,data)=>{
  const ms=Date.now()-started;events.push({type,data,ms});
  console.log(ms+'ms',type,type==='answer'?`${data.text.length} public characters`:type==='tool_start'?`${data.source}: ${data.label}`:type==='tool_end'?data.status:type==='status'?data.label:'');
});
assert.equal(events[0].type,'status');
assert.ok(events.some(e=>e.type==='tool_start'));
assert.ok(events.filter(e=>e.type==='answer').length>1,'Expected progressive public-answer snapshots');
assert.equal(events.at(-1).type,'done');
assert.ok(events.at(-1).data.answer.trim());
assert.equal(events.at(-1).data.pendingAction,null);
assert.equal(events.filter(e=>e.type==='tool_start').length,events.filter(e=>e.type==='tool_end').length);
console.log('Live stream complete:',events.at(-1).data.answer);
