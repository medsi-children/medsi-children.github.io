(function(){
  const MONTHS=['янв.','февр.','мар.','апр.','мая','июн.','июл.','авг.','сент.','окт.','нояб.','дек.'];
  let lastMessage=null,lastThreadRows=[];
  const two=n=>String(n).padStart(2,'0');

  function partsInMoscow(ms){
    const d=new Date(Number(ms));if(Number.isNaN(d.getTime()))return null;
    const parts=Object.fromEntries(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    return {year:+parts.year,month:+parts.month,day:+parts.day,hour:parts.hour,minute:parts.minute};
  }
  function humanTime(ms){
    const p=partsInMoscow(ms),n=partsInMoscow(Date.now());if(!p||!n)return'';
    const a=Date.UTC(n.year,n.month-1,n.day),b=Date.UTC(p.year,p.month-1,p.day),diff=Math.round((a-b)/86400000);
    const time=p.hour+':'+p.minute;
    if(diff===0)return'сегодня • '+time;
    if(diff===1)return'вчера • '+time;
    return p.day+' '+MONTHS[p.month-1]+' • '+time;
  }
  function rowMs(row){
    const key=String(row&&row.messageKey||'');const ms=Number(key.split('_')[0]||0);
    if(Number.isFinite(ms)&&ms>100000000000)return ms;
    const ts=Number(row&&row.timestamp);return Number.isFinite(ts)&&ts>100000000000?ts:0;
  }
  function fixAllTimestamps(root){
    const scope=root&&root.querySelectorAll?root:document;
    const msgs=[...scope.querySelectorAll('.chat-box .msg')];
    if(!msgs.length||!lastThreadRows.length)return;
    const rows=lastThreadRows.slice(-msgs.length);
    msgs.forEach((el,i)=>{
      const time=el.querySelector('.msg-time'),row=rows[i],ms=rowMs(row);if(!time||!ms)return;
      const edited=!!(row&&row.editedAt)||/изм\./i.test(time.textContent||'');
      time.textContent=humanTime(ms)+(edited?' · изм.':'');
    });
  }

  const transport=window.MedsiOverlayTransport;
  if(transport&&typeof transport.thread==='function'&&!transport.__medsiTimestampTap){
    transport.__medsiTimestampTap=true;
    const original=transport.thread.bind(transport);
    transport.thread=async function(){
      const res=await original(...arguments);
      lastThreadRows=Array.isArray(res&&res.messages)?res.messages:[];
      queueMicrotask(()=>fixAllTimestamps(document));
      return res;
    };
  }

  function messageText(el){
    const body=el&&el.querySelector('.msg-body');if(body)return(body.innerText||body.textContent||'').trim();
    const clone=el&&el.cloneNode(true);if(!clone)return'';
    clone.querySelectorAll('.msg-time,.msg-reaction,.msg-reply-quote,.msg-image-wrap,.msg-video-wrap,.msg-author').forEach(n=>n.remove());
    return(clone.innerText||clone.textContent||'').trim();
  }
  function copyText(text){
    if(!text)return;
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).catch(()=>{});return}
    const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0;pointer-events:none';document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(_){}ta.remove();
  }
  function actionButton(icon,label,handler){
    const b=document.createElement('button');b.type='button';b.className='chat-context-action';b.innerHTML='<span class="chat-context-action-icon" aria-hidden="true"></span><span></span>';b.children[0].textContent=icon;b.children[1].textContent=label;b.onclick=e=>{e.stopPropagation();handler()};return b;
  }
  function fixContextMenu(menu){
    if(!menu||menu.classList.contains('hidden'))return;
    const actions=menu.querySelector('.chat-context-actions');if(!actions)return;
    const buttons=[...actions.querySelectorAll('.chat-context-action')];
    for(const b of buttons){
      const label=(b.children[1]&&b.children[1].textContent||b.textContent||'').trim(),icon=b.querySelector('.chat-context-action-icon');if(!icon)continue;
      if(label==='Ответить')icon.textContent='↪︎';else if(label==='Редактировать')icon.textContent='✎';else if(label==='Удалить')icon.textContent='×';else if(label==='Копировать текст')icon.textContent='⧉';
    }
    const txt=messageText(lastMessage);
    if(txt&&!buttons.some(b=>(b.textContent||'').includes('Копировать текст'))){
      const reply=buttons.find(b=>(b.textContent||'').includes('Ответить')),copy=actionButton('⧉','Копировать текст',()=>{copyText(txt);menu.classList.add('hidden')});
      if(reply&&reply.nextSibling)actions.insertBefore(copy,reply.nextSibling);else if(reply)actions.appendChild(copy);else actions.prepend(copy);
    }
  }
  function fixReadMeta(){const meta=document.querySelector('.educator-exact-clone #meta');if(meta&&/прочитанные чаты/i.test(meta.textContent||''))meta.textContent='Выберите чат с нужным родителем.'}
  function fixBackGlyphs(root){const scope=root&&root.querySelectorAll?root:document;scope.querySelectorAll('.medsi-legacy-back,.overlay-parent-meta-back').forEach(b=>{b.textContent='‹';b.setAttribute('aria-label','Назад')})}
  function suppressTransientLoading(root){const scope=root&&root.querySelectorAll?root:document;scope.querySelectorAll('.chat-empty,.overlay-thread__loading,.overlay-thread__empty').forEach(el=>{const t=(el.textContent||'').toLowerCase();if(/загруз|загружа/.test(t))el.classList.add('overlay-transient-loading')})}
  function snapSwitch(){const root=document.querySelector('.medsi-chat-overlay');if(!root)return;root.classList.add('overlay-switch-snap');requestAnimationFrame(()=>requestAnimationFrame(()=>root.classList.remove('overlay-switch-snap')))}

  document.addEventListener('pointerdown',e=>{
    const msg=e.target&&e.target.closest&&e.target.closest('.msg');if(msg)lastMessage=msg;
    const nav=e.target&&e.target.closest&&e.target.closest('.chat-card,#btnThreadBack,#btnChatsBack,.btn');if(nav){const txt=(nav.textContent||'').trim();if(nav.matches('.chat-card')||/прочитан|назад|вернуться/i.test(txt))snapSwitch()}
  },true);

  const mo=new MutationObserver(records=>{
    for(const r of records)if(r.type==='childList')for(const n of r.addedNodes)if(n.nodeType===1){fixBackGlyphs(n);suppressTransientLoading(n)}
    fixReadMeta();fixContextMenu(document.getElementById('chatContextMenu'));fixAllTimestamps(document);
  });
  mo.observe(document.documentElement,{subtree:true,childList:true});
  fixBackGlyphs(document);fixReadMeta();suppressTransientLoading(document);fixAllTimestamps(document);
})();