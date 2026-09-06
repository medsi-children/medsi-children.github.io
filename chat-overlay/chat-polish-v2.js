(function(){
  if(window.__medsiChatPolishV2)return;
  window.__medsiChatPolishV2=true;
  if(!document.querySelector('script[data-medsi-terminology-fix]')){const s=document.createElement('script');s.src='/chat-overlay/terminology-fix.js?v=20260906-1';s.dataset.medsiTerminologyFix='1';document.head.appendChild(s)}

  const style=document.createElement('style');
  style.textContent=`
    @keyframes medsiScreenIn{from{opacity:0;transform:translateY(8px) scale(.996)}to{opacity:1;transform:none}}
    @keyframes medsiMessageIn{from{opacity:0;transform:translateY(8px) scale(.992)}to{opacity:1;transform:none}}
    @keyframes medsiShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
    #screenChats.medsi-screen-enter,#screenChatThread.medsi-screen-enter,#screenChat.medsi-screen-enter{animation:medsiScreenIn .26s cubic-bezier(.22,.72,.28,1) both}
    #chatThreadBox .msg.medsi-message-enter,#parentChatMessages .parent-chat-msg.medsi-message-enter{animation:medsiMessageIn .24s cubic-bezier(.22,.72,.28,1) both;animation-delay:var(--medsi-message-delay,0ms)}
    .msg-image-wrap,.parent-chat-media-frame{position:relative;overflow:hidden;width:min(270px,68vw);max-width:100%;aspect-ratio:1/1;border-radius:12px;background:linear-gradient(100deg,rgba(223,244,245,.78) 20%,rgba(248,253,253,.98) 38%,rgba(223,244,245,.78) 56%);background-size:220% 100%;animation:medsiShimmer 1.15s linear infinite}
    .msg-image-wrap.medsi-media-ready,.parent-chat-media-frame.medsi-media-ready{animation:none;background:rgba(230,247,248,.72)}
    .msg-image-wrap img,.msg-image-wrap video,.parent-chat-media-frame img,.parent-chat-media-frame video{display:block!important;width:100%!important;height:100%!important;object-fit:cover!important;opacity:0;transform:scale(.985);transition:opacity .22s ease,transform .28s ease}
    .msg-image-wrap.medsi-media-ready img,.msg-image-wrap.medsi-media-ready video,.parent-chat-media-frame.medsi-media-ready img,.parent-chat-media-frame.medsi-media-ready video{opacity:1;transform:none}
    .medsi-media-error::after{content:'Не удалось загрузить вложение';position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:16px;color:#6d969a;font-size:13px;font-weight:700;background:#eef9fa}
    .msg-author,.parent-chat-author{letter-spacing:.01em}
    #btnRefreshChats{display:inline-flex!important;align-items:center!important;justify-content:center!important;padding:0!important;line-height:1!important}
    #btnRefreshChats .refresh-label{position:absolute!important;inset:0!important;display:flex!important;align-items:center!important;justify-content:center!important;width:auto!important;height:auto!important;font-size:2rem!important;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-weight:500;line-height:1!important;transform:translateY(-1px)!important}
    #btnRefreshChats.loading .refresh-label{display:none!important}
    @media (prefers-reduced-motion:reduce){#screenChats.medsi-screen-enter,#screenChatThread.medsi-screen-enter,#screenChat.medsi-screen-enter,#chatThreadBox .msg.medsi-message-enter,#parentChatMessages .parent-chat-msg.medsi-message-enter{animation:none!important}}
  `;
  document.head.appendChild(style);

  function parentName(){try{return String(localStorage.getItem('medsi_parent')||'').trim()}catch(_){return''}}
  function activeEducatorParentName(){const lines=[...document.querySelectorAll('#chatThreadHeader > div')].map(x=>String(x.textContent||''));const line=lines.find(x=>x.startsWith('Родитель:'))||'';return line.replace(/^Родитель:\s*/,'').trim()}

  function redrawRefresh(){const btn=document.getElementById('btnRefreshChats');if(!btn||btn.dataset.medsiRefreshV3==='1')return;btn.dataset.medsiRefreshV3='1';const label=btn.querySelector('.refresh-label');if(label)label.textContent='⟳'}

  function markMedia(frame){
    if(!frame||frame.dataset.medsiPolishedV2==='1')return;
    frame.dataset.medsiPolishedV2='1';
    const media=frame.querySelector('img,video');if(!media)return;
    const ready=()=>{frame.classList.add('medsi-media-ready');frame.classList.remove('medsi-media-error')};
    const fail=()=>{const tries=Number(media.dataset.medsiRetry||0);if(tries<1&&media.src){media.dataset.medsiRetry=String(tries+1);const src=media.src;setTimeout(()=>{media.src=src+(src.includes('?')?'&':'?')+'retry='+Date.now()},320)}else frame.classList.add('medsi-media-error')};
    if(media.tagName==='VIDEO'){media.addEventListener('loadeddata',ready,{once:true});media.addEventListener('loadedmetadata',ready,{once:true});media.addEventListener('error',fail);if(media.readyState>=1)ready()}
    else{media.addEventListener('load',ready,{once:true});media.addEventListener('error',fail);if(media.complete&&media.naturalWidth>0)ready()}
  }

  function fixAuthors(){
    const educatorParent=activeEducatorParentName();
    document.querySelectorAll('#chatThreadBox .msg').forEach(el=>{let author=el.querySelector('.msg-author');const text=el.classList.contains('parent')?'Родитель'+(educatorParent?' '+educatorParent:''):'Детское Отделение Медси';if(!author){author=document.createElement('div');author.className='msg-author';el.prepend(author)}if(author.textContent!==text)author.textContent=text});
    const ownParent=parentName();
    document.querySelectorAll('#parentChatMessages .parent-chat-msg').forEach(el=>{let author=el.querySelector('.parent-chat-author');const text=el.classList.contains('parent')?'Родитель'+(ownParent?' '+ownParent:''):'Детское Отделение Медси';if(!author){author=document.createElement('div');author.className='parent-chat-author';el.prepend(author)}if(author.textContent!==text)author.textContent=text});
  }

  function animateMessages(){
    for(const box of [document.getElementById('chatThreadBox'),document.getElementById('parentChatMessages')]){
      if(!box||!box.isConnected)continue;
      const nodes=[...box.children].filter(el=>el.matches&&el.matches('.msg,.parent-chat-msg')&&!el.dataset.medsiAnimated);
      nodes.slice(-14).forEach((el,i)=>{el.dataset.medsiAnimated='1';el.style.setProperty('--medsi-message-delay',Math.min(i*22,154)+'ms');el.classList.add('medsi-message-enter')});
    }
  }

  let lastVisible='';
  function animateScreens(){
    for(const id of ['screenChats','screenChatThread','screenChat']){const el=document.getElementById(id);if(!el||el.classList.contains('hidden'))continue;if(lastVisible===id)return;lastVisible=id;el.classList.remove('medsi-screen-enter');void el.offsetWidth;el.classList.add('medsi-screen-enter');return}
  }

  let polishQueued=false;
  function polish(){polishQueued=false;document.querySelectorAll('.msg-image-wrap,.parent-chat-media-frame').forEach(markMedia);redrawRefresh();fixAuthors();animateScreens();animateMessages()}
  function queuePolish(){if(polishQueued)return;polishQueued=true;requestAnimationFrame(polish)}

  const contentObserver=new MutationObserver(queuePolish);
  function boot(){contentObserver.observe(document.body,{subtree:true,childList:true});const screenObserver=new MutationObserver(queuePolish);screenObserver.observe(document.body,{attributes:true,attributeFilter:['data-screen']});queuePolish()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();