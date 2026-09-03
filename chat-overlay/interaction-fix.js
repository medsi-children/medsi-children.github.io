(function(){
  const MONTHS=['янв.','февр.','мар.','апр.','мая','июн.','июл.','авг.','сент.','окт.','нояб.','дек.'];
  let lastMessage=null,lastThreadRows=[];

  function partsInMoscow(ms){
    const d=new Date(Number(ms));
    if(Number.isNaN(d.getTime()))return null;
    const parts=Object.fromEntries(new Intl.DateTimeFormat('ru-RU',{
      timeZone:'Europe/Moscow',year:'numeric',month:'numeric',day:'numeric',
      hour:'2-digit',minute:'2-digit',hour12:false
    }).formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    return {year:+parts.year,month:+parts.month,day:+parts.day,hour:parts.hour,minute:parts.minute};
  }
  function humanTime(ms){
    const p=partsInMoscow(ms),n=partsInMoscow(Date.now());
    if(!p||!n)return'';
    const a=Date.UTC(n.year,n.month-1,n.day),b=Date.UTC(p.year,p.month-1,p.day);
    const diff=Math.round((a-b)/86400000),time=p.hour+':'+p.minute;
    if(diff===0)return'сегодня • '+time;
    if(diff===1)return'вчера • '+time;
    return p.day+' '+MONTHS[p.month-1]+' • '+time;
  }
  function rowMs(row){
    const key=String(row&&row.messageKey||'');
    const ms=Number(key.split('_')[0]||0);
    if(Number.isFinite(ms)&&ms>100000000000)return ms;
    const ts=Number(row&&row.timestamp);
    return Number.isFinite(ts)&&ts>100000000000?ts:0;
  }
  function fixAllTimestamps(root){
    const scope=root&&root.querySelectorAll?root:document;
    const msgs=[...scope.querySelectorAll('.chat-box .msg')];
    if(!msgs.length||!lastThreadRows.length)return;
    const rows=lastThreadRows.slice(-msgs.length);
    msgs.forEach((el,i)=>{
      const time=el.querySelector('.msg-time'),row=rows[i],ms=rowMs(row);
      if(!time||!ms)return;
      const edited=!!(row&&row.editedAt)||/изм\./i.test(time.textContent||'');
      const next=humanTime(ms)+(edited?' · изм.':'');
      if((time.textContent||'')!==next)time.textContent=next;
    });
  }

  const transport=window.MedsiOverlayTransport;
  if(transport&&typeof transport.thread==='function'&&!transport.__medsiTimestampTap){
    transport.__medsiTimestampTap=true;
    const original=transport.thread.bind(transport);
    transport.thread=async function(){
      const res=await original(...arguments);
      lastThreadRows=Array.isArray(res&&res.messages)?res.messages:[];
      requestAnimationFrame(()=>fixAllTimestamps(document));
      return res;
    };
  }

  function messageText(el){
    const body=el&&el.querySelector('.msg-body');
    if(body)return(body.innerText||body.textContent||'').trim();
    const clone=el&&el.cloneNode(true);if(!clone)return'';
    clone.querySelectorAll('.msg-time,.msg-reaction,.msg-reply-quote,.msg-image-wrap,.msg-video-wrap,.msg-author').forEach(n=>n.remove());
    return(clone.innerText||clone.textContent||'').trim();
  }
  function copyText(value){
    if(!value)return;
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(value).catch(()=>{});return}
    const ta=document.createElement('textarea');ta.value=value;ta.style.cssText='position:fixed;opacity:0;pointer-events:none';document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(_){}ta.remove();
  }
  function actionButton(icon,label,handler){
    const b=document.createElement('button');b.type='button';b.className='chat-context-action';
    b.innerHTML='<span class="chat-context-action-icon" aria-hidden="true"></span><span></span>';
    b.children[0].textContent=icon;b.children[1].textContent=label;
    b.onclick=e=>{e.stopPropagation();handler()};return b;
  }
  function fixContextMenu(menu){
    if(!menu||menu.classList.contains('hidden'))return;
    const actions=menu.querySelector('.chat-context-actions');if(!actions)return;
    const buttons=[...actions.querySelectorAll('.chat-context-action')];
    for(const b of buttons){
      const label=(b.children[1]&&b.children[1].textContent||b.textContent||'').trim();
      const icon=b.querySelector('.chat-context-action-icon');if(!icon)continue;
      const glyph=label==='Ответить'?'↪︎':label==='Редактировать'?'✎':label==='Удалить'?'×':label==='Копировать текст'?'⧉':'';
      if(glyph&&icon.textContent!==glyph)icon.textContent=glyph;
    }
    const value=messageText(lastMessage);
    if(value&&!buttons.some(b=>(b.textContent||'').includes('Копировать текст'))){
      const reply=buttons.find(b=>(b.textContent||'').includes('Ответить'));
      const copy=actionButton('⧉','Копировать текст',()=>{copyText(value);menu.classList.add('hidden')});
      if(reply&&reply.nextSibling)actions.insertBefore(copy,reply.nextSibling);else if(reply)actions.appendChild(copy);else actions.prepend(copy);
    }
  }
  function fixReadMeta(){
    const meta=document.querySelector('.educator-exact-clone #meta');
    if(meta&&meta.textContent!=='Выберите чат с нужным родителем.')meta.textContent='Выберите чат с нужным родителем.';
  }
  function fixBackGlyphs(root){
    const scope=root&&root.querySelectorAll?root:document;
    scope.querySelectorAll('.medsi-legacy-back,.overlay-parent-meta-back').forEach(b=>{
      if(b.textContent!=='‹')b.textContent='‹';
      if(b.getAttribute('aria-label')!=='Назад')b.setAttribute('aria-label','Назад');
    });
  }
  function hideTransientLoading(root){
    const nodes=[];
    if(root&&root.nodeType===1)nodes.push(root);
    const scope=root&&root.querySelectorAll?root:document;
    scope.querySelectorAll('.chat-empty,.overlay-thread__loading,.overlay-thread__empty').forEach(n=>nodes.push(n));
    nodes.forEach(el=>{
      if(!el||!el.classList)return;
      const value=(el.textContent||'').trim().toLowerCase();
      if(/загруз|загружа/.test(value)){
        if(!el.classList.contains('overlay-transient-loading'))el.classList.add('overlay-transient-loading');
      }else if(el.classList.contains('overlay-transient-loading')){
        el.classList.remove('overlay-transient-loading');
        if(!el.classList.contains('overlay-result-enter')){
          el.classList.add('overlay-result-enter');
          setTimeout(()=>el.classList.remove('overlay-result-enter'),220);
        }
      }
    });
  }

  let scheduled=false;
  function scheduleFix(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      fixBackGlyphs(document);
      fixReadMeta();
      fixContextMenu(document.getElementById('chatContextMenu'));
      hideTransientLoading(document);
      fixAllTimestamps(document);
    });
  }

  document.addEventListener('pointerdown',e=>{
    const msg=e.target&&e.target.closest&&e.target.closest('.msg');
    if(msg)lastMessage=msg;
  },true);

  const mo=new MutationObserver(scheduleFix);
  mo.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  scheduleFix();
})();