// Shared by the browser and transport tests. Frames may span arbitrary UTF-8 chunks.
export async function consumeChatEvents(response,onEvent) {
  if(!response.ok) {
    const payload=await response.json().catch(()=>({}));
    throw new Error(payload.error||`Request failed (${response.status}).`);
  }
  if(!response.headers.get('content-type')?.includes('text/event-stream')||!response.body)throw new Error('The server did not open a reply stream. Refresh and try again.');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',done=false,ended=false;
  try {
    while(true) {
      const part=await reader.read();
      buffer+=decoder.decode(part.value,{stream:!part.done});
      if(buffer.length>131072)throw new Error('The reply stream exceeded its size limit.');
      let match;
      while((match=/\r?\n\r?\n/.exec(buffer))) {
        const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);
        let type='message';const data=[];
        for(const line of frame.split(/\r?\n/)) {
          if(line.startsWith('event:'))type=line.slice(6).trim();
          if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));
        }
        if(!data.length)continue;
        let payload;try{payload=JSON.parse(data.join('\n'));}catch{throw new Error('The reply stream was malformed. Please try again.');}
        if(type==='error')throw new Error(payload.error||'The reply was interrupted.');
        await onEvent(type,payload);
        if(type==='done')done=true;
      }
      if(part.done){ended=true;break;}
    }
    if(!done||buffer.trim())throw new Error('The connection ended before the reply finished. Please try again.');
  } finally {
    if(!ended)await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}
