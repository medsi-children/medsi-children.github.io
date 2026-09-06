(function(){
  if(window.MedsiChatListExperiment)return;

  const ICONS={
    back:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    compose:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 6.5h13v9h-8l-4.5 3v-12z"/><path d="M12 8.5v5M9.5 11h5"/></svg>',
    refresh:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.5 8.5A7 7 0 1 0 19 15"/><path d="M18.5 4.5v4h-4"/></svg>'
  };

  function injectStyles(){
    if(document.getElementById('medsi-chat-list-experiment-style'))return;
    const style=document.createElement('style');
    style.id='medsi-chat-list-experiment-style';
    style.textContent=`
      /* Experimental messenger-style educator chat list. */
      body[data-screen="screenChats"] .educator-exact-clone #title,
      body[data-screen="screenChats"] .educator-exact-clone #meta{display:none!important}

      .educator-exact-clone #screenChats{min-height:0!important}
      .educator-exact-clone .medsi-chat-list-toolbar{
        display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:8px;align-items:center;
        width:100%;margin:2px 0 12px;padding:0;
      }
      .educator-exact-clone .medsi-list-icon-btn{
        appearance:none;box-sizing:border-box;width:42px;min-width:42px;height:42px;min-height:42px;
        padding:0;border-radius:999px;border:1.5px solid rgba(22,184,192,.28);background:#fff;color:#16b8c0;
        display:inline-grid;place-items:center;cursor:pointer;box-shadow:0 3px 10px rgba(22,184,192,.05);
      }
      .educator-exact-clone .medsi-list-icon-btn svg{
        width:21px;height:21px;display:block;fill:none;stroke:currentColor;stroke-width:2.35;
        stroke-linecap:round;stroke-linejoin:round;pointer-events:none;
      }
      .educator-exact-clone .medsi-list-back svg{width:22px;height:22px}
      .educator-exact-clone .medsi-list-actions{display:flex;align-items:center;gap:6px;justify-content:flex-end}
      .educator-exact-clone .medsi-list-actions .medsi-list-icon-btn{width:40px;min-width:40px;height:40px;min-height:40px}
      .educator-exact-clone .medsi-list-new{
        color:#fff;background:#18bcc5;border-color:#18bcc5;box-shadow:0 5px 14px rgba(22,184,192,.18);
      }
      .educator-exact-clone .medsi-list-new svg{width:20px;height:20px}
      .educator-exact-clone .medsi-list-refresh.is-loading svg{animation:medsiListRefreshSpin .72s linear infinite}
      @keyframes medsiListRefreshSpin{to{transform:rotate(360deg)}}

      .educator-exact-clone .medsi-list-tabs{
        min-width:0;height:42px;padding:3px;border-radius:999px;
        display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2px;
        background:#eefafb;border:1px solid rgba(22,184,192,.18);
      }
      .educator-exact-clone .medsi-list-tab{
        appearance:none;min-width:0;height:34px;padding:0 9px;border:0;border-radius:999px;
        background:transparent;color:#6b9298;font:inherit;font-size:.78rem;font-weight:760;line-height:1;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;box-shadow:none;
      }
      .educator-exact-clone .medsi-list-tab.is-active{
        background:#fff;color:#16aeb7;box-shadow:0 2px 8px rgba(22,184,192,.10),0 0 0 1px rgba(22,184,192,.07);
      }

      .educator-exact-clone #screenChats > .medsi-list-legacy-actions{display:none!important}
      .educator-exact-clone #chatList > .medsi-legacy-bucket-switch{display:none!important}

      .educator-exact-clone #chatList{gap:7px!important}
      .educator-exact-clone #chatList .chat-card{
        min-height:96px!important;padding:12px 50px 12px 15px!important;border-radius:17px!important;
        border-width:1px!important;box-shadow:0 3px 12px rgba(17,66,74,.035)!important;background:rgba(255,255,255,.92)!important;
      }
      .educator-exact-clone #chatList .chat-card.unread{
        border-width:1.5px!important;box-shadow:0 5px 15px rgba(22,184,192,.075)!important;
      }
      .educator-exact-clone #chatList .chat-card.pinned{
        box-shadow:0 5px 15px rgba(217,158,25,.055)!important;
      }
      .educator-exact-clone #chatList .chat-card-title{font-size:.97rem!important;margin-bottom:2px!important}
      .educator-exact-clone #chatList .chat-card-meta{font-size:.84rem!important;line-height:1.34!important}
      .educator-exact-clone #chatList .chat-card-last{
        margin-top:6px!important;font-size:.86rem!important;line-height:1.36!important;max-height:calc(1.36em * 2.5)!important;
        -webkit-line-clamp:2!important;line-clamp:2!important;
      }
      .educator-exact-clone #chatList .chat-controls{top:10px!important;right:10px!important}
      .educator-exact-clone #chatList .chat-empty{padding:24px 10px!important;color:rgba(95,127,134,.78)!important}

      @media(max-width:560px){
        .educator-exact-clone .medsi-chat-list-toolbar{grid-template-columns:40px minmax(0,1fr) auto;gap:7px;margin-top:1px;margin-bottom:10px}
        .educator-exact-clone .medsi-list-icon-btn{width:40px;min-width:40px;height:40px;min-height:40px}
        .educator-exact-clone .medsi-list-actions{gap:5px}
        .educator-exact-clone .medsi-list-actions .medsi-list-icon-btn{width:38px;min-width:38px;height:38px;min-height:38px}
        .educator-exact-clone .medsi-list-tabs{height:40px;padding:3px}
        .educator-exact-clone .medsi-list-tab{height:32px;padding:0 6px;font-size:.70rem}
        .educator-exact-clone #chatList .chat-card{min-height:90px!important;padding:11px 48px 11px 13px!important;border-radius:16px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function buttonByText(root,needle){
    if(!root)return null;
    return Array.from(root.querySelectorAll('button')).find(btn=>String(btn.textContent||'').includes(needle))||null;
  }

  function bucketFromList(list,fallback){
    if(buttonByText(list,'Вернуться к непрочитанным'))return'read';
    if(buttonByText(list,'Открыть прочитанные'))return'unread';
    const empty=String(list&&list.textContent||'');
    if(empty.includes('Прочитанных чатов нет'))return'read';
    if(empty.includes('Новых сообщений нет'))return'unread';
    return fallback||'unread';
  }

  function markLegacyBucketSwitches(list){
    if(!list)return;
    Array.from(list.children).forEach(child=>{
      const text=String(child.textContent||'');
      if(text.includes('Вернуться к непрочитанным')||text.includes('Открыть прочитанные чаты'))child.classList.add('medsi-legacy-bucket-switch');
    });
  }

  function switchBucket(target,state){
    const list=document.getElementById('chatList');
    if(!list||state.bucket===target)return;
    const legacy=target==='read'?buttonByText(list,'Открыть прочитанные'):buttonByText(list,'Вернуться к непрочитанным');
    if(legacy){
      state.bucket=target;
      updateTabs(state);
      legacy.click();
    }
  }

  function updateTabs(state){
    const list=document.getElementById('chatList');
    if(!list)return;
    markLegacyBucketSwitches(list);
    state.bucket=bucketFromList(list,state.bucket);
    if(state.unreadTab)state.unreadTab.classList.toggle('is-active',state.bucket==='unread');
    if(state.readTab)state.readTab.classList.toggle('is-active',state.bucket==='read');
  }

  function installList(){
    const screen=document.getElementById('screenChats');
    const list=document.getElementById('chatList');
    const back=document.getElementById('btnChatsBack');
    const newChat=document.getElementById('btnNewChat');
    const refresh=document.getElementById('btnRefreshChats');
    if(!screen||!list||!back||!newChat||!refresh)return false;

    const legacyRow=back.parentElement;
    if(legacyRow)legacyRow.classList.add('medsi-list-legacy-actions');

    let toolbar=screen.querySelector(':scope > .medsi-chat-list-toolbar');
    let state=toolbar&&toolbar._medsiState;
    if(!toolbar){
      toolbar=document.createElement('div');
      toolbar.className='medsi-chat-list-toolbar';

      const backProxy=document.createElement('button');
      backProxy.type='button';backProxy.className='medsi-list-icon-btn medsi-list-back';backProxy.innerHTML=ICONS.back;
      backProxy.setAttribute('aria-label','Назад');backProxy.title='Назад';backProxy.onclick=()=>back.click();

      const tabs=document.createElement('div');tabs.className='medsi-list-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Список чатов');
      const unreadTab=document.createElement('button');unreadTab.type='button';unreadTab.className='medsi-list-tab';unreadTab.textContent='Непрочитанные';unreadTab.setAttribute('role','tab');
      const readTab=document.createElement('button');readTab.type='button';readTab.className='medsi-list-tab';readTab.textContent='Прочитанные';readTab.setAttribute('role','tab');
      tabs.append(unreadTab,readTab);

      const actions=document.createElement('div');actions.className='medsi-list-actions';
      const newProxy=document.createElement('button');newProxy.type='button';newProxy.className='medsi-list-icon-btn medsi-list-new';newProxy.innerHTML=ICONS.compose;newProxy.setAttribute('aria-label','Написать родителю');newProxy.title='Написать родителю';newProxy.onclick=()=>newChat.click();
      const refreshProxy=document.createElement('button');refreshProxy.type='button';refreshProxy.className='medsi-list-icon-btn medsi-list-refresh';refreshProxy.innerHTML=ICONS.refresh;refreshProxy.setAttribute('aria-label','Обновить чаты');refreshProxy.title='Обновить чаты';
      actions.append(newProxy,refreshProxy);

      toolbar.append(backProxy,tabs,actions);
      screen.insertBefore(toolbar,list);
      state={bucket:'unread',unreadTab,readTab,refreshProxy,manualRefresh:false};
      toolbar._medsiState=state;

      unreadTab.onclick=()=>switchBucket('unread',state);
      readTab.onclick=()=>switchBucket('read',state);
      refreshProxy.onclick=()=>{
        if(refresh.disabled)return;
        state.manualRefresh=true;refreshProxy.classList.add('is-loading');refresh.click();
        setTimeout(()=>{if(!refresh.classList.contains('loading')){state.manualRefresh=false;refreshProxy.classList.remove('is-loading')}},150);
      };

      new MutationObserver(()=>updateTabs(state)).observe(list,{childList:true,subtree:false});
      new MutationObserver(()=>{
        if(!state.manualRefresh)return;
        const loading=refresh.classList.contains('loading');
        refreshProxy.classList.toggle('is-loading',loading);
        if(!loading)state.manualRefresh=false;
      }).observe(refresh,{attributes:true,attributeFilter:['class','disabled']});
    }

    updateTabs(state);
    return true;
  }

  function installSwipeBack(){
    const screen=document.getElementById('screenChatThread');
    const back=document.getElementById('btnThreadBack');
    if(!screen||!back||screen.dataset.medsiSwipeBack)return false;
    screen.dataset.medsiSwipeBack='1';

    let active=false,startX=0,startY=0,lastX=0,lastY=0,startAt=0;
    screen.addEventListener('touchstart',e=>{
      if(e.touches.length!==1)return;
      const t=e.touches[0],rect=screen.getBoundingClientRect();
      if(t.clientX-rect.left>34)return;
      if(e.target&&e.target.closest&&e.target.closest('button,a,input,textarea,[contenteditable="true"],video'))return;
      active=true;startX=lastX=t.clientX;startY=lastY=t.clientY;startAt=Date.now();
    },{passive:true});
    screen.addEventListener('touchmove',e=>{
      if(!active||e.touches.length!==1)return;
      lastX=e.touches[0].clientX;lastY=e.touches[0].clientY;
      const dx=lastX-startX,dy=lastY-startY;
      if(dx<0||Math.abs(dy)>Math.max(20,Math.abs(dx)*1.2))active=false;
    },{passive:true});
    const finish=()=>{
      if(!active)return;
      active=false;
      const dx=lastX-startX,dy=lastY-startY,elapsed=Date.now()-startAt;
      if(dx>=68&&Math.abs(dx)>=Math.abs(dy)*1.35&&elapsed<1100)back.click();
    };
    screen.addEventListener('touchend',finish,{passive:true});
    screen.addEventListener('touchcancel',()=>{active=false},{passive:true});
    return true;
  }

  let scheduled=false;
  function install(){scheduled=false;injectStyles();installList();installSwipeBack()}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(install)}

  injectStyles();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});

  if(!document.querySelector('script[data-medsi-gesture-navigation]')){
    const s=document.createElement('script');
    s.src='/chat-overlay/gesture-navigation.js?v=20260907-1';
    s.dataset.medsiGestureNavigation='1';
    document.head.appendChild(s);
  }

  window.MedsiChatListExperiment={install};
})();
