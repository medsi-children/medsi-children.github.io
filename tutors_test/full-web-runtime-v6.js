(function(){
  const transport=window.MedsiOverlayTransport;
  if(!transport)return;

  let session=null;
  const threadCache=new Map();
  const chatCache=new Map();
  let parentsCache=null;
  const THREAD_TTL=30000;
  const LIST_TTL=15000;
  const orig={thread:transport.thread.bind(transport),chats:transport.chats.bind(transport),parents:transport.parents.bind(transport)};
  const phone10=v=>String(v||'').replace(/\D+/g,'').slice(-10);

  function valid(entry,ttl){return !!entry&&Date.now()-entry.at<ttl}
  function clonePayload(v){return v&&typeof v==='object'?v:v}

  transport.thread=async function(s,phone,beforeKey,limit){
    const key=phone10(phone);
    if(!beforeKey&&key&&valid(threadCache.get(key),THREAD_TTL)){
      const cached=threadCache.get(key).value;
      orig.thread(s,phone,beforeKey,limit).then(v=>threadCache.set(key,{at:Date.now(),value:v})).catch(()=>{});
      return clonePayload(cached);
    }
    const v=await orig.thread(s,phone,beforeKey,limit);
    if(!beforeKey&&key)threadCache.set(key,{at:Date.now(),value:v});
    return v;
  };

  transport.chats=async function(s,bucket){
    const key=String(bucket||'all');
    if(valid(chatCache.get(key),LIST_TTL)){
      const cached=chatCache.get(key).value;
      orig.chats(s,bucket).then(v=>chatCache.set(key,{at:Date.now(),value:v})).catch(()=>{});
      return clonePayload(cached);
    }
    const v=await orig.chats(s,bucket);chatCache.set(key,{at:Date.now(),value:v});return v;
  };

  transport.parents=async function(s){
    if(valid(parentsCache,LIST_TTL)){
      const cached=parentsCache.value;
      orig.parents(s).then(v=>parentsCache={at:Date.now(),value:v}).catch(()=>{});
      return clonePayload(cached);
    }
    const v=await orig.parents(s);parentsCache={at:Date.now(),value:v};return v;
  };

  async function prewarm(s){
    if(!s||!s.token)return;session=s;
    try{
      const results=await Promise.allSettled([orig.chats(s,'unread'),orig.chats(s,'read'),orig.parents(s)]);
      const phones=new Set();
      if(results[0].status==='fulfilled'){chatCache.set('unread',{at:Date.now(),value:results[0].value});(results[0].value.chats||[]).forEach(x=>phones.add(phone10(x.phone)))}
      if(results[1].status==='fulfilled'){chatCache.set('read',{at:Date.now(),value:results[1].value});(results[1].value.chats||[]).forEach(x=>phones.add(phone10(x.phone)))}
      if(results[2].status==='fulfilled'){parentsCache={at:Date.now(),value:results[2].value};const rows=results[2].value.parents||results[2].value.rows||[];rows.forEach(x=>phones.add(phone10(x.phone)))}
      const queue=[...phones].filter(Boolean);let cursor=0;
      async function worker(){while(cursor<queue.length){const p=queue[cursor++];try{const v=await orig.thread(s,p,'',100);threadCache.set(p,{at:Date.now(),value:v})}catch(_){}}}
      Promise.all([worker(),worker(),worker()]).catch(()=>{});
    }catch(_){}
  }

  function dropPhone(phone){const p=phone10(phone);threadCache.delete(p);parentsCache=null;for(const key of chatCache.keys())chatCache.delete(key)}

  function markImageLoaded(img){
    if(!img||img.tagName!=='IMG')return;
    const wrap=img.closest('.msg-image-wrap');if(!wrap)return;
    img.classList.add('msg-image');
    const done=()=>{img.classList.add('loaded');wrap.classList.add('loaded')};
    if(img.complete&&img.naturalWidth>0)requestAnimationFrame(done);else{img.addEventListener('load',done,{once:true});img.addEventListener('error',done,{once:true})}
  }

  function parseVideoPayload(text){
    try{const p=JSON.parse(String(text||'').trim());return p&&p.videoUrl?{videoUrl:String(p.videoUrl),videoTitle:String(p.videoTitle||''),caption:String(p.caption||'')}:null}catch(_){return null}
  }
  function upgradeVideoMessage(msg){
    if(!msg||msg.dataset.videoUpgraded==='1')return;
    const body=msg.querySelector('.msg-body');if(!body)return;
    const meta=parseVideoPayload(body.textContent);if(!meta)return;
    const oldWrap=msg.querySelector('.msg-image-wrap,.msg-video-wrap');
    let thumb='';const media=oldWrap&&oldWrap.querySelector('img,video');if(media)thumb=media.currentSrc||media.src||'';
    const link=document.createElement('a');link.className='msg-video-link-card';link.href=meta.videoUrl;link.target='_blank';link.rel='noopener noreferrer';
    if(thumb){const img=document.createElement('img');img.src=thumb;img.alt=meta.videoTitle||'Видео';link.appendChild(img)}
    const play=document.createElement('span');play.className='msg-video-play';play.innerHTML='<span>▶</span>';link.appendChild(play);
    if(oldWrap)oldWrap.replaceWith(link);else msg.insertBefore(link,body);
    if(meta.videoTitle){const title=document.createElement('div');title.className='msg-video-title';title.textContent=meta.videoTitle;link.after(title)}
    if(meta.caption)body.textContent=meta.caption;else body.remove();
    msg.dataset.videoUpgraded='1';
  }

  function animateVisibleScreen(node){
    if(!node||node.classList.contains('hidden'))return;
    if(!/^screen/.test(node.id||''))return;
    node.classList.remove('fullweb-soft-enter');void node.offsetWidth;node.classList.add('fullweb-soft-enter');setTimeout(()=>node.classList.remove('fullweb-soft-enter'),320)
  }

  function moveNewChatBackTop(root){
    const screen=root.querySelector('#screenNewChat');if(!screen)return;
    const row=[...screen.children].find(x=>x.classList&&x.classList.contains('row')&&x.querySelector('#btnParentsBack'));
    if(row&&screen.firstElementChild!==row)screen.insertBefore(row,screen.firstElementChild)
  }

  function activePhone(root){
    const text=(root.querySelector('#chatThreadHeader')||{}).textContent||'';const d=text.replace(/\D+/g,'');return d.slice(-10)
  }

  function ensureVideoComposer(root,state){
    let modal=document.getElementById('fullWebVideoComposer');if(modal)return modal;
    modal=document.createElement('div');modal.id='fullWebVideoComposer';modal.className='link-modal-overlay hidden';modal.innerHTML='<div class="link-modal"><h3 class="link-modal-title">Прикрепить видео</h3><div class="link-modal-field"><label for="fullWebVideoUrl">Ссылка на видео Google Drive *</label><input id="fullWebVideoUrl" type="url" placeholder="Ссылка"></div><div class="link-modal-field"><label for="fullWebVideoTitle">Название видео</label><input id="fullWebVideoTitle" type="text" maxlength="120" placeholder="Введите название"></div><div class="link-modal-field"><label>Обложка видео</label><div class="video-thumb-row"><button id="fullWebVideoThumbBtn" class="btn" type="button">Выбрать изображение</button><input id="fullWebVideoThumbInput" type="file" accept="image/*" class="hidden"><div id="fullWebVideoThumbPreview" class="video-thumb-preview hidden"><img alt="Обложка"></div></div></div><p id="fullWebVideoError" class="error hidden"></p><div class="link-modal-actions"><button id="fullWebVideoCancel" class="link-modal-cancel" type="button">Отмена</button><button id="fullWebVideoSave" class="link-modal-save" type="button">Отправить</button></div></div>';
    document.body.appendChild(modal);
    const input=modal.querySelector('#fullWebVideoThumbInput'),preview=modal.querySelector('#fullWebVideoThumbPreview'),img=preview.querySelector('img');
    let cover=null;
    modal.querySelector('#fullWebVideoThumbBtn').onclick=()=>input.click();
    input.onchange=()=>{cover=input.files&&input.files[0]||null;if(!cover)return;const u=URL.createObjectURL(cover);img.onload=()=>URL.revokeObjectURL(u);img.src=u;preview.classList.remove('hidden')};
    const close=()=>{modal.classList.add('hidden');modal.querySelector('#fullWebVideoError').classList.add('hidden')};
    modal.querySelector('#fullWebVideoCancel').onclick=close;modal.onclick=e=>{if(e.target===modal)close()};
    modal.querySelector('#fullWebVideoSave').onclick=async()=>{
      const phone=activePhone(root),url=modal.querySelector('#fullWebVideoUrl').value.trim(),title=modal.querySelector('#fullWebVideoTitle').value.trim(),err=modal.querySelector('#fullWebVideoError'),save=modal.querySelector('#fullWebVideoSave');
      if(!phone){err.textContent='Не удалось определить чат.';err.classList.remove('hidden');return}
      if(!/^https?:\/\//i.test(url)||(!url.includes('drive.google')&&!url.includes('youtube'))){err.textContent='Введите ссылку Google Drive или YouTube.';err.classList.remove('hidden');return}
      err.classList.add('hidden');save.disabled=true;
      try{
        let fileId='';if(cover){if(!/^image\//i.test(cover.type))throw new Error('Обложка должна быть изображением.');const up=await transport.upload(state.session,phone,cover);fileId=String(up.fileId||'')}
        const payload=JSON.stringify({videoUrl:url,videoTitle:title,caption:''});
        await transport.sendMessage(state.session,'educator',phone,{type:'video',text:payload,fileId:fileId,replyToKey:''});
        threadCache.delete(phone10(phone));chatCache.clear();
        const box=root.querySelector('#chatThreadBox');if(box){const msg=document.createElement('div');msg.className='msg educator fullweb-soft-enter';const a=document.createElement('a');a.className='msg-video-link-card';a.href=url;a.target='_blank';a.rel='noopener noreferrer';if(cover){const im=document.createElement('img');im.src=URL.createObjectURL(cover);a.appendChild(im)}const p=document.createElement('span');p.className='msg-video-play';p.innerHTML='<span>▶</span>';a.appendChild(p);msg.appendChild(a);if(title){const t=document.createElement('div');t.className='msg-video-title';t.textContent=title;msg.appendChild(t)}box.appendChild(msg);box.scrollTop=box.scrollHeight}
        close();cover=null;input.value='';preview.classList.add('hidden');modal.querySelector('#fullWebVideoUrl').value='';modal.querySelector('#fullWebVideoTitle').value='';
      }catch(e){err.textContent=String(e&&e.message||e);err.classList.remove('hidden')}finally{save.disabled=false}
    };
    return modal;
  }

  function enhanceMount(api,state){
    const root=api&&api.root?api.root:document;
    let pendingDeleteCard=null;
    const observer=new MutationObserver(muts=>{
      root.querySelectorAll('.msg-image-wrap img').forEach(markImageLoaded);
      root.querySelectorAll('.msg').forEach(upgradeVideoMessage);
      moveNewChatBackTop(root);
      muts.forEach(m=>{if(m.type==='attributes'&&m.attributeName==='class')animateVisibleScreen(m.target)});
    });
    observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    requestAnimationFrame(()=>{root.querySelectorAll('.msg-image-wrap img').forEach(markImageLoaded);root.querySelectorAll('.msg').forEach(upgradeVideoMessage);moveNewChatBackTop(root)});

    const capture=e=>{
      const del=e.target.closest&&e.target.closest('.chat-delete-toggle');if(del)pendingDeleteCard=del.closest('.chat-card')||del.closest('[data-phone]');
      if(e.target.closest&&e.target.closest('#childDeleteConfirm')&&pendingDeleteCard){const card=pendingDeleteCard;pendingDeleteCard=null;card.classList.add('is-deleting');setTimeout(()=>{if(card.isConnected)card.remove()},230)}
      const video=e.target.closest&&e.target.closest('#btnVideo');if(video){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();const modal=ensureVideoComposer(root,state);modal.classList.remove('hidden');setTimeout(()=>modal.querySelector('#fullWebVideoUrl').focus(),30)}
    };
    root.addEventListener('click',capture,true);
    return()=>{observer.disconnect();root.removeEventListener('click',capture,true)};
  }

  if(window.MedsiEducatorOverlayChat&&typeof MedsiEducatorOverlayChat.mount==='function'){
    const originalMount=MedsiEducatorOverlayChat.mount.bind(MedsiEducatorOverlayChat);
    MedsiEducatorOverlayChat.mount=function(api,state){const cleanup=originalMount(api,state);const extra=enhanceMount(api,state);return()=>{try{extra&&extra()}catch(_){}try{cleanup&&cleanup()}catch(_){}}};
  }

  window.MedsiFullWebRuntime={setSession(s){session=s||null},prewarm,dropPhone,clearThread(phone){threadCache.delete(phone10(phone))}};
})();