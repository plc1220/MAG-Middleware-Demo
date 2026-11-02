// Deliberately small Markdown subset. Escape first; never accept model HTML.
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(value) {
  return esc(value).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
}
export function formatChatText(text) {
  const blocks=String(text).split(/```/);let html='';
  for(let b=0;b<blocks.length;b++) {
    if(b%2){html+=`<pre><code>${esc(blocks[b].replace(/^\w*\n/,''))}</code></pre>`;continue;}
    const lines=blocks[b].split('\n');let list='';
    const closeList=()=>{if(list){html+=`</${list}>`;list='';}};
    for(let i=0;i<lines.length;i++) {
      const line=lines[i];
      if(line.includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1]||'')) {
        closeList();const cells=x=>x.trim().replace(/^\||\|$/g,'').split('|').map(x=>inline(x.trim()));
        html+='<div class="mag-chat-table"><table><thead><tr>'+cells(line).map(x=>`<th>${x}</th>`).join('')+'</tr></thead><tbody>';i++;
        while(lines[i+1]?.includes('|')){i++;html+='<tr>'+cells(lines[i]).map(x=>`<td>${x}</td>`).join('')+'</tr>';}
        html+='</tbody></table></div>';continue;
      }
      const item=/^\s*(?:([-*]) |(\d+)\. )(.*)$/.exec(line);
      if(item){const kind=item[2]?'ol':'ul';if(list!==kind){closeList();html+=`<${kind}>`;list=kind;}html+=`<li>${inline(item[3])}</li>`;continue;}
      closeList();
      if(/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)){html+='<hr>';continue;}
      const heading=/^#{1,6}\s+(.+)$/.exec(line);
      if(heading)html+=`<h4>${inline(heading[1])}</h4>`;
      else if(line.trim())html+=`<p>${inline(line)}</p>`;
    }
    closeList();
  }
  return html;
}
