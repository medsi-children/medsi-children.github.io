(function(){
  const t=window.MedsiOverlayTransport;
  if(!t||typeof t.upload!=='function'||t.__medsiUploadUxWrapped)return;
  t.__medsiUploadUxWrapped=true;

  const style=document.createElement('style');
  style.textContent=`
    .medsi-upload-status{display:flex;align-items:center;justify-content:center;gap:8px;min-height:24px;margin:7px 0 1px;color:#2aaeb7;font-size:.88rem;font-weight:700;opacity:0;transform:translateY(-3px);transition:opacity .18s ease,transform .18s ease;pointer-events:none}
    .medsi-upload-status.is-visible{opacity:1;transform:none}
    .medsi-upload-spinner{width:15px;height:15px;border:2px solid rgba(42,174,183,.22);border-top-color:#2aaeb7;border-radius:50%;animation:medsiUploadSpin .72s linear infinite;flex:0 0 auto}
    @keyframes medsiUploadSpin{to{transform:rotate(360deg)}}
    /* The message must reserve its media slot immediately.  Hiding this frame
       until decoding finishes creates a confusing empty bubble on slow links. */
    .parent-chat-media-frame,.msg-image-wrap{opacity:1;max-height:560px!important;margin-bottom:7px!important;transform:none}
  `;
  document.head.appendChild(style);

  function findAnchor(){
    const parent=document.querySelector('#screenChat:not(.hidden) #parentChatCompose');
    if(parent)return parent;
    const educator=document.querySelector('#screenChatThread:not(.hidden) #chatReplyEditor')||document.querySelector('#screenChatThread:not(.hidden) .chat-compose');
    return educator||null;
  }

  function statusEl(){
    let el=document.querySelector('.medsi-upload-status[data-active="1"]');
    if(el)return el;
    const anchor=findAnchor();if(!anchor)return null;
    el=document.createElement('div');el.className='medsi-upload-status';el.dataset.active='1';
    el.innerHTML='<span class="medsi-upload-spinner" aria-hidden="true"></span><span class="medsi-upload-label">Загрузка…</span>';
    const compose=anchor.closest('.parent-chat-compose,.chat-compose')||anchor;
    compose.insertAdjacentElement('afterend',el);
    requestAnimationFrame(()=>el.classList.add('is-visible'));
    return el;
  }

  function showStatus(file){
    const el=statusEl();if(!el)return null;
    const label=el.querySelector('.medsi-upload-label');
    if(label)label.textContent=file&&/^video\//i.test(file.type||'')?'Загрузка видео…':'Загрузка фотографии…';
    return el;
  }

  function hideStatus(el,delay){
    if(!el)return;
    setTimeout(()=>{el.classList.remove('is-visible');setTimeout(()=>el.remove(),190)},delay||0);
  }

  const originalUpload=t.upload.bind(t);
  t.upload=async function(session,phone,file){
    const el=showStatus(file);
    try{
      const result=await originalUpload(session,phone,file);
      const label=el&&el.querySelector('.medsi-upload-label');if(label)label.textContent='Отправляем…';
      hideStatus(el,700);
      return result;
    }catch(error){
      hideStatus(el,0);
      throw error;
    }
  };

  function markMedia(media){
    if(!media||media.dataset.medsiMediaUx==='1')return;
    media.dataset.medsiMediaUx='1';
    const wrap=media.closest('.parent-chat-media-frame,.msg-image-wrap');if(!wrap)return;
    const ready=()=>wrap.classList.add('medsi-media-ready');
    if(media.tagName==='IMG'){
      if(media.complete&&media.naturalWidth>0)ready();else media.addEventListener('load',ready,{once:true});
    }else{
      if(media.readyState>=1)ready();else media.addEventListener('loadedmetadata',ready,{once:true});
    }
  }

  function scan(root){
    if(root&&root.matches&&root.matches('.parent-chat-media-frame img,.parent-chat-media-frame video,.msg-image-wrap img,.msg-image-wrap video'))markMedia(root);
    (root&&root.querySelectorAll?root:document).querySelectorAll('.parent-chat-media-frame img,.parent-chat-media-frame video,.msg-image-wrap img,.msg-image-wrap video').forEach(markMedia);
  }
  scan(document);
  new MutationObserver(list=>list.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1)scan(n)}))).observe(document.body,{childList:true,subtree:true});
})();
