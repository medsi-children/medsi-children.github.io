(function(){
  function normalizeTutorCopy(){
    const replacements=[
      ['воспитателями и психологами','воспитателями'],
      ['воспитателей и психологов','воспитателей'],
      ['Воспитатели и психологи','Воспитатели'],
      ['воспитатели и психологи','воспитатели']
    ];
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    const nodes=[];let node;
    while((node=walker.nextNode()))nodes.push(node);
    nodes.forEach(textNode=>{
      let value=textNode.nodeValue||'';
      let next=value;
      replacements.forEach(([from,to])=>{next=next.split(from).join(to)});
      if(next!==value)textNode.nodeValue=next;
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',normalizeTutorCopy,{once:true});else normalizeTutorCopy();

  try{if('scrollRestoration' in history)history.scrollRestoration='manual'}catch(_){}
  function resetInitialPageScroll(){
    if(document.body.classList.contains('medsi-chat-overlay-open'))return;
    const screen=String(document.body.dataset.screen||'');
    if(screen&&screen!=='screenChoose')return;
    window.scrollTo(0,0);
    document.documentElement.scrollTop=0;
    document.body.scrollTop=0;
  }
  resetInitialPageScroll();
  requestAnimationFrame(()=>requestAnimationFrame(resetInitialPageScroll));
  window.addEventListener('pageshow',()=>{
    resetInitialPageScroll();
    setTimeout(resetInitialPageScroll,80);
    setTimeout(resetInitialPageScroll,320);
  });
  window.addEventListener('load',()=>{
    resetInitialPageScroll();
    setTimeout(resetInitialPageScroll,120);
  },{once:true});

  function installChatOpeningUx(){
    if(document.getElementById('medsi-chat-opening-style'))return;
    const style=document.createElement('style');
    style.id='medsi-chat-opening-style';
    style.textContent=`
      #btnParentChats{position:relative!important;transition:opacity .18s ease,filter .18s ease,transform .18s ease!important}
      #btnParentChats.medsi-chat-opening{opacity:.76!important;filter:saturate(.88)}
      .medsi-chat-opening-spinner{position:absolute;right:18px;bottom:16px;width:24px;height:24px;border:3px solid rgba(255,255,255,.42);border-top-color:#fff;border-radius:50%;animation:medsiChatOpenSpin .72s linear infinite;pointer-events:none;z-index:5}
      @keyframes medsiChatOpenSpin{to{transform:rotate(360deg)}}
      .refresh-btn{position:relative!important;display:block!important;overflow:hidden!important;padding:0!important;line-height:1!important}
      .refresh-btn .refresh-label{position:absolute!important;inset:0!important;display:flex!important;align-items:center!important;justify-content:center!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;line-height:0!important;transform:none!important}
      .refresh-btn .refresh-label svg{display:block!important;width:26px!important;height:26px!important;overflow:visible!important}
      .refresh-btn.loading .refresh-label{display:none!important}
      .refresh-btn .refresh-spinner{position:absolute!important;left:50%!important;top:50%!important;margin:0!important;transform:translate(-50%,-50%)!important}
    `;
    document.head.appendChild(style);

    const btn=document.getElementById('btnParentChats');
    if(btn&&!btn.dataset.medsiOpeningUx){
      btn.dataset.medsiOpeningUx='1';
      let timer=0;
      const clear=()=>{
        if(timer){clearTimeout(timer);timer=0}
        btn.classList.remove('medsi-chat-opening');
        const spin=btn.querySelector('.medsi-chat-opening-spinner');if(spin)spin.remove();
      };
      btn.addEventListener('click',()=>{
        clear();
        timer=setTimeout(()=>{
          if(document.body.classList.contains('medsi-chat-overlay-open'))return;
          btn.classList.add('medsi-chat-opening');
          if(!btn.querySelector('.medsi-chat-opening-spinner')){const s=document.createElement('span');s.className='medsi-chat-opening-spinner';s.setAttribute('aria-hidden','true');btn.appendChild(s)}
        },1000);
      },true);
      new MutationObserver(()=>{if(document.body.classList.contains('medsi-chat-overlay-open'))clear()}).observe(document.body,{attributes:true,attributeFilter:['class']});
      window.addEventListener('pageshow',clear);
    }

    const refreshSvg='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.6 8.2A7 7 0 1 0 19 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M16.2 5.8h4.4v4.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const repairRefresh=()=>document.querySelectorAll('.refresh-btn .refresh-label').forEach(el=>{if(el.dataset.medsiRefreshFixed==='2')return;el.dataset.medsiRefreshFixed='2';el.innerHTML=refreshSvg});
    repairRefresh();
    new MutationObserver(repairRefresh).observe(document.body,{childList:true,subtree:true});
  }
  installChatOpeningUx();

  const hint=document.querySelector('#screenForm .report-hint');
  function syncHint(type){if(hint)hint.classList.toggle('hidden',type==='psychology')}
  const morning=document.getElementById('btnMorning');
  const evening=document.getElementById('btnEvening');
  const psychology=document.getElementById('btnPsychology');
  if(morning)morning.addEventListener('click',()=>syncHint('morning'));
  if(evening)evening.addEventListener('click',()=>syncHint('evening'));
  if(psychology)psychology.addEventListener('click',()=>syncHint('psychology'));

  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const PUSH_SERVICE_URL='https://medsi-push-worker.medsi-children.workers.dev';
  let pushReady=false,pushLoading=false;

  function authed(){
    const gate=document.getElementById('tutorAuthGate');
    return !!gate&&gate.classList.contains('hidden')&&document.body.dataset.started==='1';
  }
  function panelShouldShow(){
    return authed()&&document.body.dataset.screen==='screenChoose'&&!document.body.classList.contains('medsi-chat-overlay-open');
  }
  function initPush(){
    if(pushReady||pushLoading||!authed())return;
    if(window.MedsiPush){
      pushReady=true;
      MedsiPush.init({frameId:'__no_tutor_iframe__',appEndpointUrl:APP_BASE_URL,pushServiceUrl:PUSH_SERVICE_URL,identity:{role:'educator',phone:''}});
      MedsiPush.setPanelVisible(panelShouldShow());
      return;
    }
    pushLoading=true;
    const s=document.createElement('script');
    s.src='/notify-client.js?v=20260905-tutor-panel';
    s.onload=()=>{pushLoading=false;initPush()};
    s.onerror=()=>{pushLoading=false};
    document.head.appendChild(s);
  }
  function syncPush(){
    initPush();
    if(pushReady&&window.MedsiPush)MedsiPush.setPanelVisible(panelShouldShow());
    if(document.body.dataset.screen==='screenChoose')requestAnimationFrame(resetInitialPageScroll);
  }

  function normalizeTutorCallLinks(root){
    const scope=root&&root.querySelectorAll?root:document;
    scope.querySelectorAll('#screenPhones a[href^="tel:"]').forEach(link=>{
      const digits=String(link.getAttribute('href')||'').replace(/\D+/g,'').slice(-10);
      if(digits.length===10)link.setAttribute('href','tel:8'+digits);
    });
  }
  const phones=document.getElementById('screenPhones');
  if(phones){
    new MutationObserver(()=>normalizeTutorCallLinks(phones)).observe(phones,{childList:true,subtree:true});
    normalizeTutorCallLinks(phones);
  }

  const observer=new MutationObserver(syncPush);
  observer.observe(document.body,{attributes:true,attributeFilter:['data-screen','class','data-started']});
  const gate=document.getElementById('tutorAuthGate');
  if(gate)observer.observe(gate,{attributes:true,attributeFilter:['class']});
  syncPush();

  let activeMessage=null;
  function menuEl(){return document.getElementById('chatContextMenu')}
  function hideAdaptiveMenu(){const menu=menuEl();if(menu)menu.classList.add('hidden');activeMessage=null}
  function positionMenu(anchor){
    const menu=menuEl();
    if(!menu||menu.classList.contains('hidden')||!anchor||!anchor.isConnected)return;
    const vv=window.visualViewport,viewTop=vv?vv.offsetTop:0,viewHeight=vv?vv.height:window.innerHeight,viewBottom=viewTop+viewHeight,viewLeft=vv?vv.offsetLeft:0,viewWidth=vv?vv.width:window.innerWidth,margin=12,gap=10;
    const ar=anchor.getBoundingClientRect(),mr=menu.getBoundingClientRect(),menuW=Math.min(mr.width||310,viewWidth-margin*2),menuH=mr.height||220,spaceAbove=ar.top-viewTop-gap-margin,spaceBelow=viewBottom-ar.bottom-gap-margin;
    let top;
    if(spaceAbove>=menuH){top=ar.top-gap-menuH;menu.dataset.placement='above'}
    else if(spaceBelow>=menuH){top=ar.bottom+gap;menu.dataset.placement='below'}
    else{const ideal=ar.top+(ar.height-menuH)/2;top=Math.max(viewTop+margin,Math.min(viewBottom-margin-menuH,ideal));menu.dataset.placement='overlay'}
    const idealLeft=ar.left+(ar.width-menuW)/2,left=Math.max(viewLeft+margin,Math.min(viewLeft+viewWidth-margin-menuW,idealLeft));
    menu.style.position='fixed';menu.style.width=Math.min(310,viewWidth-margin*2)+'px';menu.style.maxHeight=Math.max(120,viewHeight-margin*2)+'px';menu.style.overflowY='auto';menu.style.left=left+'px';menu.style.top=top+'px';menu.style.bottom='auto';menu.style.zIndex='5000';
  }
  document.addEventListener('click',function(e){
    const bubble=e.target&&e.target.closest?e.target.closest('.educator-exact-clone .msg'):null;if(!bubble)return;const menu=menuEl();
    if(menu&&activeMessage===bubble&&!menu.classList.contains('hidden')){e.preventDefault();e.stopImmediatePropagation();hideAdaptiveMenu();return}
    activeMessage=bubble;requestAnimationFrame(()=>positionMenu(bubble));
  },true);
  document.addEventListener('contextmenu',function(e){
    const bubble=e.target&&e.target.closest?e.target.closest('.educator-exact-clone .msg'):null;if(!bubble)return;const menu=menuEl();
    if(menu&&activeMessage===bubble&&!menu.classList.contains('hidden')){e.preventDefault();e.stopImmediatePropagation();hideAdaptiveMenu();return}
    activeMessage=bubble;requestAnimationFrame(()=>positionMenu(bubble));
  },true);
  document.addEventListener('click',function(){const menu=menuEl();if(menu&&menu.classList.contains('hidden'))activeMessage=null});
  window.addEventListener('resize',()=>{if(activeMessage)positionMenu(activeMessage)});
  if(window.visualViewport)window.visualViewport.addEventListener('resize',()=>{if(activeMessage)positionMenu(activeMessage)});

  if(!window.MedsiVideoLink&&!document.querySelector('script[data-medsi-video-link]')){
    const s=document.createElement('script');
    s.src='/chat-overlay/video-link.js?v=1';
    s.dataset.medsiVideoLink='1';
    s.onload=()=>{
      if(!document.querySelector('script[data-medsi-video-preview]')){
        const p=document.createElement('script');
        p.src='/chat-overlay/video-link-preview.js?v=1';
        p.dataset.medsiVideoPreview='1';
        document.head.appendChild(p);
      }
    };
    document.head.appendChild(s);
  }else if(!document.querySelector('script[data-medsi-video-preview]')){
    const p=document.createElement('script');
    p.src='/chat-overlay/video-link-preview.js?v=1';
    p.dataset.medsiVideoPreview='1';
    document.head.appendChild(p);
  }
  if(!document.querySelector('script[data-medsi-message-enhancements]')){
    const s=document.createElement('script');s.src='/chat-overlay/message-enhancements.js?v=20260905-1';s.dataset.medsiMessageEnhancements='1';document.head.appendChild(s);
  }
  if(!document.querySelector('script[data-medsi-bottom-lock]')){
    const s=document.createElement('script');s.src='/chat-overlay/bottom-lock.js?v=20260906-1';s.dataset.medsiBottomLock='1';document.head.appendChild(s);
  }
})();