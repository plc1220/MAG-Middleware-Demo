const error = document.querySelector('#login-error');
const loading = document.querySelector('#login-loading');
async function setupGoogleSignIn() {
  try {
    const response = await fetch('/api/auth/config');
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || 'Sign-in is unavailable.');
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    await new Promise((resolve, reject) => {script.onload=resolve;script.onerror=()=>reject(new Error('Google sign-in could not load. Refresh to retry.'));document.head.append(script);});
    google.accounts.id.initialize({client_id:config.clientId,nonce:config.nonce,hd:'mile.cloud',auto_select:false,callback:async result=>{
      error.textContent=''; loading.textContent='Signing in…';
      try {
        const response=await fetch('/api/auth/google',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:result.credential,csrfToken:config.csrfToken})});
        const payload=await response.json();
        if(!response.ok)throw new Error(payload.error||'Google sign-in failed.');
        window.location.assign('/');
      } catch(cause) {error.textContent=cause.message;loading.textContent='Refresh the page to try again.';}
    }});
    google.accounts.id.renderButton(document.querySelector('#google-signin'),{type:'standard',theme:'outline',size:'large',text:'continue_with',width:Math.min(360,document.querySelector('#google-signin').clientWidth)});
    loading.textContent='';
  } catch(cause) {error.textContent=cause.message;loading.textContent='';}
}
setupGoogleSignIn();
