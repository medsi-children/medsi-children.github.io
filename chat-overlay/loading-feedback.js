(function(){
  const DELAY=500;
  let timer=0;
  let target=null;
  let token=0;

  const style=document.createElement('style');
  style.textContent=`
    .medsi-delayed-loading{padding:18px 10px;text-align:center;color:rgba(95,127,134,.88)}
    .medsi-loading-dots{display:flex;justify-content:center;gap:7px;margin:0 auto 8px}
    .medsi-loading-dots span{width:8px;height:8px;border-radius:50%;background:rgba(22,184,192,.72);animation:medsiDotJump .9s ease-in-out infinite}
    .medsi-loading-dots span:nth-child(2){animation-delay:.12s}
    .medsi-loading-dots span:nth-child(3){animation-delay:.24s}
    .medsi-loading-label{font-weight:700;font-size:.95rem}
    @keyframes medsiDotJump{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-6px);opacity:1}}

    .medsi-card-skeleton{display:block;width:100%;min-height:122px;border:1.5px solid rgba(36,211,218,.14);border-radius:14px;padding:16px 18px;margin:0;background:#fdfefe;overflow:hidden}
    .medsi-skeleton-line,.medsi-message-skeleton-line{height:12px;border-radius:999px;background:linear-gradient(90deg,rgba(213,232,235,.48) 20%,rgba(238,248,249,.96) 42%,rgba(213,232,235,.48) 64%);background-size:220% 100%;animation:medsiSkeleton 1.25s ease-in-out infinite}
    .medsi-card-skeleton .medsi-skeleton-line:nth-child(1){width:42%;height:16px;margin-bottom:13px}
    .medsi-card-skeleton .medsi-skeleton-line:nth-child(2){width:72%;margin-bottom:9px}
    .medsi-card-skeleton .medsi-skeleton-line:nth-child(3){width:58%;margin-bottom:9px}
    .medsi-card-skeleton .medsi-skeleton-line:nth-child(4){width:84%;margin-top:16px}
    .medsi-card-skeleton+.medsi-card-skeleton{margin-top:10px}

    .medsi-thread-skeleton{padding:8px 2px 14px;display:flex;flex-direction:column;gap:12px}
    .medsi-message-skeleton{width:min(78%,520px);padding:14px 16px;border-radius:16px;background:rgba(239,249,250,.72);border:1px solid rgba(36,211,218,.12)}
    .medsi-message-skeleton:nth-child(even){align-self:flex-end;width:min(68%,470px)}
    .medsi-message-skeleton-line{margin-bottom:8px}
    .medsi-message-skeleton-line:last-child{margin-bottom:0;width:58%}
    .medsi-message-skeleton:nth-child(2) .medsi-message-skeleton-line:first-child{width:78%}
    .medsi-message-skeleton:nth-child(3) .medsi-message-skeleton-line:first-child{width:66%}
    @keyframes medsiSkeleton{0%{background-position:100% 0}100%{background-position:-120% 0}}
    @media (prefers-reduced-motion:reduce){.medsi-loading-dots span,.medsi-skeleton-line,.medsi-message-skeleton-line{animation:none}}
  `;
  document.head.appendChild(style);

  function isPlainLoading(el){
    return !!el && el.children.length===1 && el.firstElementChild && el.firstElementChild.classList.contains('chat-empty') && /^Загрузка\.\.\.$/.test((el.firstElementChild.textContent||'').trim());
  }

  function unreadMarkup(){
    return '<div class="medsi-delayed-loading"><div class="medsi-loading-dots"><span></span><span></span><span></span></div><div class="medsi-loading-label">Загрузка...</div></div>';
  }
  function cardsMarkup(){
    const one='<div class="medsi-card-skeleton" aria-hidden="true"><div class="medsi-skeleton-line"></div><div class="medsi-skeleton-line"></div><div class="medsi-skeleton-line"></div><div class="medsi-skeleton-line"></div></div>';
    return one+one+one;
  }
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
      else el.innerHTML=unreadMarkup();
    },DELAY);
  }

  function scan(){
    const screen=document.body.dataset.screen||'';
    if(screen==='screenChatThread'){
      const box=document.getElementById('chatThreadBox');
      if(isPlainLoading(box)){schedule(box,'thread');return}
    }
    if(screen==='screenChats'){
      const list=document.getElementById('chatList');
      if(isPlainLoading(list)){
        const meta=(document.getElementById('meta')?.textContent||'').trim();
        schedule(list,meta==='Прочитанные чаты'?'read':'unread');return;
      }
    }
    if(timer)clearTimeout(timer);
    timer=0;target=null;token++;
  }

  const observer=new MutationObserver(scan);
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-screen','class']});
  scan();
})();