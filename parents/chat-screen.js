(function(){
  const $=id=>document.getElementById(id);
  const t=window.MedsiOverlayTransport;
  if(!t)return;
  const REACTIONS=['❤️','👍','👌','🙏','🥰','😁','🔥'];
  const LIVE_REFRESH_MS=5000;
  const p10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  const fmt=v=>{const d=new Date(Number(v));return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})};
  function moscowDay(value){
    const d=new Date(Number(value));if(Number.isNaN(d.getTime()))return null;
    const parts=Object.fromEntries(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const year=Number(parts.year),month=Number(parts.month),day=Number(parts.day);
    if(!year||!month||!day)return null;
    return{year,month,day,key:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`};
  }
  function dateChip(value){
    const p=moscowDay(value),n=moscowDay(Date.now());if(!p)return null;
    let label='';
    if(n){
      const current=Date.UTC(n.year,n.month-1,n.day),target=Date.UTC(p.year,p.month-1,p.day),diff=Math.round((current-target)/86400000);
      if(diff===0)label='Сегодня';else if(diff===1)label='Вчера';
    }
    if(!label)label=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',...(n&&p.year===n.year?{}:{year:'numeric'})}).format(new Date(Number(value)));
    return{key:p.key,label};
  }
  let state=null,rows=[],busy=false,dead=false,chatClosed=false,lightbox=null,reactionMenu=null,liveTimer=0,liveRunning=false,initialMessagesRendered=false;

  function mediaUrl(m){
    const id=String(m&&m.fileId||'');if(!id)return'';
    if(typeof t.mediaUrl==='function')return t.mediaUrl(id,'w1600');
    if(id.startsWith('kv:')||id.startsWith('r2:'))return t.baseUrl+'/media/'+encodeURIComponent(id.slice(3));
    return 'https://drive.google.com/thumbnail?id='+encodeURIComponent(id)+'&sz=w1600';
  }
  function receiptState(m){
    if(!m||String(m.side||'')!=='parent')return[];
    return [
      m.readByEducator,m.readByEducatorAt,m.educatorRead,m.educatorReadAt,m.read_by_educator,m.educator_read_at,
      m.readByOther,m.otherReadAt,m.isRead,m.read
    ]
  }
  function threadSig(list){
    return JSON.stringify((list||[]).map(m=>[
      m&&m.messageKey||'',m&&m.side||'',m&&m.type||'',m&&m.text||'',m&&m.fileId||'',
      m&&m.reaction||'',m&&m.editedAt||'',m&&m.timestamp||'',
      m&&m.replyToKey||'',m&&m.reply&&m.reply.messageKey||'',m&&m.reply&&m.reply.text||'',receiptState(m)
    ]))
  }
  function messageKey(m){const key=String(m&&m.messageKey||'').trim();return key||['fallback',m&&m.side||'',m&&m.timestamp||'',m&&m.type||'',m&&m.fileId||'',m&&m.text||''].join('|')}
  function messageSig(m){return JSON.stringify([m&&m.side||'',m&&m.type||'',m&&m.text||'',m&&m.fileId||'',m&&m.reaction||'',m&&m.editedAt||'',m&&m.timestamp||'',m&&m.replyToKey||'',m&&m.reply&&m.reply.messageKey||'',m&&m.reply&&m.reply.text||'',receiptState(m)])}
  function isPending(m){return String(m&&m.messageKey||'').startsWith('pending-')}
  function samePendingMessage(pending,confirmed){return isPending(pending)&&!isPending(confirmed)&&String(pending&&pending.side||'')===String(confirmed&&confirmed.side||'')&&String(pending&&pending.type||'')===String(confirmed&&confirmed.type||'')&&String(pending&&pending.text||'')===String(confirmed&&confirmed.text||'')&&String(pending&&pending.fileId||'')===String(confirmed&&confirmed.fileId||'')&&Math.abs(Number(pending&&pending.timestamp||0)-Number(confirmed&&confirmed.timestamp||0))<120000}
  function nearBottom(){const box=$('parentChatMessages');return !box||box.scrollHeight-box.scrollTop-box.clientHeight<90}
  function scrollBottom(smooth){const box=$('parentChatMessages');if(!box)return;requestAnimationFrame(()=>box.scrollTo({top:box.scrollHeight,behavior:smooth?'smooth':'auto'}))}
  function showError(msg){const e=$('parentChatError');if(!e)return;e.textContent=String(msg||'Не удалось открыть чат.');e.classList.remove('hidden')}
  function clearError(){const e=$('parentChatError');if(!e)return;e.textContent='';e.classList.add('hidden')}
  function setBusy(v){busy=!!v;const disabled=busy||chatClosed;$('parentChatInput').disabled=disabled;$('parentChatSend').disabled=disabled;$('parentChatAttach').disabled=disabled}
  function isChatClosedError(error){return !!(error&&(error.code==='CHAT_CLOSED'||Number(error.status)===410))}
  function stopLive(){if(liveTimer){clearTimeout(liveTimer);liveTimer=0}liveRunning=false}
  function chatVisible(){const screen=$('screenChat');return !!state&&!dead&&!chatClosed&&!document.hidden&&document.body.dataset.screen==='screenChat'&&screen&&!screen.classList.contains('hidden')}
  function scheduleLive(delay){
    if(liveTimer)clearTimeout(liveTimer);
    if(!state||dead||chatClosed)return;
    liveTimer=setTimeout(async()=>{
      liveTimer=0;
      if(chatVisible()&&!liveRunning){
        liveRunning=true;
        try{await refresh({fresh:true,silent:true,background:true})}catch(err){if(isChatClosedError(err))showClosedChat()}
        finally{liveRunning=false}
      }
      scheduleLive(LIVE_REFRESH_MS);
    },Math.max(150,Number(delay)||LIVE_REFRESH_MS))
  }
  function showClosedChat(){
    chatClosed=true;rows=[];stopLive();clearError();closeReactionMenu();
    const box=$('parentChatMessages');
    if(box){box.replaceChildren();const e=document.createElement('div');e.className='parent-chat-empty';e.textContent='Чат с воспитателями закрыт.';box.appendChild(e)}
    $('parentChatInput').value='';setBusy(false);
  }

  function closeLightbox(){if(!lightbox)return;lightbox.remove();lightbox=null}
  function openLightbox(src,alt){
    closeLightbox();
    const root=document.createElement('div');root.className='parent-chat-lightbox';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Просмотр фотографии');
    const img=document.createElement('img');img.src=src;img.alt=alt||'Фотография из чата';
    const close=document.createElement('button');close.type='button';close.className='parent-chat-lightbox-close';close.setAttribute('aria-label','Закрыть фотографию');close.textContent='×';
    close.onclick=closeLightbox;root.onclick=e=>{if(e.target===root)closeLightbox()};
    root.append(img,close);document.body.appendChild(root);lightbox=root;
  }

  function ensureReactionMenu(){
    if(reactionMenu)return reactionMenu;
    const menu=document.createElement('div');menu.className='parent-chat-context hidden';menu.setAttribute('role','menu');
    document.body.appendChild(menu);reactionMenu=menu;return menu;
  }
  function closeReactionMenu(){if(reactionMenu)reactionMenu.classList.add('hidden')}
  function openReactionMenu(m,el){
    if(chatClosed||!state||!m||!m.messageKey||String(m.messageKey).startsWith('pending-'))return;
    const menu=ensureReactionMenu();menu.replaceChildren();
    REACTIONS.forEach(reaction=>{
      const b=document.createElement('button');b.type='button';b.className='parent-chat-reaction-btn';b.textContent=reaction;b.setAttribute('aria-label','Поставить реакцию '+reaction);
      b.onclick=async ev=>{ev.preventDefault();ev.stopPropagation();closeReactionMenu();try{await t.react(state.session,m.messageKey,reaction);await refresh({stick:false,fresh:true})}catch(err){if(isChatClosedError(err))showClosedChat();else showError(err&&err.message||'Не удалось поставить реакцию.')}};
      menu.appendChild(b);
    });
    const r=el.getBoundingClientRect();
    menu.classList.remove('hidden');
    const w=Math.min(310,window.innerWidth-24);
    menu.style.left=Math.min(window.innerWidth-w-12,Math.max(12,r.left+(r.width-w)/2))+'px';
    const menuH=54;let top=r.bottom+7;if(top+menuH>window.innerHeight)top=Math.max(12,r.top-menuH-7);menu.style.top=top+'px';
  }
  document.addEventListener('click',e=>{if(reactionMenu&&!reactionMenu.classList.contains('hidden')&&!e.target.closest('.parent-chat-context,.parent-chat-msg'))closeReactionMenu()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeLightbox();closeReactionMenu()}});

  function messageNode(m,quiet,stick){
      const el=document.createElement('article');el.className='parent-chat-msg '+(m.side==='parent'?'parent':'educator');el.dataset.medsiMessageKey=messageKey(m);el.dataset.medsiMessageSignature=messageSig(m);
      if(quiet)el.dataset.medsiAnimated='1';
      const author=document.createElement('div');author.className='parent-chat-author';
      author.textContent=m.side==='parent'
        ?'Родитель'+(state.parentName?' '+state.parentName:'')
        :'Детское Отделение Медси';
      el.appendChild(author);
      const u=mediaUrl(m);
      const previewUrl=m.type==='image'&&typeof t.mediaPreviewUrl==='function'?t.mediaPreviewUrl(m.fileId,'w960'):u;
      if(u){
        const frame=document.createElement('div');frame.className='parent-chat-media-frame';
        const md=document.createElement(m.type==='video'?'video':'img');md.className='parent-chat-media';
        const markReady=()=>{frame.classList.add('medsi-media-ready');md.classList.add('is-loaded','medsi-media-ready');if(m.type==='image'&&window.MedsiMediaPreload)window.MedsiMediaPreload.queueOriginal(u);if(stick&&nearBottom())scrollBottom(false)};
        if(m.type==='video'){
          frame.style.cursor='default';md.controls=true;md.preload='metadata';md.onloadedmetadata=markReady;
        } else {
          md.alt='Фотография из чата';
          md.onload=markReady;
          frame.onclick=e=>{e.preventDefault();e.stopPropagation();openLightbox(u,md.alt)};
        }
        frame.appendChild(md);el.appendChild(frame);md.src=previewUrl;
        if((md.tagName==='IMG'&&md.complete&&md.naturalWidth>0)||(md.tagName==='VIDEO'&&md.readyState>=1))markReady();
      }
      if(m.text){const b=document.createElement('div');b.textContent=String(m.text);el.appendChild(b)}
      if(m.reaction){const r=document.createElement('span');r.className='parent-chat-reaction';r.textContent=String(m.reaction);el.appendChild(r)}
      const tm=document.createElement('span');tm.className='parent-chat-time';tm.textContent=fmt(m.timestamp);el.appendChild(tm);
      el.onclick=e=>{if(e.target.closest('img,video,button,.parent-chat-reaction'))return;e.preventDefault();e.stopPropagation();openReactionMenu(m,el)};
      return el
  }
  function render(list,opts){
    const box=$('parentChatMessages');if(!box)return;
    closeReactionMenu();
    const stick=opts&&opts.stick!==undefined?!!opts.stick:nearBottom();
    const preserveExact=!!(opts&&opts.preserveExact);
    const animateInitial=!!(opts&&opts.animateInitial)&&!initialMessagesRendered;
    const oldHeight=box.scrollHeight,oldTop=box.scrollTop;
    const previousRows=rows,updatedRows=Array.isArray(list)?list:[];
    if(!updatedRows.length){rows=updatedRows;initialMessagesRendered=true;const e=document.createElement('div');e.className='parent-chat-empty';e.textContent='Сообщений пока нет.';box.replaceChildren(e);return}
    const existing=new Map([...box.children].filter(el=>el.matches&&el.matches('.parent-chat-msg')&&el.dataset.medsiMessageKey).map(el=>[el.dataset.medsiMessageKey,el]));
    const hadMessages=existing.size>0;
    const hasStableOverlap=updatedRows.some(m=>existing.has(messageKey(m)));
    const quietAllNew=hadMessages&&!hasStableOverlap;
    const existingOrder=[...box.children].filter(el=>el.matches&&el.matches('.parent-chat-msg')).map(el=>el.dataset.medsiMessageKey||'');
    const sameOrder=existingOrder.length===updatedRows.length&&updatedRows.every((m,index)=>existingOrder[index]===messageKey(m));
    if(sameOrder){
      updatedRows.forEach(m=>{const old=existing.get(messageKey(m));if(old&&old.dataset.medsiMessageSignature!==messageSig(m))old.replaceWith(messageNode(m,true,stick))});
      rows=updatedRows;
      return;
    }
    const pendingRows=previousRows.filter(isPending),usedPending=new Set();
    const messageNodes=updatedRows.map((m,index)=>{
      const key=messageKey(m),sig=messageSig(m),old=existing.get(key);
      if(old&&old.dataset.medsiMessageSignature===sig)return old;
      if(old)return messageNode(m,true,stick);
      const pending=pendingRows.find(row=>!usedPending.has(messageKey(row))&&samePendingMessage(row,m));
      if(pending)usedPending.add(messageKey(pending));
      const quiet=!animateInitial||quietAllNew||!!pending||(!hadMessages&&index<updatedRows.length-14);
      return messageNode(m,quiet,stick)
    });
    rows=updatedRows;
    initialMessagesRendered=true;
    const fragment=document.createDocumentFragment();
    let previousDay='';
    rows.forEach((m,i)=>{const chip=dateChip(m&&m.timestamp);if(chip&&chip.key!==previousDay){const sep=document.createElement('div');sep.className='medsi-date-separator';sep.dataset.dateKey=chip.key;sep.textContent=chip.label;fragment.appendChild(sep);previousDay=chip.key}fragment.appendChild(messageNodes[i])});
    box.replaceChildren(fragment);
    requestAnimationFrame(()=>{
      if(stick)box.scrollTo({top:box.scrollHeight,behavior:'auto'});
      else if(preserveExact)box.scrollTop=Math.max(0,oldTop);
      else box.scrollTop=Math.max(0,oldTop+(box.scrollHeight-oldHeight));
    })
  }

  async function fetchThread(fresh){
    const res=await t.thread(state.session,state.phone,'',100,fresh?{fresh:true}:undefined);
    return Array.isArray(res&&res.messages)?res.messages:[];
  }
  async function refresh(opts){
    opts=opts||{};
    const list=await fetchThread(!!opts.fresh);if(dead||!state)return list;
    const changed=threadSig(list)!==threadSig(rows);
    const shouldRender=!!opts.force||changed;
    if(shouldRender){
      const stick=opts.stick!==undefined?!!opts.stick:nearBottom();
      render(list,{stick,preserveExact:!!opts.background&&!stick,animateInitial:!initialMessagesRendered});
    }else rows=list;
    if((changed||opts.forceRead)&&!chatClosed){
      t.markRead(state.session,'parent',state.phone).catch(err=>{if(isChatClosedError(err))showClosedChat()});
    }
    return list
  }

  async function open(next){
    stopLive();dead=false;chatClosed=false;state={...next,phone:p10(next&&next.phone)};rows=[];initialMessagesRendered=false;clearError();closeReactionMenu();setBusy(false);if(window.MedsiMediaPreload)window.MedsiMediaPreload.reset();
    $('parentChatChild').textContent=state.childName||state.parentName||'Ребёнок';
    $('parentChatPhone').textContent=state.phone?'8'+state.phone:'';
    $('parentChatInput').value='';
    const cached=window.MedsiParentPrewarm?await MedsiParentPrewarm.ready(state.phone).catch(()=>null):null;
    const hasCached=!!(cached&&Array.isArray(cached.messages));
    if(hasCached){$('parentChatMessages').replaceChildren();render(cached.messages,{stick:true,animateInitial:true});}
    else $('parentChatMessages').innerHTML='<div class="parent-chat-empty">Загружаем сообщения…</div>';
    try{await refresh({stick:true,fresh:true,force:!hasCached,forceRead:true})}catch(e){if(isChatClosedError(e))showClosedChat();else showError(e&&e.message||'Не удалось загрузить сообщения.')}
    if(!chatClosed)scheduleLive(LIVE_REFRESH_MS)
  }
  function close(){stopLive();dead=true;state=null;rows=[];chatClosed=false;setBusy(false);clearError();closeLightbox();closeReactionMenu()}

  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state&&!dead&&!chatClosed)scheduleLive(250)});

  $('parentChatBack').onclick=()=>{if(state&&typeof state.onBack==='function')state.onBack()};
  $('parentChatCompose').onsubmit=async e=>{
    e.preventDefault();if(!state||busy||chatClosed)return;const text=$('parentChatInput').value.trim();if(!text)return;
    setBusy(true);const optimistic={side:'parent',type:'text',text,timestamp:Date.now(),messageKey:'pending-'+Date.now().toString(36)};
    render(rows.concat(optimistic),{stick:true});$('parentChatInput').value='';
    try{await t.sendMessage(state.session,'parent',state.phone,{type:'text',text});await refresh({stick:true,fresh:true})}
    catch(err){if(isChatClosedError(err))showClosedChat();else{showError(err&&err.message||'Не удалось отправить сообщение.');await refresh({stick:true,fresh:true}).catch(()=>{})}}
    finally{setBusy(false);if(!chatClosed)$('parentChatInput').focus()}
  };
  $('parentChatAttach').onclick=()=>{if(!chatClosed)$('parentChatFile').click()};
  $('parentChatFile').onchange=async()=>{
    if(!state||busy||chatClosed)return;const input=$('parentChatFile'),f=input.files&&input.files[0];input.value='';if(!f)return;
    if(!/^image\//i.test(f.type)&&!/^video\//i.test(f.type)){showError('Можно прикреплять только фото или видео.');return}
    const maxBytes=Number(t.maxUploadBytes||100*1024*1024);if(f.size>maxBytes){showError('Размер файла не должен превышать 100 МБ.');return}
    setBusy(true);clearError();
    try{const up=await t.upload(state.session,state.phone,f);await t.sendMessage(state.session,'parent',state.phone,{type:up.type||(f.type.startsWith('video/')?'video':'image'),text:'',fileId:up.fileId});await refresh({stick:true,fresh:true})}
    catch(err){if(isChatClosedError(err))showClosedChat();else showError(err&&err.message||'Не удалось отправить файл.')}
    finally{setBusy(false)}
  };

  window.MedsiParentChatScreen={open,close,refresh};
})();
