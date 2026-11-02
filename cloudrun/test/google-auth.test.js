import {test} from 'node:test';import assert from 'node:assert/strict';
import {GoogleSignIn,allowedIdentity} from '../google-auth.js';
const claims={sub:'google-subject',email:'person@mile.cloud',hd:'mile.cloud',email_verified:true,name:'Person'};
const config={clientId:'client.apps.googleusercontent.com',origin:'https://demo.example',sessionSecret:'test-session-key',domains:['mile.cloud']};
test('only verified Google Workspace identities are allowed',()=>{
 assert.equal(allowedIdentity(claims,['mile.cloud']).email,'person@mile.cloud');
 for(const change of [{hd:undefined},{hd:'gmail.com'},{email:'person@gmail.com'},{email_verified:false},{email_verified:'true'},{sub:''}])assert.throws(()=>allowedIdentity({...claims,...change},['mile.cloud']));
});
test('configuration binds a nonce and CSRF challenge in a signed HttpOnly cookie',()=>{
 const a=new GoogleSignIn(config),flow=a.begin();assert.equal(flow.clientId,config.clientId);assert.ok(flow.nonce);assert.ok(flow.csrfToken);assert.match(flow.cookie,/HttpOnly; SameSite=Strict; Max-Age=600; Secure/);assert.equal(flow.clientSecret,undefined);
 const raw=flow.cookie.split(';')[0].split('=')[1];assert.equal(a.unseal(raw).nonce,flow.nonce);
});
test('missing/tampered/expired state and wrong CSRF fail before token verification',async()=>{
 let verified=0;const a=new GoogleSignIn({...config,client:{verifyIdToken:async()=>{verified++;}}}),flow=a.begin(),body={credential:'token',csrfToken:flow.csrfToken};
 await assert.rejects(a.finish(body,''));await assert.rejects(a.finish(body,flow.cookie.replace('=','=tampered')));
 await assert.rejects(a.finish(body,a.cookie(a.seal({state:flow.csrfToken,nonce:flow.nonce,exp:0}))));await assert.rejects(a.finish({...body,csrfToken:'wrong'},flow.cookie));assert.equal(verified,0);
});
test('valid Google token verifies audience and nonce without retaining provider credentials',async()=>{
 let nonce,verification;
 const a=new GoogleSignIn({...config,client:{verifyIdToken:async args=>{verification=args;return{getPayload:()=>({...claims,nonce})};}}}),flow=a.begin();nonce=flow.nonce;
 const identity=await a.finish({credential:'google-token',csrfToken:flow.csrfToken},flow.cookie);assert.equal(verification.audience,config.clientId);assert.equal(verification.idToken,'google-token');assert.deepEqual(identity,{sub:claims.sub,email:claims.email,hd:claims.hd,name:claims.name});
 nonce='wrong';await assert.rejects(a.finish({credential:'google-token',csrfToken:flow.csrfToken},flow.cookie));
});
test('unconfigured Google sign-in fails closed',()=>assert.throws(()=>new GoogleSignIn({sessionSecret:'s'}).begin()));

test('Google SDK rejects forged signatures, audience, issuer and expiry',async()=>{
 const {OAuth2Client}=await import('google-auth-library');const {generateKeyPairSync,sign}=await import('node:crypto');
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const certs={test:publicKey.export({type:'spki',format:'pem'})};
 const client=new OAuth2Client();const now=Math.floor(Date.now()/1000);
 const token=patch=>{const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');const p=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',sub:'subject',aud:config.clientId,iat:now,exp:now+3600,...patch})).toString('base64url');return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');};
 const verify=jwt=>client.verifySignedJwtWithCertsAsync(jwt,certs,config.clientId,['https://accounts.google.com']);
 assert.equal((await verify(token({}))).getPayload().sub,'subject');
 await assert.rejects(verify(token({aud:'other-client'})));await assert.rejects(verify(token({iss:'https://attacker.example'})));await assert.rejects(verify(token({iat:now-7200,exp:now-3600})));
 const valid=token({});const parts=valid.split('.');parts[2]=Buffer.alloc(256).toString('base64url');await assert.rejects(verify(parts.join('.')));
});
