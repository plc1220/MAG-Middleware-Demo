import {once} from 'node:events';

export async function streamChat(req,res,headers,run,{timeoutMs=150000,onError=()=>{}}={}) {
  const controller=new AbortController();let timedOut=false;
  const disconnected=()=>controller.abort();
  res.on('close',disconnected);
  res.writeHead(200,{...headers,'content-type':'text/event-stream; charset=utf-8','x-accel-buffering':'no'});
  res.flushHeaders();
  const emit=async(type,data)=>{
    controller.signal.throwIfAborted();
    if(!res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`))await once(res,'drain',{signal:controller.signal});
  };
  const heartbeat=setInterval(()=>{if(!res.destroyed&&res.writableLength<65536)res.write(': heartbeat\n\n');},15000);
  const deadline=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  try {
    await emit('status',{phase:'connecting',label:'Connecting to live sources'});
    const result=await run(emit,controller.signal);
    await emit('done',result);
  } catch(error) {
    if(!res.destroyed) {
      onError(error);
      res.write(`event: error\ndata: ${JSON.stringify({error:timedOut?'The response timed out. Please try a narrower question.':'The reply was interrupted. Please try again.',retryable:true})}\n\n`);
    }
  } finally {
    clearInterval(heartbeat);clearTimeout(deadline);
    res.off('close',disconnected);
    if(!res.destroyed)res.end();
  }
}
