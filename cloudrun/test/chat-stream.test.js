import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {runAgent} from '../chat-engine.js';
import {streamChat} from '../chat-http.js';
import {consumeChatEvents} from '../public/chat-events.js';
import {formatChatText} from '../public/chat-format.js';

const chunk=parts=>({candidates:[{content:{role:'model',parts}}]});
const redact=text=>text.replace(/(api_key:\s*)\S+/g,'$1[redacted]').replace(/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/g,'$1[redacted]@');
const defaults={model:'test-model',systemInstruction:'test',functions:[],contents:[],redact};

test('streams public text before completion and preserves server-only thought signatures across tools',async()=>{
  const events=[],requests=[];let generation=0,toolExecuted=false;
  const result=await runAgent({...defaults,contents:[],emit:async(type,data)=>{events.push({type,data});},
    generate:async options=>{
      requests.push(structuredClone(options));const round=generation++;
      return(async function*(){
        if(!round){yield chunk([{text:'PRIVATE_REASONING',thought:true,thoughtSignature:'OPAQUE_SIGNATURE'},{functionCall:{id:'c1',name:'app_list_runs',args:{secret:'TOOL_ARGS_PRIVATE'}}}]);}
        else {yield chunk([{text:'The pipeline '}]);assert.ok(events.some(e=>e.type==='answer'),'answer must be delivered before the stream ends');yield chunk([{text:'is healthy.'}]);}
      })();
    },execute:async()=>{toolExecuted=true;return {runs:[]};},
  });
  assert.equal(result.answer,'The pipeline is healthy.');assert.ok(toolExecuted);
  assert.deepEqual(events.filter(e=>e.type.startsWith('tool_')).map(e=>e.type),['tool_start','tool_end']);
  assert.ok(requests[1].contents.some(c=>c.parts.some(p=>p.thoughtSignature==='OPAQUE_SIGNATURE')));
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_REASONING|OPAQUE_SIGNATURE|TOOL_ARGS_PRIVATE/);
});

test('redacts credentials split across provider chunks in every published snapshot',async()=>{
  const events=[];
  const result=await runAgent({...defaults,contents:[],emit:async(type,data)=>events.push({type,data}),execute:async()=>({}),
    generate:async()=> (async function*(){for(const text of ['Result: api_','key: abc','XYZ ','and https://user:','pass','@example.com/ done'])yield chunk([{text}]);})(),
  });
  assert.doesNotMatch(JSON.stringify(events),/abc|XYZ|user:|pass@/);
  assert.match(result.answer,/api_key: \[redacted\]/);
  assert.match(result.answer,/https:\/\/\[redacted\]@example.com/);
});

test('tool errors are visible as failures; cancellation prevents subsequent execution',async()=>{
  const events=[];let round=0;
  await runAgent({...defaults,contents:[],emit:async(type,data)=>events.push({type,data}),execute:async()=>{throw Error('unavailable');},
    generate:async()=> (async function*(){yield chunk(round++?[{text:'The source is unavailable.'}]:[{functionCall:{name:'app_list_runs'}}]);})(),
  });
  assert.equal(events.find(e=>e.type==='tool_end').data.status,'error');
  const controller=new AbortController();let executed=false;
  await assert.rejects(runAgent({...defaults,contents:[],signal:controller.signal,emit:async(type)=>{if(type==='tool_start')controller.abort();},
    generate:async()=> (async function*(){yield chunk([{functionCall:{name:'app_list_runs'}}]);})(),execute:async()=>{executed=true;return{};},
  }),{name:'AbortError'});
  assert.equal(executed,false);
});

test('parser handles byte-split UTF-8/CRLF and refuses errors or truncated completion',async()=>{
  const source=': heartbeat\r\n\r\nevent: answer\r\ndata: {"text":"Ready ✓"}\r\n\r\nevent: done\r\ndata: {"answer":"Ready ✓"}\r\n\r\n';
  const bytes=new TextEncoder().encode(source),events=[];
  const response=new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}}),{headers:{'content-type':'text/event-stream'}});
  await consumeChatEvents(response,(type,data)=>events.push({type,data}));
  assert.equal(events[0].data.text,'Ready ✓');assert.equal(events[1].type,'done');
  const sse=text=>new Response(text,{headers:{'content-type':'text/event-stream'}});
  await assert.rejects(consumeChatEvents(sse('event: answer\ndata: {"text":"Partial"}\n\n'),()=>{}),/before the reply finished/);
  await assert.rejects(consumeChatEvents(sse('event: error\ndata: {"error":"Provider unavailable"}\n\n'),()=>{}),/Provider unavailable/);
  await assert.rejects(consumeChatEvents(sse('event: answer\ndata: broken\n\n'),()=>{}),/malformed/);
});

test('HTTP stream flushes early, emits approvals and completion, and cleans up disconnected work',async()=>{
  let disconnectResolved;const disconnected=new Promise(resolve=>{disconnectResolved=resolve;});
  const server=createServer((req,res)=>{void streamChat(req,res,{},async(emit,signal)=>{
    if(req.url==='/disconnect'){await new Promise(resolve=>{signal.addEventListener('abort',resolve,{once:true});});disconnectResolved();signal.throwIfAborted();}
    if(req.url==='/error')throw Error('CREDENTIAL_MUST_NOT_LEAK');
    if(req.url==='/timeout'){await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));signal.throwIfAborted();}
    await emit('answer',{text:'First words'});
    await emit('approval',{pendingAction:{type:'start_demo',token:'signed-test-card'}});
    return {answer:'First words',pendingAction:{type:'start_demo',token:'signed-test-card'}};
  },{timeoutMs:req.url==='/timeout'?20:2000});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const response=await fetch(base),events=[];
    assert.match(response.headers.get('content-type'),/event-stream/);
    await consumeChatEvents(response,(type,data)=>events.push({type,data}));
    assert.deepEqual(events.map(e=>e.type),['status','answer','approval','done']);
    const failed=await(await fetch(base+'/error')).text();assert.match(failed,/event: error/);assert.doesNotMatch(failed,/CREDENTIAL_MUST_NOT_LEAK|event: done/);
    const timeout=await(await fetch(base+'/timeout')).text();assert.match(timeout,/timed out/);assert.doesNotMatch(timeout,/event: done/);
    const controller=new AbortController();const open=await fetch(base+'/disconnect',{signal:controller.signal});const reader=open.body.getReader();await reader.read();controller.abort();
    await Promise.race([disconnected,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Server did not cancel disconnected work')),1000);timer.unref();})]);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('Markdown supports tool answers while escaping model HTML and code',()=>{
  const html=formatChatText('## Status\n- **Healthy** `source`\n\n| Job | Status |\n| --- | --- |\n| A | RUNNING |\n<script>alert(1)</script>\n```sql\nSELECT 1 < 2;\n```');
  assert.match(html,/<h4>Status<\/h4>/);assert.match(html,/<ul>/);assert.match(html,/<table>/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/SELECT 1 &lt; 2/);
});
