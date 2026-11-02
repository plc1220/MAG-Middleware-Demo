/* Durable demo control; no client-side generation or simulated progress. */
(() => {
  const root=document.querySelector('#demo-dashboard');
  const esc=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let selected=localStorage.getItem('bayno-run'), page=0, section='files', busy=false, loading=false, healthBusy=false, requestKey=null, lastWorkers=[];
  const consoleRoot='https://confluent.cloud/environments/env-pozpjk/clusters/lkc-pg690ym';
  root.innerHTML=`<div class="demo-heading"><div><p class="eyebrow">BAYNO · LIVE DEMO</p><h1>File to verified delivery.</h1><p>Every incremental file, accounted for at both destinations.</p></div><a href="${consoleRoot}/overview" target="_blank" rel="noopener">Open in Confluent ↗</a></div>
  <form id="demo-start" class="demo-controls card"><label>Scenario<select name="scenario"><option value="valid">Valid files</option><option value="mixed">Detail errors below threshold</option><option value="rejected">Rejected files</option><option value="sequence">Deterministic mixed sequence</option></select></label><label>Files<input name="file_count" type="number" min="1" max="100" value="30" required></label><label>Details per file<input name="detail_count" type="number" min="1" max="1000" value="20" required></label><span>Every 10 seconds · <span id="demo-duration">5 minutes</span></span><button class="demo-primary" type="submit">Start demo</button><button id="demo-stop" type="button" disabled>Stop generation</button></form>
  <p id="demo-error" role="status" class="demo-error"></p><div id="demo-topology" class="demo-topology" aria-label="Pipeline health"></div><p id="demo-health-time" class="demo-caption">Confluent status not fetched.</p>
  <div class="demo-run-bar"><label>Run history<select id="demo-runs"><option value="">Loading runs…</option></select></label><button id="demo-history-older" type="button">Older runs</button><button id="demo-refresh" type="button">Refresh</button><span id="demo-time" class="demo-caption"></span></div>
  <div id="demo-summary" class="demo-summary"></div><div id="demo-tabs" class="demo-tabs" role="tablist">${['files','rows','exceptions','artifacts','events'].map(s=>`<button type="button" role="tab" aria-selected="${s==='files'}" data-section="${s}">${({files:'File timeline',rows:'PostgreSQL rows',exceptions:'Exceptions',artifacts:'SFTP artifacts',events:'Audit events'})[s]}</button>`).join('')}</div><div id="demo-results" class="demo-results card"></div><div class="demo-paging"><button id="demo-prev" type="button">Previous page</button><span id="demo-page"></span><button id="demo-next" type="button">Next page</button></div><p class="demo-caption">SAS-derived demo · 20% detail-error threshold · JSON output uses connector-controlled file boundaries. Connector health does not prove delivery.</p>`;
  const el=id=>document.getElementById(id);
  const api=async(path,options={})=>{
    const r=await fetch(path,{...options,headers:{...(options.body?{'content-type':'application/json'}:{})}});
    const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data;
  };
  function table(rows,keys){return `<div class="demo-table-scroll"><table><thead><tr>${keys.map(k=>`<th>${esc(k.replaceAll('_',' '))}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${keys.map(k=>`<td>${esc(typeof r[k]==='object'?JSON.stringify(r[k]):r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
  function files(rows){return rows.map(f=>`<details class="demo-file" data-identity="${esc(f.file_id)}"><summary><strong>${esc(f.source_file)}</strong><span class="demo-pill">${esc(f.delivery_status)}</span></summary><div class="demo-stages">${[['Generated',!!f.generated_at],['Ingested',f.evidence?.ingestion?.source_archived||['TRANSFORMED','REJECTED'].includes(f.processing_status)],['Validated',['TRANSFORMED','REJECTED'].includes(f.processing_status)],['Transformed',f.processing_status==='TRANSFORMED'],['SFTP',f.sftp_match],['PostgreSQL',f.pg_match],['Reconciled',f.delivery_status==='RECONCILED']].map(([s,ok])=>`<span class="${ok?'done':''}">${ok?'✓':'○'} ${s}</span>`).join('')}</div><p>Scenario: ${esc(f.scenario)} · Processing: ${esc(f.processing_status)} · Duplicates: ${esc(f.duplicates)} · Observed: ${esc(f.checked_at)} ${f.evidence?.overdue?' · DELIVERY OVERDUE':''}</p><pre>${esc(JSON.stringify(f.evidence,null,2))}</pre></details>`).join('');}
  async function refresh(){
    if(loading||root.hidden)return;loading=true;
    try{
      const history=await api('/api/demo/runs?limit=100');
      lastWorkers=history.workers;
      const active=history.runs.find(r=>['QUEUED','RUNNING'].includes(r.generation_status));
      el('demo-start').querySelector('button[type=submit]').disabled=busy||!!active;
      if(!selected)selected=history.runs[0]?.id;
      el('demo-runs').innerHTML='<option value="">Select a run</option>'+history.runs.map(r=>`<option value="${r.id}" ${r.id===selected?'selected':''}>${esc(r.created_at)} · ${esc(r.scenario)} · ${esc(r.generation_status)}</option>`).join('');
      el('demo-stop').disabled=busy||!active||selected!==active.id;
      const stale=history.workers.filter(w=>Date.now()-new Date(w.heartbeat)>45000);
      if(!history.workers.length||stale.length)el('demo-error').textContent='VM worker heartbeat is missing or stale. Run commands remain durable.';
      else el('demo-error').textContent='';
      if(!selected){el('demo-summary').textContent='No runs yet. Start a demo to generate the first file.';el('demo-results').textContent='No live results.';return;}
      const [data,result]=await Promise.all([api(`/api/demo/runs/${selected}`),api(`/api/demo/runs/${selected}/${section}?limit=25&offset=${page*25}`)]);
      const r=data.run;
      el('demo-summary').innerHTML=[['Generation',r.generation_status],['Files generated',`${r.generated_count} / ${r.file_count}`],['Reconciled',r.delivery_totals?.RECONCILED||0],['Pending',r.delivery_totals?.DELIVERY_PENDING||0],['Mismatches',r.delivery_totals?.MISMATCH||0]].map(([label,value])=>`<article class="card"><small>${esc(label)}</small><strong>${esc(value)}</strong></article>`).join('');
      const expanded=new Set([...el('demo-results').querySelectorAll('details[open]')].map(x=>x.dataset.identity));
      const rows=result.rows;
      if(!rows.length)el('demo-results').textContent='No observed records in this page yet.';
      else if(section==='files')el('demo-results').innerHTML=files(rows);
      else if(section==='artifacts')el('demo-results').innerHTML=rows.map(a=>`<details class="demo-file" data-identity="${esc(a.path)}"><summary>${esc(a.path)} · ${esc(a.size)} bytes</summary><p>SHA-256: ${esc(a.sha256)} · observed ${esc(a.observed_at)}</p><pre>${esc(JSON.stringify(a.previews,null,2))}</pre></details>`).join('');
      else el('demo-results').innerHTML=table(rows,section==='rows'?['source_file','carr','flt_nbr','first_leg_flt_dt','sched_dep_tm','dep_airpt','bay_no']:section==='exceptions'?['source_file','line_number','error_code','explanation']:['created_at','stage','file_id','detail']);
      el('demo-results').querySelectorAll('details').forEach(x=>{x.open=expanded.has(x.dataset.identity);});
      el('demo-prev').disabled=page===0;el('demo-next').disabled=rows.length<25;el('demo-page').textContent=`Page ${page+1}`;
      el('demo-time').textContent=`Database / VM evidence · ${new Date(result.checkedAt).toLocaleTimeString()}`;
    }catch(e){el('demo-error').textContent=`Live data unavailable: ${e.message}. Previous observations may be stale.`;}finally{loading=false;}
  }
  async function health(){
    if(root.hidden||document.hidden||healthBusy)return;healthBusy=true;
    try{
      const d=await api('/api/overview');
      const connector=kind=>d.connectors.filter(c=>c.name.startsWith('mag-bayno-demo-v2-')).filter(c=>kind==='source'?c.name.includes('source'):c.name.includes(kind)).map(c=>`${c.name}: ${c.status}`).join(' · ')||'Not found';
      const activeNames=['mag-bayno-demo-v2-10-stage','mag-bayno-demo-v2-14-file-state-complete','mag-bayno-demo-v2-34-route-final'];
      const jobs=activeNames.map(name=>d.statements.find(s=>s.name===name)||{name,status:'NOT FOUND'});
      el('demo-topology').innerHTML=[['VM generator',lastWorkers.some(w=>w.name==='generator'&&Date.now()-new Date(w.heartbeat)<45000)?'Worker heartbeat current':'Worker not observed / stale',''],['SFTP source',connector('source'),`${consoleRoot}/connectors`],['Raw topic',d.topics.includes('bayno_raw_lines')?'bayno_raw_lines':'Not found',`${consoleRoot}/topics/bayno_raw_lines/overview`],['Flink',jobs.length?`${jobs.filter(s=>s.status==='RUNNING').length} / 3 jobs running`:'v2 jobs not deployed',`https://confluent.cloud/environments/env-pozpjk/flink`],['SFTP sink',connector('sftp-sink'),`${consoleRoot}/connectors`],['PostgreSQL sink',connector('postgres'),`${consoleRoot}/connectors`]].map(([name,status,url])=>`<article><strong>${name}</strong><small>${esc(status)}</small>${url?`<a href="${url}" target="_blank" rel="noopener">Confluent ↗</a>`:''}</article>`).join('');
      el('demo-health-time').textContent=`Confluent MCP · observed ${new Date(d.checkedAt).toLocaleTimeString()} · health is separate from reconciliation`;
    }catch(e){el('demo-health-time').textContent=`Confluent status stale / unavailable: ${e.message}`;}finally{healthBusy=false;}
  }
  el('demo-start').elements.file_count.addEventListener('input',event=>{const seconds=Number(event.target.value)*10;el('demo-duration').textContent=Number.isFinite(seconds)&&seconds>0?(seconds%60===0?`${seconds/60} minutes`:`${Math.floor(seconds/60)}m ${seconds%60}s`):'Choose a file count';});
  el('demo-start').addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;busy=true;
    const f=new FormData(e.currentTarget);requestKey ||= crypto.randomUUID();
    try{const d=await api('/api/demo/runs',{method:'POST',body:JSON.stringify({scenario:f.get('scenario'),file_count:Number(f.get('file_count')),detail_count:Number(f.get('detail_count')),interval_seconds:10,idempotency_key:requestKey})});selected=d.run.id;localStorage.setItem('bayno-run',selected);page=0;requestKey=null;}catch(e){el('demo-error').textContent=e.message;}finally{busy=false;await refresh();}
  });
  el('demo-stop').addEventListener('click',async()=>{if(busy||!selected)return;busy=true;try{await api(`/api/demo/runs/${selected}/stop`,{method:'POST',body:'{}'});}catch(e){el('demo-error').textContent=e.message;}finally{busy=false;refresh();}});
  el('demo-runs').addEventListener('change',e=>{selected=e.target.value;localStorage.setItem('bayno-run',selected);page=0;refresh();});
  el('demo-tabs').addEventListener('click',e=>{const tab=e.target.closest('[data-section]');if(!tab)return;section=tab.dataset.section;page=0;el('demo-tabs').querySelectorAll('button').forEach(b=>b.setAttribute('aria-selected',String(b===tab)));refresh();});
  el('demo-prev').onclick=()=>{page=Math.max(0,page-1);refresh();};el('demo-next').onclick=()=>{page++;refresh();};
  el('demo-history-older').onclick=async()=>{try{const n=Number(el('demo-runs').dataset.offset||0)+100;const d=await api(`/api/demo/runs?limit=100&offset=${n}`);if(!d.runs.length)return;el('demo-runs').insertAdjacentHTML('beforeend',d.runs.map(r=>`<option value="${r.id}">${esc(r.created_at)} · ${esc(r.scenario)}</option>`).join(''));el('demo-runs').dataset.offset=n;}catch(e){el('demo-error').textContent=e.message;}};
  el('demo-refresh').onclick=()=>{refresh();health();};
  el('show-demo').onclick=()=>{root.hidden=false;document.querySelector('#walkthrough').hidden=true;refresh();health();};
  el('show-walkthrough').onclick=()=>{root.hidden=true;document.querySelector('#walkthrough').hidden=false;};
  setInterval(()=>{if(!document.hidden)refresh();},5000);setInterval(health,15000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();health();}});
  window.addEventListener('bayno-run-selected',e=>{selected=e.detail;localStorage.setItem('bayno-run',selected);refresh();});
  refresh();health();
})();
