(function(){
  const t=window.MedsiOverlayTransport;
  if(!t||t.__medsiMessageEnhancements)return;
  t.__medsiMessageEnhancements=true;

  function injectStyles(){
    if(document.getElementById('medsi-message-enhancement-style'))return;
    const s=document.createElement('style');
    s.id='medsi-message-enhancement-style';
    s.textContent=`
      /* The original timestamp nodes stay in the DOM for compatibility, but the
         visible Telegram-like metadata is rendered independently so no other
         patch can overlap or rewrite it. */
      #parentChatMessages .parent-chat-msg > .parent-chat-time,
      #chatThreadBox .msg > .msg-time{display:none!important}
      .medsi-message-meta{
        position:absolute;right:10px;bottom:7px;z-index:2;
        display:inline-flex;align-items:center;justify-content:flex-end;gap:4px;
        min-height:14px;white-space:nowrap;pointer-events:none;
        font-size:11px;line-height:1;color:inherit;opacity:.82
      }
      .medsi-display-time{font:inherit;line-height:1;white-space:nowrap}
      .medsi-read-receipt{
        position:static!important;display:inline-block;width:auto!important;
        min-width:15px;text-align:right;font-size:12px;line-height:1;
        font-weight:900;letter-spacing:-2px;user-select:none;opacity:.72
      }
      .parent-chat-msg.parent .medsi-read-receipt,
      #chatThreadBox .msg.parent .medsi-read-receipt{color:#12aeb8}
      .parent-chat-msg.parent .medsi-read-receipt.is-read,
      #chatThreadBox .msg.parent .medsi-read-receipt.is-read{color:#079da8;opacity:1}
      .parent-chat-msg.educator .medsi-read-receipt,
      #chatThreadBox .msg.educator .medsi-read-receipt{color:rgba(255,255,255,.88)}
      .parent-chat-msg.educator .medsi-read-receipt.is-read,
      #chatThreadBox .msg.educator .medsi-read-receipt.is-read{color:#fff;opacity:1}
      .medsi-date-separator{
        align-self:center;display:block;max-width:calc(100% - 32px);
        margin:7px auto 3px;padding:5px 11px;border-radius:999px;
        background:rgba(239,248,249,.94);border:1px solid rgba(74,139,147,.18);
        box-shadow:0 3px 10px rgba(44,92,99,.08);
        color:#658087;font-size:11px;font-weight:750;line-height:1.2;
        text-align:center;white-space:nowrap;pointer-events:none;user-select:none
      }
      .medsi-parent-reply-preview{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 11px;margin:0 0 8px;border-radius:12px;border:1px solid rgba(36,211,218,.28);background:#f2fcfd;color:#285a62;animation:medsiReplyIn .18s ease both}
      .medsi-parent-reply-preview.hidden{display:none!important}
      .medsi-parent-reply-preview strong{display:block;color:#16aeb7;font-size:.78rem;margin-bottom:2px}
      .medsi-parent-reply-text{font-size:.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(68vw,420px)}
      .medsi-parent-reply-preview button{flex:0 0 34px;width:34px;height:34px;border:0;border-radius:50%;background:#fff;color:#4f7c82;font-size:22px;line-height:1;cursor:pointer}
      .medsi-reply-action{width:100%;display:flex;align-items:center;gap:10px;border:0;background:#fff;color:#285a62;padding:10px 12px;font:inherit;font-weight:750;text-align:left;border-top:1px solid rgba(36,211,218,.12)}
      .medsi-reply-action span:first-child{font-size:18px;color:#18b8c2}
      @keyframes medsiReplyIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
    `;
    document.head.appendChild(s)
  }

  let lastThread=[];
  let activeSession=null;
  let activePhone='';
  let replyTarget=null;
  const originalThread=t.thread.bind(t);
  const originalSend=t.sendMessage.bind(t);

  function moscowParts(value){
    const d=new Date(Number(value));
    if(Number.isNaN(d.getTime()))return null;
    const parts=Object.fromEntries(
      new Intl.DateTimeFormat('ru-RU',{
        timeZone:'Europe/Moscow',
        year:'numeric',month:'numeric',day:'numeric',
        hour:'2-digit',minute:'2-digit',hour12:false
      }).formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value])
    );
    return {
      year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),
      hour:String(parts.hour||'').padStart(2,'0'),
      minute:String(parts.minute||'').padStart(2,'0')
    };
  }

  function dayKey(value){
    const p=moscowParts(value);
    return p?`${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`:'';
  }

  function displayTime(value){
    const p=moscowParts(value);
    return p?p.hour+':'+p.minute:'';
  }

  function dateLabel(value){
    const p=moscowParts(value),n=moscowParts(Date.now());
    if(!p)return'';
    if(n){
      const current=Date.UTC(n.year,n.month-1,n.day);
      const target=Date.UTC(p.year,p.month-1,p.day);
      const diff=Math.round((current-target)/86400000);
      if(diff===0)return'Сегодня';
      if(diff===1)return'Вчера';
    }
    return new Intl.DateTimeFormat('ru-RU',{
      timeZone:'Europe/Moscow',
      day:'numeric',
      month:'long',
      ...(n&&p.year===n.year?{}:{year:'numeric'})
    }).format(new Date(Number(value)));
  }

  function explicitRead(m,side){
    if(!m)return false;
    if(side==='parent'){
      return !!(
        m.readByEducator||m.readByEducatorAt||
        m.educatorRead||m.educatorReadAt||
        m.read_by_educator||m.educator_read_at||
        m.readByOther||m.otherReadAt||
        m.isRead===true||m.read===true
      );
    }
    return !!(
      m.readByParent||m.readByParentAt||
      m.parentRead||m.parentReadAt||
      m.read_by_parent||m.parent_read_at||
      m.readByOther||m.otherReadAt||
      m.isRead===true||m.read===true
    );
  }

  function ensureDateSeparator(messageEl,key,label){
    if(!messageEl||!messageEl.parentNode||!key)return;
    const previous=messageEl.previousElementSibling;
    if(previous&&previous.classList.contains('medsi-date-separator')){
      if(previous.dataset.dateKey!==key)previous.dataset.dateKey=key;
      if(previous.textContent!==label)previous.textContent=label;
      return;
    }
    const separator=document.createElement('div');
    separator.className='medsi-date-separator';
    separator.dataset.dateKey=key;
    separator.textContent=label;
    messageEl.parentNode.insertBefore(separator,messageEl);
  }

  function ensureMeta(el,row,ownSide,ownClass){
    if(!el)return;
    let meta=el.querySelector(':scope > .medsi-message-meta');
    if(!meta){
      meta=document.createElement('span');
      meta.className='medsi-message-meta';
      const time=document.createElement('span');
      time.className='medsi-display-time';
      meta.appendChild(time);
      el.appendChild(meta);
    }

    const time=meta.querySelector('.medsi-display-time');
    const ts=Number(row&&row.timestamp);
    if(time){
      const next=Number.isFinite(ts)&&ts>0?displayTime(ts):'';
      if(next&&time.textContent!==next)time.textContent=next;
    }

    const own=row?String(row.side||'')===ownSide:el.classList.contains(ownClass);
    let receipt=meta.querySelector('.medsi-read-receipt');
    if(!own){
      if(receipt)receipt.remove();
      return;
    }
    if(!receipt){
      receipt=document.createElement('span');
      receipt.className='medsi-read-receipt';
      meta.appendChild(receipt);
    }
    const read=explicitRead(row,ownSide);
    receipt.classList.toggle('is-read',read);
    const glyph=read?'✓✓':'✓';
    if(receipt.textContent!==glyph)receipt.textContent=glyph;
    receipt.title=read?'Прочитано':'Отправлено';
    receipt.setAttribute('aria-label',receipt.title);
  }

  function decorateThread(selector,ownSide,ownClass){
    const nodes=[...document.querySelectorAll(selector)];
    if(!nodes.length)return;
    let previousKey='';
    nodes.forEach((el,i)=>{
      const row=lastThread[i]||null;
      const rawTs=Number(row&&row.timestamp);
      const ts=Number.isFinite(rawTs)&&rawTs>0?rawTs:(i>=lastThread.length?Date.now():0);
      const key=ts?dayKey(ts):'';
      if(key&&key!==previousKey)ensureDateSeparator(el,key,dateLabel(ts));
      if(key)previousKey=key;
      ensureMeta(el,row,ownSide,ownClass);
      el.dataset.medsiMessageIndex=String(i);
    });
  }

  let decorateScheduled=false;
  function decorateAll(){
    decorateThread('#parentChatMessages .parent-chat-msg','parent','parent');
    decorateThread('#chatThreadBox .msg','educator','educator');
  }
  function scheduleDecorate(){
    if(decorateScheduled)return;
    decorateScheduled=true;
    requestAnimationFrame(()=>{
      decorateScheduled=false;
      decorateAll();
      syncReplyAction();
    });
  }

  t.thread=async function(session,phone,before,limit){
    const res=await originalThread(session,phone,before,limit);
    if(!before&&res&&Array.isArray(res.messages))lastThread=res.messages.slice();
    scheduleDecorate();
    return res;
  };

  function ensureReplyPreview(){
    let p=document.getElementById('medsiParentReplyPreview');
    if(p)return p;
    const compose=document.getElementById('parentChatCompose');
    if(!compose)return null;
    p=document.createElement('div');p.id='medsiParentReplyPreview';p.className='medsi-parent-reply-preview hidden';
    p.innerHTML='<div><strong>Ответ на сообщение</strong><div class="medsi-parent-reply-text"></div></div><button type="button" aria-label="Отменить ответ">×</button>';
    p.querySelector('button').onclick=()=>setReply(null);
    compose.parentNode.insertBefore(p,compose);
    return p;
  }

  function label(m){
    if(!m)return'';
    if(m.text)return String(m.text).slice(0,140);
    if(m.type==='image')return'Фотография';
    if(m.type==='video')return'Видео';
    return'Сообщение';
  }

  function setReply(m){
    replyTarget=m||null;
    const p=ensureReplyPreview();if(!p)return;
    p.classList.toggle('hidden',!replyTarget);
    p.querySelector('.medsi-parent-reply-text').textContent=replyTarget?label(replyTarget):'';
    if(replyTarget)document.getElementById('parentChatInput')?.focus();
  }

  function selectedParentMessage(){
    const menu=document.querySelector('.parent-chat-context:not(.hidden)');
    if(!menu)return null;
    const idx=Number(menu.dataset.medsiIndex);
    return Number.isInteger(idx)?lastThread[idx]:null;
  }

  function syncReplyAction(){
    const menu=document.querySelector('.parent-chat-context:not(.hidden)');
    if(!menu||menu.querySelector('.medsi-reply-action'))return;
    const m=selectedParentMessage();
    if(!m||!m.messageKey)return;
    const b=document.createElement('button');b.type='button';b.className='medsi-reply-action';
    b.innerHTML='<span>↩</span><span>Ответить</span>';
    b.onclick=e=>{e.preventDefault();e.stopPropagation();menu.classList.add('hidden');setReply(m)};
    menu.appendChild(b);
  }

  document.addEventListener('click',e=>{
    const msg=e.target.closest&&e.target.closest('#parentChatMessages .parent-chat-msg');
    if(msg){
      const nodes=[...document.querySelectorAll('#parentChatMessages .parent-chat-msg')];
      const idx=nodes.indexOf(msg);
      const menu=document.querySelector('.parent-chat-context');
      if(menu&&idx>=0)menu.dataset.medsiIndex=String(idx);
    }
  },true);

  const mo=new MutationObserver(()=>scheduleDecorate());
  mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});

  function captureParentState(){
    const api=window.MedsiParentChatScreen;
    if(!api||api.__medsiReplyWrapped)return;
    api.__medsiReplyWrapped=true;
    const open=api.open.bind(api);
    api.open=async function(next){activeSession=next&&next.session||null;activePhone=next&&next.phone||'';setReply(null);return open(next)};
    const close=api.close&&api.close.bind(api);
    if(close)api.close=function(){activeSession=null;activePhone='';setReply(null);return close()};
  }

  function wrapSubmit(){
    const form=document.getElementById('parentChatCompose');
    if(!form||form.dataset.medsiReplyWrapped)return;
    form.dataset.medsiReplyWrapped='1';
    form.addEventListener('submit',async e=>{
      if(!replyTarget||!activeSession||!activePhone)return;
      const input=document.getElementById('parentChatInput');
      const text=String(input&&input.value||'').trim();
      if(!text)return;
      e.preventDefault();e.stopImmediatePropagation();
      const send=document.getElementById('parentChatSend'),attach=document.getElementById('parentChatAttach');
      if(send)send.disabled=true;if(attach)attach.disabled=true;if(input)input.disabled=true;
      try{
        await originalSend(activeSession,'parent',activePhone,{type:'text',text,replyToKey:replyTarget.messageKey});
        if(input)input.value='';setReply(null);
        await window.MedsiParentChatScreen?.refresh({stick:true});
      }catch(err){
        const box=document.getElementById('parentChatError');
        if(box){box.textContent=err&&err.message||'Не удалось отправить ответ.';box.classList.remove('hidden')}
      }finally{
        if(send)send.disabled=false;if(attach)attach.disabled=false;if(input){input.disabled=false;input.focus()}
      }
    },true);
  }

  function boot(){injectStyles();captureParentState();wrapSubmit();scheduleDecorate()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,0),{once:true});else setTimeout(boot,0);
  setInterval(boot,700);
})();