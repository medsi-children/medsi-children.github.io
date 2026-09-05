(function(){
  const $=id=>document.getElementById(id);
  const t=window.MedsiOverlayTransport;
  if(!t)return;
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
  let state=null,rows=[],busy=false,dead=false,lightbox=null;

  function mediaUrl(m){
    const id=String(m&&m.fileId||'');if(!id)return'';
    if(id.startsWith('kv:')||id.startsWith('r2:'))return t.baseUrl+'/media/'+encodeURIComponent(id.slice(3));
    return 'https://drive.google.com/thumbnail?id='+encodeURIComponent(id)+'&sz=w1600';
  }
  function nearBottom(){const box=$('parentChatMessages');return !box||box.scrollHeight-box.scrollTop-box.clientHeight<90}
  function scrollBottom(smooth){const box=$('parentChatMessages');if(!box)return;requestAnimationFrame(()=>box.scrollTo({top:box.scrollHeight,behavior:smooth?'smooth':'auto'}))}
  function showError(msg){const e=$('parentChatError');if(!e)return;e.textContent=String(msg||'Не удалось открыть чат.');e.classList.remove('hidden')}
  function clearError(){const e=$('parentChatError');if(!e)return;e.textContent='';e.classList.add('hidden')}
  function setBusy(v){busy=!!v;$('parentChatInput').disabled=busy;$('parentChatSend').disabled=busy;$('parentChatAttach').disabled=busy}

  function closeLightbox(){if(!lightbox)return;lightbox.remove();lightbox=null}
  function openLightbox(src,alt){
    closeLightbox();
    const root=document.createElement('div');root.className='parent-chat-lightbox';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Просмотр фотографии');
    const img=document.createElement('img');img.src=src;img.alt=alt||'Фотография из чата';
    const close=document.createElement('button');close.type='button';close.className='parent-chat-lightbox-close';close.setAttribute('aria-label','Закрыть фотографию');close.textContent='×';
    close.onclick=closeLightbox;root.onclick=e=>{if(e.target===root)closeLightbox()};
    root.append(img,close);document.body.appendChild(root);lightbox=root;
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeLightbox()});

  function render(list,opts){
    const box=$('parentChatMessages');if(!box)return;
    const stick=opts&&opts.stick!==undefined?!!opts.stick:nearBottom();
    const oldHeight=box.scrollHeight,oldTop=box.scrollTop;
    rows=Array.isArray(list)?list:[];box.replaceChildren();
    if(!rows.length){const e=document.createElement('div');e.className='parent-chat-empty';e.textContent='Сообщений пока нет.';box.appendChild(e);return}
    rows.forEach(m=>{
      const el=document.createElement('article');el.className='parent-chat-msg '+(m.side==='parent'?'parent':'educator');
      if(m.side!=='parent'){const a=document.createElement('div');a.className='parent-chat-author';a.textContent='Воспитатель';el.appendChild(a)}
      const u=mediaUrl(m);
      if(u){
        const frame=document.createElement('div');frame.className='parent-chat-media-frame';
        const md=document.createElement(m.type==='video'?'video':'img');md.className='parent-chat-media';md.src=u;
        if(m.type==='video'){
          frame.style.cursor='default';md.controls=true;md.preload='metadata';md.onloadedmetadata=()=>{md.classList.add('is-loaded');if(stick)scrollBottom(false)}
        } else {
          md.alt='Фотография из чата';
          md.onload=()=>{md.classList.add('is-loaded');if(stick)scrollBottom(false)};
          frame.onclick=e=>{e.preventDefault();e.stopPropagation();openLightbox(u,md.alt)};
        }
        frame.appendChild(md);el.appendChild(frame)
      }
      if(m.text){const b=document.createElement('div');b.textContent=String(m.text);el.appendChild(b)}
      if(m.reaction){const r=document.createElement('span');r.className='parent-chat-reaction';r.textContent=String(m.reaction);el.appendChild(r)}
      const tm=document.createElement('span');tm.className='parent-chat-time';tm.textContent=fmt(m.timestamp);el.appendChild(tm);box.appendChild(el)
    });
    requestAnimationFrame(()=>{
      if(stick)box.scrollTop=box.scrollHeight;
      else box.scrollTop=Math.max(0,oldTop+(box.scrollHeight-oldHeight));
    })
  }

  async function fetchThread(){
    const res=await t.thread(state.session,state.phone,'',100);
    return Array.isArray(res&&res.messages)?res.messages:[];
  }
  async function refresh(opts){
    const list=await fetchThread();if(dead)return;render(list,opts||{});t.markRead(state.session,'parent',state.phone).catch(()=>{});return list
  }

  async function open(next){
    dead=false;state={...next,phone:p10(next&&next.phone)};clearError();
    $('parentChatChild').textContent=state.childName||state.parentName||'Ребёнок';
    $('parentChatPhone').textContent=state.phone?'8'+state.phone:'';
    $('parentChatInput').value='';
    const cached=window.MedsiParentPrewarm?await MedsiParentPrewarm.ready(state.phone).catch(()=>null):null;
    if(cached&&Array.isArray(cached.messages))render(cached.messages,{stick:true});
    else $('parentChatMessages').innerHTML='<div class="parent-chat-empty">Загружаем сообщения…</div>';
    try{await refresh({stick:true})}catch(e){showError(e&&e.message||'Не удалось загрузить сообщения.')}
  }
  function close(){dead=true;state=null;rows=[];setBusy(false);clearError();closeLightbox()}

  $('parentChatBack').onclick=()=>{if(state&&typeof state.onBack==='function')state.onBack()};
  $('parentChatCompose').onsubmit=async e=>{
    e.preventDefault();if(!state||busy)return;const text=$('parentChatInput').value.trim();if(!text)return;
    setBusy(true);const optimistic={side:'parent',type:'text',text,timestamp:Date.now(),messageKey:'pending-'+Date.now().toString(36)};
    render(rows.concat(optimistic),{stick:true});$('parentChatInput').value='';
    try{await t.sendMessage(state.session,'parent',state.phone,{type:'text',text});await refresh({stick:true})}
    catch(err){showError(err&&err.message||'Не удалось отправить сообщение.');await refresh({stick:true}).catch(()=>{})}
    finally{setBusy(false);$('parentChatInput').focus()}
  };
  $('parentChatInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('parentChatCompose').requestSubmit()}};
  $('parentChatAttach').onclick=()=>$('parentChatFile').click();
  $('parentChatFile').onchange=async()=>{
    if(!state||busy)return;const input=$('parentChatFile'),f=input.files&&input.files[0];input.value='';if(!f)return;
    if(!/^image\//i.test(f.type)&&!/^video\//i.test(f.type)){showError('Можно прикреплять только фото или видео.');return}
    if(f.size>20*1024*1024){showError('Размер файла не должен превышать 20 МБ.');return}
    setBusy(true);clearError();
    try{const up=await t.upload(state.session,state.phone,f);await t.sendMessage(state.session,'parent',state.phone,{type:up.type||(f.type.startsWith('video/')?'video':'image'),text:'',fileId:up.fileId});await refresh({stick:true})}
    catch(err){showError(err&&err.message||'Не удалось отправить файл.')}
    finally{setBusy(false)}
  };

  window.MedsiParentChatScreen={open,close,refresh};
})();
