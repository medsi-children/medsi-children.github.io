(function(){
  if(window.__medsiChatPolishV2)return;
  window.__medsiChatPolishV2=true;
  if(!document.querySelector('script[data-medsi-terminology-fix]')){const s=document.createElement('script');s.src='/chat-overlay/terminology-fix.js?v=20260906-1';s.dataset.medsiTerminologyFix='1';document.head.appendChild(s)}

  const style=document.createElement('style');
  style.textContent=`
    @keyframes medsiScreenIn{from{opacity:0;transform:translateY(8px) scale(.996)}to{opacity:1;transform:none}}
    @keyframes medsiMessageIn{from{opacity:0;transform:translateY(8px) scale(.992)}to{opacity:1;transform:none}}
    #screenChats.medsi-screen-enter,#screenChatThread.medsi-screen-enter,#screenChat.medsi-screen-enter{animation:medsiScreenIn .26s cubic-bezier(.22,.72,.28,1) both}
    #chatThreadBox .msg.medsi-message-enter,#parentChatMessages .parent-chat-msg.medsi-message-enter{animation:medsiMessageIn .24s cubic-bezier(.22,.72,.28,1) both;animation-delay:var(--medsi-message-delay,0ms)}
    .msg-author,.parent-chat-author{letter-spacing:.01em}
    #btnRefreshChats{display:inline-flex!important;align-items:center!important;justify-content:center!important;padding:0!important;line-height:1!important}
    #btnRefreshChats .refresh-label{position:absolute!important;inset:0!important;display:flex!important;align-items:center!important;justify-content:center!important;width:auto!important;height:auto!important;font-size:2rem!important;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-weight:500;line-height:1!important;transform:translateY(-1px)!important}
    #btnRefreshChats.loading .refresh-label{display:none!important}
    @media (prefers-reduced-motion:reduce){#screenChats.medsi-screen-enter,#screenChatThread.medsi-screen-enter,#screenChat.medsi-screen-enter,#chatThreadBox .msg.medsi-message-enter,#parentChatMessages .parent-chat-msg.medsi-message-enter{animation:none!important}}
  `;
  document.head.appendChild(style);

  function redrawRefresh(){const btn=document.getElementById('btnRefreshChats');if(!btn||btn.dataset.medsiRefreshV3==='1')return;btn.dataset.medsiRefreshV3='1';const label=btn.querySelector('.refresh-label');if(label)label.textContent='⟳'}

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
  function polish(){polishQueued=false;redrawRefresh();animateScreens();animateMessages()}
  function queuePolish(){if(polishQueued)return;polishQueued=true;requestAnimationFrame(polish)}

  const contentObserver=new MutationObserver(queuePolish);
  function boot(){contentObserver.observe(document.body,{subtree:true,childList:true});const screenObserver=new MutationObserver(queuePolish);screenObserver.observe(document.body,{attributes:true,attributeFilter:['data-screen']});queuePolish()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
