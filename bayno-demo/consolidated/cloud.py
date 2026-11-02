"""Confluent REST client. Credentials stay in memory; never print request headers/config secrets."""
import base64,json,pathlib,subprocess,urllib.request,urllib.error,urllib.parse
PROJECT='my-rd-coe-demo-gen-ai'; ENV='env-pozpjk';CLUSTER='lkc-pg690ym'
def secret(name):return subprocess.check_output(['gcloud','secrets','versions','access','latest','--secret='+name,'--project='+PROJECT],text=True).strip()
def auth():
    import os
    if os.environ.get("BAYNO_USE_MCP_KEY"): return secret("mag-bayno-confluent-mcp-auth").split(":",1)
    raw=secret('mag-bayno-confluent-connect-auth')
    if raw.startswith('{'):
        d=json.loads(raw);return d.get('api_key',d.get('key')),d.get('api_secret',d.get('secret'))
    if ':' in raw and '\n' not in raw:return raw.split(':',1)
    lines=raw.splitlines()
    return lines[lines.index('API key:')+1],lines[lines.index('API secret:')+1]
def request(path,method='GET',data=None):
    target=('https://api.confluent.cloud'+path if path.startswith('/') else path)
    if urllib.parse.urlsplit(target).scheme!='https' or urllib.parse.urlsplit(target).hostname!='api.confluent.cloud':raise RuntimeError('Unexpected Confluent API pagination host')
    key,pwd=auth();req=urllib.request.Request(('https://api.confluent.cloud'+path if path.startswith('/') else path),method=method,headers={'Authorization':'Basic '+base64.b64encode(f'{key}:{pwd}'.encode()).decode(),'Content-Type':'application/json'},data=json.dumps(data).encode() if data is not None else None)
    try:
        with urllib.request.urlopen(req,timeout=60) as r:return json.load(r) if r.status!=204 else {}
    except urllib.error.HTTPError as e:
        # Error bodies can echo connector credentials; report only status and route.
        raise RuntimeError(f'Confluent {method} {path}: HTTP {e.code}') from None
if __name__=='__main__':
    p=f'/connect/v1/environments/{ENV}/clusters/{CLUSTER}/connectors'
    d=request(p);print('REST access available; connectors:',list(d) if isinstance(d,dict) else d)

def list_all(path):
    values=[]
    while path:
        page=request(path);values.extend(page["data"]);path=page.get("metadata",{}).get("next")
    return values
