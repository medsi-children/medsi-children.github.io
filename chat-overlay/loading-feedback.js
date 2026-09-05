(function(){
  const DELAY=1;
  let timer=0;
  let target=null;
  let token=0;

  const style=document.createElement('style');
  style.textContent=`
    .medsi-card-skeleton{display:block;width:100%;min-height:122px;border:1.5px solid rgba(36,211,218,.14);border-radius:14px;padding:16px 18px;margin:0;background:#fdfefe;overflow:hidden}
    .medsi-skeleton-line,.medsi-message-skeleton-line{height:14px;border-radius:999px;background:linear-gradient(90deg,rgba(213,232,235,.48) 20%,rgba(238,248,249,.96) 42%,rgba(213,232,235,.48) 64%);background-size:220% 100%;animation:medsiSkeleton 1.25s ease-in-out infinite}
    .medsi-card-skeleton .medsi-skeleton-line:nth-child(1){width:42%;height:17px;margin-bottom:13px}
    .medsi-card-skeleton .medsi-skeleton-line:nth-child(2){width:72%;margin-bottom:9px}
    .medsi-card-skeleton .medsi-skeleton-line:nth-child(3){width:58%;margin-bottom:9px}
    .medsi-card-skeleton .medsi-skeleton-line:nth-child(4){width:84%;margin-top:16px}
    .medsi-card-skeleton+.medsi-card-skeleton{margin-top:10px}

    .medsi-thread-skeleton{padding:8px 2px 14px;display:flex;flex-direction:column;gap:14px}
    .medsi-message-skeleton{width:min(82%,540px);min-height:98px;padding:20px 18px;border-radius:16px;background:rgba(239,249,250,.72);border:1px solid rgba(36,211,218,.12);display:flex;flex-direction:column;justify-content:center;gap:11px}
    .medsi-message-skeleton:nth-child(even){align-self:flex-end;width:min(72%,490px);min-height:88px}
    .medsi-message-skeleton-line{height:16px;margin:0}
    .medsi-message-skeleton-line:last-child{width:58%}
    .medsi-message-skeleton:nth-child(2) .medsi-message-skeleton-line:first-child{width:78%}
    .medsi-message-skeleton:nth-child(3) .medsi-message-skeleton-line:first-child{width:66%}
    @keyframes medsiSkeleton{0%{background-position:100% 0}100%{background-position:-120% 0}}
    @media (prefers-reduced-motion:reduce){.medsi-skeleton-line,.medsi-message-skeleton-line{animation:none}}
  `;
  document.head.appendChild(style);

  function visibleOverlay(){
    const root=document.querySelector('.medsi-chat-overlay.educator-exact-clone');
    return root && !root.classList.contains('hidden') && root.getAttribute('aria-hidden')!=='true' ? root : null;
  }

  function isPlainLoading(el){
    return !!el && el.children.length===1 && el.firstElementChild && el.firstElementChild.classList.contains('chat-empty') && /^Загрузка\.\.\.$/.test((el.firstElementChild.textContent||'').trim());
  }

  function cardMarkup(){
    return '<div class="medsi-card-skeleton" aria-hidden="true"><div class="medsi-skeleton-line"></div><div class="medsi-skeleton-line"></div><div class="medsi-skeleton-line"></div><div class="medsi-skeleton-line"></div></div>';
  }
  function cardsMarkup(){return cardMarkup()+cardMarkup()+cardMarkup()}
  function threadMarkup(){
    const msg='<div class="medsi-message-skeleton" aria-hidden="true"><div class="medsi-message-skeleton-line"></div><div class="medsi-message-skeleton-line"></div></div>';
    return '<div class="medsi-thread-skeleton">'+msg+msg+msg+msg+'</div>';
  }

  function schedule(el,kind){
    if(timer)clearTimeout(timer);
    target=el;
    const mine=++token;
    if(el && isPlainLoading(el)) el.firstElementChild.style.visibility='hidden';
    timer=setTimeout(()=>{
      timer=0;
      if(mine!==token || !target || target!==el || !isPlainLoading(el))return;
      if(kind==='thread')el.innerHTML=threadMarkup();
      else if(kind==='read')el.innerHTML=cardsMarkup();
      else el.innerHTML=cardMarkup();
    },DELAY);
  }

  function cancel(){
    if(timer)clearTimeout(timer);
    timer=0;target=null;token++;
  }

  function scan(){
    const root=visibleOverlay();
    if(!root){cancel();return}
    const screen=document.body.dataset.screen||'';
    if(screen==='screenChatThread'){
      const box=root.querySelector('#chatThreadBox');
      if(isPlainLoading(box)){schedule(box,'thread');return}
    }
    if(screen==='screenChats'){
      const list=root.querySelector('#chatList');
      const section=root.querySelector('#screenChats');
      if(section && !section.classList.contains('hidden') && isPlainLoading(list)){
        const meta=(root.querySelector('#meta')?.textContent||'').trim();
        schedule(list,meta==='Прочитанные чаты'?'read':'unread');return;
      }
    }
    cancel();
  }

  const observer=new MutationObserver(scan);
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-screen','class','aria-hidden']});
  scan();
})();