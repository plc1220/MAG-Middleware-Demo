// Stream public answer text and observable operations. Model thoughts/signatures
// remain server-side and are only carried forward when the provider needs them.
export async function runAgent({generate, model, systemInstruction, functions, contents, execute, redact, emit=async()=>{}, signal, maxRounds=5}) {
  for(let round=0;round<=maxRounds;round++) {
    signal?.throwIfAborted();
    await emit('status',{phase:'working',label:round?'Reviewing the observed results':'Preparing the response',round});
    signal?.throwIfAborted();
    const stream=await generate({model,contents,config:{systemInstruction,tools:[{functionDeclarations:functions}],toolConfig:{functionCallingConfig:{mode:round===maxRounds?'NONE':'AUTO'}},maxOutputTokens:1500,abortSignal:signal}});
    const parts=[];let raw='',published='';
    for await(const chunk of stream) {
      signal?.throwIfAborted();
      for(const part of chunk.candidates?.[0]?.content?.parts||[]) {
        parts.push(part);
        if(typeof part.text==='string'&&!part.thought)raw+=part.text;
      }
      // Keep the unfinished last word private: credentials/URLs split across
      // provider chunks must reach redaction as a complete token.
      const boundary=raw.search(/\S+$/);
      const safe=redact(boundary<0?raw:raw.slice(0,boundary)).slice(0,8000);
      if(safe&&safe!==published){published=safe;await emit('answer',{text:safe,round});}
    }
    const calls=parts.filter(p=>p.functionCall).map(p=>p.functionCall);
    if(!calls.length) {
      const answer=redact(raw).slice(0,8000);
      if(!answer.trim())throw new Error('The provider returned no public answer.');
      if(answer!==published)await emit('answer',{text:answer,round});
      return {answer,model};
    }
    contents.push({role:'model',parts});
    const responses=[];
    for(let index=0;index<calls.length;index++) {
      signal?.throwIfAborted();
      const call=calls[index],id=`${round}-${index}`,started=Date.now();
      const operation=describeOperation(call.name);
      await emit('tool_start',{id,...operation,observedAt:new Date().toISOString()});
      signal?.throwIfAborted();
      let result;
      try {result=await execute(call);} catch(error) {
        if(signal?.aborted)throw error;
        result={error:redact(error?.message||'Tool call failed.').slice(0,1200)};
      }
      signal?.throwIfAborted();
      await emit('tool_end',{id,status:result?.error?'error':'complete',durationMs:Date.now()-started,observedAt:new Date().toISOString()});
      responses.push({functionResponse:{id:call.id,name:call.name,response:result}});
    }
    contents.push({role:'user',parts:responses});
  }
  const answer='I reached the tool-call limit for this message. Please narrow the question and try again.';
  await emit('answer',{text:answer,round:maxRounds+1});
  return {answer,model};
}

function describeOperation(name='') {
  const match=/^mcp_(global|regional)_(.+)$/.exec(name);
  if(match)return {label:match[2].replaceAll('_',' ').slice(0,100),source:match[1]==='global'?'Confluent Global MCP':'Confluent Singapore MCP'};
  const labels={app_list_runs:'Read recent demo runs',app_run_progress:'Check destination reconciliation',propose_start_demo:'Prepare start approval',propose_stop_demo:'Prepare stop approval',propose_create_flink_statement:'Validate Flink proposal',propose_delete_flink_statement:'Prepare statement approval'};
  return {label:labels[name]||'Check available operation',source:name.startsWith('propose_')?'Approval controls':'BAYNO audit database'};
}
