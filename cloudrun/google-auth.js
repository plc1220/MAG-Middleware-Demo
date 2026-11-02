import {createHmac, timingSafeEqual, randomBytes} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';

const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};
export function allowedIdentity(payload, domains) {
  if(!payload || typeof payload.sub!=='string' || !payload.sub || payload.email_verified!==true || typeof payload.email!=='string') throw fail('A verified Google account is required.',403);
  // Google Workspace ownership is attested by hd, not merely the email suffix.
  const email=payload.email.toLowerCase(),domain=email.split('@')[1];
  if(!domains.includes(payload.hd)||domain!==payload.hd)throw fail('Use your mile.cloud Google Workspace account.',403);
  return {sub:payload.sub,email,hd:payload.hd,name:typeof payload.name==='string'?payload.name.slice(0,160):''};
}
export class GoogleSignIn {
  constructor({clientId,origin,sessionSecret,domains=['mile.cloud'],clock=()=>Date.now(),client}={}) {
    this.clientId=clientId;this.origin=origin;this.secret=sessionSecret;this.domains=domains;this.clock=clock;
    this.client=client || new OAuth2Client(clientId);
    this.cookieName=origin?.startsWith('https:')?'__Host-mag_bayno_oauth':'mag_bayno_oauth';
  }
  assertConfigured(){
    if(!this.clientId||!this.origin||!this.secret)throw fail('Google sign-in is not configured.',503);
    const url=new URL(this.origin);
    if(url.origin!==this.origin||(!this.origin.startsWith('https://')&&url.hostname!=='localhost'))throw fail('Invalid Google sign-in origin.',503);
  }
  cookie(value,maxAge=600){return `${this.cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.origin?.startsWith('https:')?'; Secure':''}`;}
  seal(data){const body=Buffer.from(JSON.stringify(data)).toString('base64url');return body+'.'+createHmac('sha256',this.secret).update('google-oauth.'+body).digest('base64url');}
  unseal(raw){
    if(typeof raw!=='string'||raw.length>4096)throw fail('Google sign-in expired. Please try again.');
    const [p,s,extra]=raw.split('.');if(!p||!s||extra||!equal(s,createHmac('sha256',this.secret).update('google-oauth.'+p).digest('base64url')))throw fail('Invalid Google sign-in state.');
    let data;try{data=JSON.parse(Buffer.from(p,'base64url').toString());}catch{throw fail('Invalid Google sign-in state.');}
    if(!Number.isFinite(data.exp)||data.exp<this.clock())throw fail('Google sign-in expired. Please try again.');
    return data;
  }
  begin(){
    this.assertConfigured();
    const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url');
    return {clientId:this.clientId,nonce,csrfToken:state,cookie:this.cookie(this.seal({state,nonce,exp:this.clock()+600000}))};
  }
  async finish(body,cookieHeader){
    this.assertConfigured();
    const raw=String(cookieHeader||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(this.cookieName+'='))?.slice(this.cookieName.length+1);
    const pending=this.unseal(raw);
    if(!equal(pending.state,body.csrfToken)||typeof body.credential!=='string'||body.credential.length>12000)throw fail('Google sign-in state was invalid.');
    const ticket=await this.client.verifyIdToken({idToken:body.credential,audience:this.clientId});
    const payload=ticket.getPayload();
    if(!equal(payload?.nonce,pending.nonce))throw fail('Google sign-in nonce did not match.');
    return allowedIdentity(payload,this.domains);
  }
}
