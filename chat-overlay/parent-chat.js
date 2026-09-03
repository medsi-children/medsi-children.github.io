(function () {
  const REACTIONS = ['❤️','👍','👌','🙏','🥰','😁'];
  const threadCache = new Map();

  function cacheKey(phone){ return String(phone||'').replace(/\D+/g,'').slice(-10); }
  function getCachedThread(phone){ return threadCache.get(cacheKey(phone)) || null; }
  function setCachedThread(phone,rows){ threadCache.set(cacheKey(phone),{rows:Array.isArray(rows)?rows:[],at:Date.now()}); }
  function formatTime(value){ const d=new Date(Number(value)); return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); }
  function mediaUrl(message){ const fileId=String(message&&message.fileId||''); if(!fileId)return ''; if(fileId.startsWith('kv:')||fileId.startsWith('r2:'))return window.MedsiOverlayTransport.baseUrl+'/media/'+encodeURIComponent(fileId.slice(3)); return 'https://drive.google.com/thumbnail?id='+encodeURIComponent(fileId)+'&sz=w1200'; }
  function replyLabel(reply){ if(!reply)return ''; if(reply.text)return String(reply.text).slice(0,120); if(reply.type==='image')return 'Фотография'; if(reply.type==='video')return 'Видео'; return 'Сообщение'; }

  function installParentSkin(){
    if(document.getElementById('medsi-parent-overlay-skin')) return;
    const style=document.createElement('style');
    style.id='medsi-parent-overlay-skin';
    style.textContent=`
      .medsi-chat-overlay:has(.overlay-parent-chat){background:#dfecef}
      .medsi-chat-overlay:has(.overlay-parent-chat) .medsi-chat-overlay__header{
        background:rgba(255,255,255,.96);box-shadow:0 1px 0 rgba(20,76,83,.07);border-bottom:0
      }
      .medsi-chat-overlay:has(.overlay-parent-chat) .medsi-chat-overlay__back{
        background:transparent;border-radius:50%;color:#1597a1;font-size:31px
      }
      .medsi-chat-overlay:has(.overlay-parent-chat) .medsi-chat-overlay__title{font-size:17px;font-weight:750;letter-spacing:-.015em}
      .medsi-chat-overlay:has(.overlay-parent-chat) .medsi-chat-overlay__subtitle{font-size:12px;color:#78959a}
      .overlay-parent-chat .overlay-thread__messages{
        background-color:#e7f1f2;
        background-image:linear-gradient(rgba(230,241,242,.80),rgba(230,241,242,.80)),url('/background.png');
        background-size:420px auto;background-repeat:repeat;
        padding:16px 11px 20px;gap:5px
      }
      .overlay-parent-chat .overlay-parent-notice{
        width:min(520px,calc(100% - 22px));align-self:center;margin:10px auto 4px;padding:9px 13px;
        border:0;border-radius:14px;background:rgba(255,255,255,.82);box-shadow:0 2px 10px rgba(20,71,78,.06);
        color:#617d82;font-size:11.5px;line-height:1.38
      }
      .overlay-parent-chat .overlay-msg__bubble{
        max-width:min(78%,560px);padding:7px 10px 5px;border-radius:16px;box-shadow:0 1px 2px rgba(19,62,68,.12)
      }
      .overlay-parent-chat .overlay-msg--own .overlay-msg__bubble{
        background:#bfeff0;color:#153f46;border-bottom-right-radius:5px
      }
      .overlay-parent-chat .overlay-msg--other .overlay-msg__bubble{
        background:#fff;color:#153f46;border-bottom-left-radius:5px
      }
      .overlay-parent-chat .overlay-msg__sender{font-size:11px;color:#13919a;margin-bottom:2px}
      .overlay-parent-chat .overlay-msg__text{font-size:14.5px;line-height:1.36}
      .overlay-parent-chat .overlay-msg__meta{font-size:9.5px;color:#6e8c91;opacity:.92;margin-top:2px}
      .overlay-parent-chat .overlay-msg__reply{background:rgba(20,161,171,.08);border-left-color:#19a6af;border-radius:6px;padding:5px 7px}
      .overlay-parent-chat .overlay-msg__media-wrap{margin:-1px -4px 6px;border-radius:12px}
      .overlay-parent-chat .overlay-composer{
        padding:7px 9px calc(7px + env(safe-area-inset-bottom));gap:6px;background:rgba(255,255,255,.97);border-top:0;
        box-shadow:0 -1px 0 rgba(19,71,78,.07)
      }
      .overlay-parent-chat .overlay-composer__attach{
        background:transparent;color:#1597a1;font-size:26px;box-shadow:none
      }
      .overlay-parent-chat .overlay-composer__input{
        min-height:40px;border:1px solid rgba(25,117,125,.13);background:#f5f9f9;border-radius:20px;padding:9px 13px;
        box-shadow:inset 0 1px 1px rgba(16,62,68,.03)
      }
      .overlay-parent-chat .overlay-composer__send{
        background:#19b7c0;box-shadow:none;width:40px;height:40px;flex-basis:40px
      }
      @media(max-width:720px){
        .overlay-parent-chat .overlay-thread__messages{padding:12px 7px 16px;background-size:350px auto}
        .overlay-parent-chat .overlay-msg__bubble{max-width:88%}
        .overlay-parent-chat .overlay-parent-notice{width:calc(100% - 14px);margin-top:7px}
      }
    `;
    document.head.appendChild(style);
  }

  function mount(overlay,state){
    installParentSkin();
    const transport=window.MedsiOverlayTransport;
    const phone=String(state&&state.phone||'');
    const session=state&&state.session;
    if(!overlay||!transport||!phone||!session||!session.token){ if(overlay)overlay.showError('Не удалось получить данные родительского чата.'); return; }

    overlay.body.replaceChildren();
    const shell=document.createElement('div'); shell.className='overlay-thread overlay-parent-chat';
    const notice=document.createElement('div'); notice.className='overlay-parent-notice'; notice.textContent='Пожалуйста, пишите по делу. Воспитатели находятся с детьми и не всегда могут ответить сразу.';
    const list=document.createElement('div'); list.className='overlay-thread__messages';
    const cached=getCachedThread(phone); const cachedHasMessages=!!(cached&&Array.isArray(cached.rows)&&cached.rows.length);
    if(!cachedHasMessages){ const loading=document.createElement('div'); loading.className='overlay-thread__loading'; loading.textContent='Загружаем сообщения…'; list.appendChild(loading); }

    const replyBar=document.createElement('div'); replyBar.className='overlay-reply-bar hidden';
    const replyText=document.createElement('span'); const replyClose=document.createElement('button'); replyClose.type='button'; replyClose.textContent='×'; replyBar.append(replyText,replyClose);
    const editBar=document.createElement('div'); editBar.className='overlay-edit-bar hidden';
    const editText=document.createElement('span'); const editClose=document.createElement('button'); editClose.type='button'; editClose.textContent='×'; editBar.append(editText,editClose);
    const uploadPreview=document.createElement('div'); uploadPreview.className='overlay-upload-preview hidden';
    const uploadThumb=document.createElement('img'); uploadThumb.className='overlay-upload-preview__thumb';
    const uploadInfo=document.createElement('div'); uploadInfo.className='overlay-upload-preview__info';
    const uploadName=document.createElement('span'); uploadName.className='overlay-upload-preview__name';
    const uploadKind=document.createElement('span'); uploadKind.className='overlay-upload-preview__kind';
    uploadInfo.append(uploadName,uploadKind); const uploadClose=document.createElement('button'); uploadClose.type='button'; uploadClose.textContent='×'; uploadPreview.append(uploadThumb,uploadInfo,uploadClose);

    const composer=document.createElement('form'); composer.className='overlay-composer';
    const attach=document.createElement('button'); attach.type='button'; attach.className='overlay-composer__attach'; attach.textContent='＋'; attach.setAttribute('aria-label','Прикрепить фото или видео');
    const fileInput=document.createElement('input'); fileInput.type='file'; fileInput.accept='image/*,video/*'; fileInput.hidden=true;
    const input=document.createElement('textarea'); input.className='overlay-composer__input'; input.rows=1; input.placeholder='Сообщение…'; input.maxLength=4000;
    const send=document.createElement('button'); send.type='submit'; send.className='overlay-composer__send'; send.textContent='➤'; send.setAttribute('aria-label','Отправить');
    composer.append(attach,fileInput,input,send);

    const shade=document.createElement('div'); shade.className='overlay-context-shade hidden';
    const menu=document.createElement('div'); menu.className='overlay-context-menu hidden';
    document.body.append(shade,menu);

    shell.append(notice,list,replyBar,editBar,uploadPreview,composer); overlay.body.appendChild(shell);

    let messages=[]; let sending=false; let replyTo=null; let editing=null; let pendingFile=null; let pendingPreviewUrl=''; let disposed=false;

    function setReply(message){ replyTo=message||null; replyBar.classList.toggle('hidden',!replyTo); replyText.textContent=replyTo?'Ответ на сообщение: '+replyLabel(replyTo):''; if(replyTo){ editing=null; editBar.classList.add('hidden'); input.focus(); } }
    function setEditing(message){ editing=message||null; editBar.classList.toggle('hidden',!editing); editText.textContent=editing?'Редактирование сообщения':''; if(editing){ replyTo=null; replyBar.classList.add('hidden'); input.value=String(editing.text||''); input.focus(); input.setSelectionRange(input.value.length,input.value.length); } }
    function clearPendingFile(){ pendingFile=null; uploadPreview.classList.add('hidden'); if(pendingPreviewUrl){ URL.revokeObjectURL(pendingPreviewUrl); pendingPreviewUrl=''; } uploadThumb.removeAttribute('src'); }
    replyClose.addEventListener('click',()=>setReply(null)); editClose.addEventListener('click',()=>{ setEditing(null); input.value=''; }); uploadClose.addEventListener('click',clearPendingFile);

    function closeMenu(){ shade.classList.add('hidden'); menu.classList.add('hidden'); menu.replaceChildren(); }
    shade.addEventListener('click',closeMenu);
    function menuAction(icon,label,handler,danger){ const b=document.createElement('button'); b.type='button'; b.className='overlay-context-action'+(danger?' danger':''); const i=document.createElement('span'); i.className='overlay-context-icon'; i.textContent=icon; const t=document.createElement('span'); t.textContent=label; b.append(i,t); b.addEventListener('click',()=>{ closeMenu(); handler(); }); return b; }
    function openMenu(message,bubble,event){
      if(!message||!message.messageKey||String(message.messageKey).startsWith('pending-'))return;
      event&&event.preventDefault(); event&&event.stopPropagation(); menu.replaceChildren();
      const reactions=document.createElement('div'); reactions.className='overlay-context-reactions'; REACTIONS.forEach(r=>{ const b=document.createElement('button'); b.type='button'; b.textContent=r; b.addEventListener('click',async()=>{ closeMenu(); try{ await transport.react(session,message.messageKey,r); await refresh({preserveScroll:true}); }catch(e){ overlay.showError(e.message); } }); reactions.appendChild(b); }); menu.appendChild(reactions);
      const actions=document.createElement('div'); actions.className='overlay-context-actions'; actions.appendChild(menuAction('↩','Ответить',()=>setReply(message)));
      const own=message.side==='parent';
      if(own&&message.type==='text')actions.appendChild(menuAction('✎','Редактировать',()=>setEditing(message)));
      if(own)actions.appendChild(menuAction('⌫','Удалить',async()=>{ if(!window.confirm('Удалить это сообщение?'))return; try{ await transport.remove(session,'parent',message.messageKey); await refresh({preserveScroll:true}); }catch(e){ overlay.showError(e.message); } },true));
      menu.appendChild(actions); shade.classList.remove('hidden'); menu.classList.remove('hidden');
      if(window.matchMedia('(max-width:720px)').matches)return;
      const r=bubble.getBoundingClientRect(); const w=290; let left=Math.min(window.innerWidth-w-12,Math.max(12,r.left+(r.width-w)/2)); let top=r.bottom+8; if(top+220>window.innerHeight)top=Math.max(12,r.top-220); menu.style.left=left+'px'; menu.style.top=top+'px';
    }

    function createMessageNode(message){
      const own=message&&message.side==='parent'; const item=document.createElement('article'); item.className='overlay-msg '+(own?'overlay-msg--own':'overlay-msg--other');
      const bubble=document.createElement('div'); bubble.className='overlay-msg__bubble';
      if(!own){ const sender=document.createElement('div'); sender.className='overlay-msg__sender'; sender.textContent='Воспитатель'; bubble.appendChild(sender); }
      if(message&&message.reply){ const q=document.createElement('div'); q.className='overlay-msg__reply'; q.textContent=replyLabel(message.reply); bubble.appendChild(q); }
      const url=mediaUrl(message); if(url){ const wrap=document.createElement('div'); wrap.className='overlay-msg__media-wrap'; const media=document.createElement(message.type==='video'?'video':'img'); media.className='overlay-msg__media'; media.src=url; if(message.type==='video'){ media.controls=true; media.preload='metadata'; const badge=document.createElement('span'); badge.className='overlay-msg__video-badge'; badge.textContent='▶ Видео'; wrap.append(media,badge); } else wrap.appendChild(media); bubble.appendChild(wrap); }
      if(message&&message.text){ const body=document.createElement('div'); body.className='overlay-msg__text'; body.textContent=String(message.text); bubble.appendChild(body); }
      const meta=document.createElement('div'); meta.className='overlay-msg__meta'; meta.textContent=[message&&message.reaction||'',formatTime(message&&message.timestamp),message&&message.editedAt?'изм.':''].filter(Boolean).join(' · '); bubble.appendChild(meta);
      bubble.addEventListener('click',e=>openMenu(message,bubble,e)); bubble.addEventListener('contextmenu',e=>openMenu(message,bubble,e)); item.appendChild(bubble); return item;
    }

    function render(rows,stick=true){ messages=Array.isArray(rows)?rows:[]; list.replaceChildren(); if(!messages.length){ const empty=document.createElement('div'); empty.className='overlay-thread__empty'; empty.textContent='Здесь пока нет сообщений.'; list.appendChild(empty); } else messages.forEach(m=>list.appendChild(createMessageNode(m))); if(stick)requestAnimationFrame(()=>{list.scrollTop=list.scrollHeight;}); }
    if(cachedHasMessages)render(cached.rows);

    async function refresh(options){ const preserveScroll=options&&options.preserveScroll; const oldBottomGap=list.scrollHeight-list.scrollTop-list.clientHeight; try{ const result=await transport.thread(session,phone,'',100); if(disposed)return; const rows=result.messages||[]; setCachedThread(phone,rows); render(rows,!preserveScroll||oldBottomGap<80); if(preserveScroll&&oldBottomGap>80)list.scrollTop=Math.max(0,list.scrollHeight-list.clientHeight-oldBottomGap); transport.markRead(session,'parent',phone).catch(()=>{}); }catch(error){ if(!cachedHasMessages&&!messages.length)overlay.showError((error&&error.message)||'Не удалось загрузить чат.'); } }

    function setSending(value){ sending=!!value; send.disabled=sending; input.disabled=sending; attach.disabled=sending; }
    async function sendText(value){
      if(editing){ await transport.edit(session,'parent',editing.messageKey,value); setEditing(null); input.value=''; await refresh(); return; }
      await transport.sendMessage(session,'parent',phone,{type:'text',text:value,replyToKey:replyTo&&replyTo.messageKey||''}); setReply(null); input.value=''; await refresh();
    }
    async function sendFile(file){ const upload=await transport.upload(session,phone,file); await transport.sendMessage(session,'parent',phone,{type:upload.type||(file.type.startsWith('video/')?'video':'image'),text:String(input.value||'').trim(),fileId:upload.fileId,replyToKey:replyTo&&replyTo.messageKey||''}); input.value=''; setReply(null); clearPendingFile(); await refresh(); }

    composer.addEventListener('submit',async event=>{ event.preventDefault(); if(sending)return; const value=String(input.value||'').trim(); if(!value&&!pendingFile)return; setSending(true); try{ if(pendingFile)await sendFile(pendingFile); else await sendText(value); }catch(error){ overlay.showError((error&&error.message)||'Не удалось отправить сообщение.'); }finally{ setSending(false); input.focus(); } });
    attach.addEventListener('click',()=>{ if(!sending)fileInput.click(); });
    fileInput.addEventListener('change',()=>{ const file=fileInput.files&&fileInput.files[0]; fileInput.value=''; if(!file)return; clearPendingFile(); pendingFile=file; pendingPreviewUrl=URL.createObjectURL(file); uploadThumb.src=pendingPreviewUrl; uploadName.textContent=file.name||'Вложение'; uploadKind.textContent=file.type.startsWith('video/')?'Видео — будет отправлено с обложкой':'Фотография'; uploadPreview.classList.remove('hidden'); });
    input.addEventListener('keydown',event=>{ const mobile=window.matchMedia('(max-width:560px),(hover:none) and (pointer:coarse)').matches; if(!mobile&&event.key==='Enter'&&!event.shiftKey){ event.preventDefault(); composer.requestSubmit(); } });

    refresh({preserveScroll:cachedHasMessages}); const timer=setInterval(()=>{ if(!disposed&&overlay.getState())refresh({preserveScroll:true}); },8000);
    return function cleanup(){ disposed=true; clearInterval(timer); closeMenu(); clearPendingFile(); shade.remove(); menu.remove(); };
  }
  window.MedsiParentOverlayChat={mount};
})();
