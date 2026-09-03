(function(){
  const MONTHS=['янв.','февр.','мар.','апр.','мая','июн.','июл.','авг.','сент.','окт.','нояб.','дек.'];
  let lastMessage=null;
  const two=n=>String(n).padStart(2,'0');

  function humanTime(ms){
    const d=new Date(Number(ms));
    if(Number.isNaN(d.getTime()))return'';
    const now=new Date();
    const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const msgDay=new Date(d.getFullYear(),d.getMonth(),d.getDate());
    const diff=Math.round((today-msgDay)/86400000);
    const time=two(d.getHours())+':'+two(d.getMinutes());
    if(diff===0)return'сегодня • '+time;
    if(diff===1)return'вчера • '+time;
    return d.getDate()+' '+MONTHS[d.getMonth()]+' • '+time;
  }

  function messageMs(el){
    const key=String(el&&el.dataset&&(el.dataset.messageKey||el.dataset.renderKey)||'');
    const ms=Number(key.split('_')[0]||0);
    return Number.isFinite(ms)&&ms>100000000000?ms:0;
  }
  function fixTimestamp(el){
    if(!el||!el.matches||!el.matches('.msg'))return;
    const time=el.querySelector('.msg-time');
    const ms=messageMs(el);
    if(!time||!ms)return;
    let target=time.querySelector('[data-medsi-time-label]');
    if(!target){
      const spans=[...time.querySelectorAll('span')];
      target=spans.length?spans[spans.length-1]:time;
      target.setAttribute&&target.setAttribute('data-medsi-time-label','1');
    }
    const edited=/изм\./i.test(time.textContent||'');
    const label=humanTime(ms)+(edited?' · изм.':'');
    if(target.textContent!==label)target.textContent=label;
  }
  function fixAllTimestamps(root){
    if(root&&root.matches&&root.matches('.msg'))fixTimestamp(root);
    if(root&&root.querySelectorAll)root.querySelectorAll('.msg').forEach(fixTimestamp);
  }

  function messageText(el){
    const body=el&&el.querySelector('.msg-body');
    if(body)return (body.innerText||body.textContent||'').trim();
    const clone=el&&el.cloneNode(true);if(!clone)return'';
    clone.querySelectorAll('.msg-time,.msg-reaction,.msg-reply-quote,.msg-image-wrap,.msg-video-wrap,.msg-author').forEach(n=>n.remove());
    return (clone.innerText||clone.textContent||'').trim();
  }
  function copyText(text){
    if(!text)return;
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).catch(()=>{});return}
    const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0;pointer-events:none';document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(_){}ta.remove();
  }
  function actionButton(icon,label,handler){
    const b=document.createElement('button');b.type='button';b.className='chat-context-action';
    b.innerHTML='<span class="chat-context-action-icon" aria-hidden="true"></span><span></span>';
    b.children[0].textContent=icon;b.children[1].textContent=label;b.onclick=e=>{e.stopPropagation();handler()};return b;
  }
  function fixContextMenu(menu){
    if(!menu||menu.classList.contains('hidden'))return;
    const actions=menu.querySelector('.chat-context-actions');if(!actions)return;
    const buttons=[...actions.querySelectorAll('.chat-context-action')];
    for(const b of buttons){
      const label=(b.children[1]&&b.children[1].textContent||b.textContent||'').trim();
      const icon=b.querySelector('.chat-context-action-icon');if(!icon)continue;
      if(label==='Ответить')icon.textContent='↪︎';
      else if(label==='Редактировать')icon.textContent='✎';
      else if(label==='Удалить')icon.textContent='×';
      else if(label==='Копировать текст')icon.textContent='⧉';
    }
    const txt=messageText(lastMessage);
    if(txt&&!buttons.some(b=>(b.textContent||'').includes('Копировать текст'))){
      const reply=buttons.find(b=>(b.textContent||'').includes('Ответить'));
      const copy=actionButton('⧉','Копировать текст',()=>{copyText(txt);menu.classList.add('hidden')});
      if(reply&&reply.nextSibling)actions.insertBefore(copy,reply.nextSibling);else if(reply)actions.appendChild(copy);else actions.prepend(copy);
    }
  }

  function fixReadMeta(){
    const meta=document.querySelector('.educator-exact-clone #meta');
    if(meta&&/прочитанные чаты/i.test(meta.textContent||''))meta.textContent='Выберите чат с нужным родителем.';
  }
  function fixBackGlyphs(root){
    const scope=root&&root.querySelectorAll?root:document;
    scope.querySelectorAll('.overlay-parent-meta-back').forEach(b=>{b.textContent='‹';b.setAttribute('aria-label','Назад')});
  }
  function suppressTransientLoading(root){
    const scope=root&&root.querySelectorAll?root:document;
    scope.querySelectorAll('.chat-empty,.overlay-thread__loading,.overlay-thread__empty').forEach(el=>{
      const t=(el.textContent||'').toLowerCase();
      if(/загруз|загружа/.test(t))el.classList.add('overlay-transient-loading');
    });
  }
  function snapSwitch(){
    const root=document.querySelector('.medsi-chat-overlay');if(!root)return;
    root.classList.add('overlay-switch-snap');
    requestAnimationFrame(()=>requestAnimationFrame(()=>root.classList.remove('overlay-switch-snap')));
  }

  document.addEventListener('pointerdown',e=>{
    const msg=e.target&&e.target.closest&&e.target.closest('.msg');if(msg)lastMessage=msg;
    const nav=e.target&&e.target.closest&&e.target.closest('.chat-card,#btnThreadBack,#btnChatsBack,.btn');
    if(nav){const txt=(nav.textContent||'').trim();if(nav.matches('.chat-card')||/прочитан|назад|вернуться/i.test(txt))snapSwitch()}
  },true);

  const mo=new MutationObserver(records=>{
    for(const r of records){
      if(r.type==='childList')for(const n of r.addedNodes)if(n.nodeType===1){fixAllTimestamps(n);fixBackGlyphs(n);suppressTransientLoading(n)}
    }
    fixReadMeta();
    fixContextMenu(document.getElementById('chatContextMenu'));
  });
  mo.observe(document.documentElement,{subtree:true,childList:true});
  fixAllTimestamps(document);fixBackGlyphs(document);fixReadMeta();suppressTransientLoading(document);
})();