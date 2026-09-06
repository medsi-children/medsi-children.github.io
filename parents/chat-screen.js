(function(){
  const $=id=>document.getElementById(id);
  const t=window.MedsiOverlayTransport;
  if(!t)return;
  const REACTIONS=['❤️','👍','👌','🙏','🥰','😁','🔥'];
  const LIVE_REFRESH_MS=5000;
  const p10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  const fmt=v=>{
    const d=new Date(Number(v));if(Number.isNaN(d.getTime()))return'';
    const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),day=new Date(d.getFullYear(),d.getMonth(),d.getDate());
    const diff=Math.round((today-day)/86400000);
    const time=d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    if(diff===0)return'сегодня • '+time;
    if(diff===1)return'вчера • '+time;
    const months=['янв.','февр.','мар.','апр.','мая','июн.','июл.','авг.','сент.','окт.','нояб.','дек.'];
    return d.getDate()+' '+months[d.getMonth()]+' • '+time;
  };
  let state=null,rows=[],busy=false,dead=false,chatClosed=false,lightbox=null,reactionMenu=null,liveTimer=0,liveRunning=false;

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

  function render(list,opts){
    const box=$('parentChatMessages');if(!box)return;
    closeReactionMenu();
    const stick=opts&&opts.stick!==undefined?!!opts.stick:nearBottom();
    const preserveExact=!!(opts&&opts.preserveExact);
    const silent=!!(opts&&opts.silent);
    const oldHeight=box.scrollHeight,oldTop=box.scrollTop;
    rows=Array.isArray(list)?list:[];box.replaceChildren();
    if(!rows.length){const e=document.createElement('div');e.className='parent-chat-empty';e.textContent='Сообщений пока нет.';box.appendChild(e);return}
    rows.forEach(m=>{
      const el=document.createElement('article');el.className='parent-chat-msg '+(m.side==='parent'?'parent':'educator');
      if(silent)el.dataset.medsiAnimated='1';
      if(m.side!=='parent'){const a=document.createElement('div');a.className='parent-chat-author';a.textContent='Воспитатель';el.appendChild(a)}
      const u=mediaUrl(m);
      if(u){
        const frame=document.createElement('div');frame.className='parent-chat-media-frame';
        const md=document.createElement(m.type==='video'?'video':'img');md.className='parent-chat-media';md.src=u;
        if(m.type==='video'){
          frame.style.cursor='default';md.controls=true;md.preload='metadata';md.onloadedmetadata=()=>{md.classList.add('is-loaded');if(stick&&nearBottom())scrollBottom(false)}
        } else {
          md.alt='Фотография из чата';
          md.onload=()=>{md.classList.add('is-loaded');if(stick&&nearBottom())scrollBottom(false)};
          frame.onclick=e=>{e.preventDefault();e.stopPropagation();openLightbox(u,md.alt)};
        }
        frame.appendChild(md);el.appendChild(frame)
      }
      if(m.text){const b=document.createElement('div');b.textContent=String(m.text);el.appendChild(b)}
      if(m.reaction){const r=document.createElement('span');r.className='parent-chat-reaction';r.textContent=String(m.reaction);el.appendChild(r)}
      const tm=document.createElement('span');tm.className='parent-chat-time';tm.textContent=fmt(m.timestamp);el.appendChild(tm);
      el.onclick=e=>{if(e.target.closest('img,video,button,.parent-chat-reaction'))return;e.preventDefault();e.stopPropagation();openReactionMenu(m,el)};
      box.appendChild(el)
    });
    requestAnimationFrame(()=>{
      if(stick)box.scrollTop=box.scrollHeight;
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
      render(list,{stick,silent:!!opts.silent,preserveExact:!!opts.background&&!stick});
    }else rows=list;
    if((changed||opts.forceRead)&&!chatClosed){
      t.markRead(state.session,'parent',state.phone).catch(err=>{if(isChatClosedError(err))showClosedChat()});
    }
    return list
  }

  async function open(next){
    stopLive();dead=false;chatClosed=false;state={...next,phone:p10(next&&next.phone)};rows=[];clearError();closeReactionMenu();setBusy(false);
    $('parentChatChild').textContent=state.childName||state.parentName||'Ребёнок';
    $('parentChatPhone').textContent=state.phone?'8'+state.phone:'';
    $('parentChatInput').value='';
    const cached=window.MedsiParentPrewarm?await MedsiParentPrewarm.ready(state.phone).catch(()=>null):null;
    const hasCached=!!(cached&&Array.isArray(cached.messages));
    if(hasCached)render(cached.messages,{stick:true});
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
  $('parentChatInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('parentChatCompose').requestSubmit()}};
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