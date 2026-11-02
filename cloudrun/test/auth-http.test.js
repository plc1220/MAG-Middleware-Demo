import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createHmac,randomUUID} from 'node:crypto';import net from 'node:net';import {fileURLToPath} from 'node:url';
test('HTTP auth removes passwords, rejects legacy sessions and protects Google token exchange',async()=>{
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const origin=`http://localhost:${port}`,secret='http-test-session-key';
 const server=spawn(process.execPath,['server.js'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,NODE_ENV:'test',PORT:String(port),SITE_SESSION_SECRET:secret,GOOGLE_OAUTH_CLIENT_ID:'test-client.apps.googleusercontent.com',PUBLIC_ORIGIN:origin,BAYNO_DB_HOST:''},stdio:'pipe'});
 let startupError='';server.stderr.on('data',data=>{startupError=(startupError+data).slice(-4000);});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server did not start: '+startupError)),10000);server.stdout.on('data',d=>{if(String(d).includes('MAG BAYNO')){clearTimeout(timer);resolve();}});server.on('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+startupError));});});
  const request=(path,options={})=>fetch(origin+path,{redirect:'manual',...options});
  const signed=data=>{const p=Buffer.from(JSON.stringify(data)).toString('base64url');return'mag_bayno_session='+p+'.'+createHmac('sha256',secret).update('session.'+p).digest('base64url');};
  assert.equal((await request('/api/demo/runs')).status,401);
  const login=await request('/login');const html=await login.text();assert.match(html,/Sign in with Google/);assert.doesNotMatch(html,/type="password"/);
  assert.equal(login.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
  assert.equal((await request('/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{"password":"old-shared-password"}'})).status,401);
  const oldCookie=signed({sid:randomUUID(),exp:Date.now()+3600000});assert.equal((await request('/api/session',{headers:{cookie:oldCookie}})).status,401);
  const foreign=signed({sid:randomUUID(),authVersion:2,sub:'test',hd:'gmail.com',email:'test@gmail.com',exp:Date.now()+3600000});assert.equal((await request('/api/session',{headers:{cookie:foreign}})).status,401);
  const session=signed({sid:randomUUID(),authVersion:2,sub:'test',hd:'mile.cloud',email:'test@mile.cloud',exp:Date.now()+3600000});assert.equal((await request('/api/session',{headers:{cookie:session}})).status,200);
  const flow=await request('/api/auth/config');assert.equal(flow.status,200);const config=await flow.json();assert.equal(config.clientId,'test-client.apps.googleusercontent.com');assert.ok(config.csrfToken);assert.ok(config.nonce);assert.equal(config.clientSecret,undefined);assert.match(flow.headers.get('set-cookie'),/SameSite=Strict/);
  const invalid=await request('/api/auth/google',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});assert.equal(invalid.status,400);assert.match(invalid.headers.get('set-cookie'),/Max-Age=0/);
  const csrf=await request('/api/auth/google',{method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},body:'{}'});assert.equal(csrf.status,403);
  assert.equal((await request('/api/chat',{method:'POST',headers:{accept:'text/event-stream',origin,'content-type':'application/json'},body:'{}'})).status,401);
  assert.equal((await request('/api/chat',{method:'POST',headers:{cookie:session,accept:'text/event-stream',origin:'https://attacker.example','content-type':'application/json'},body:'{}'})).status,403);
  // Saturate dashboard reads, then prove chat has its own bounded allowance.
  for(let i=1;i<180;i++)assert.equal((await request('/api/session',{headers:{cookie:session}})).status,200);
  const readsLimited=await request('/api/session',{headers:{cookie:session}});assert.equal(readsLimited.status,429);assert.equal(readsLimited.headers.get('retry-after'),'60');
  const chat=()=>request('/api/chat',{method:'POST',headers:{cookie:session,origin,'content-type':'application/json'},body:'{}'});
  for(let i=0;i<24;i++)assert.equal((await chat()).status,400); // Reaches input validation, without calling a provider.
  assert.equal((await chat()).status,429);
  assert.equal((await request('/api/not-found',{method:'POST',headers:{cookie:session,origin,'content-type':'application/json'},body:'{}'})).status,404);
  const logout=await request('/api/logout',{method:'POST',headers:{cookie:session,origin}});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 }finally{if(server.exitCode===null&&server.signalCode===null){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await exited;}}
});
