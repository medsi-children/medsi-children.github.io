(function(){
  if(window.__medsiChatBottomLock)return;
  window.__medsiChatBottomLock=true;

  const LOCK_MS=3200;
  const state=new WeakMap();
  const settled=new WeakSet();

  function installTuningStyles(){
    if(document.getElementById('medsi-chat-ux-tuning'))return;
    const style=document.createElement('style');
    style.id='medsi-chat-ux-tuning';
    style.textContent=`
      .medsi-message-meta{font-size:10px!important;gap:3px!important;opacity:.72!important}
      .medsi-read-receipt{font-size:11px!important;font-weight:700!important;letter-spacing:-1.5px!important;opacity:.62!important}
      .medsi-read-receipt.is-read{opacity:.84!important;letter-spacing:-3px!important;min-width:13px!important}
    `;
    document.head.appendChild(style);
  }

  function isVisible(el){
    if(!el||!el.isConnected)return false;
    const r=el.getBoundingClientRect();
    return r.width>0&&r.height>0&&getComputedStyle(el).display!=='none';
  }

  function atBottom(box){
    box.scrollTop=Math.max(0,box.scrollHeight-box.clientHeight);
  }

  function stop(box){
    const s=state.get(box);if(!s)return;
    clearTimeout(s.timer);
    if(s.raf)cancelAnimationFrame(s.raf);
    if(s.resize)s.resize.disconnect();
    if(s.release){
      ['touchstart','pointerdown','wheel'].forEach(type=>box.removeEventListener(type,s.release));
    }
    state.delete(box);
  }

  function settle(box){
    settled.add(box);
    stop(box);
  }

  function trackMedia(box,s,root){
    const scope=root&&root.querySelectorAll?root:box;
    const media=[];
    if(root&&root.nodeType===1&&root.matches&&root.matches('img,video'))media.push(root);
    if(scope&&scope.querySelectorAll)scope.querySelectorAll('img,video').forEach(el=>media.push(el));
    media.forEach(el=>{
      if(el.dataset.medsiBottomLockTracked==='1')return;
      el.dataset.medsiBottomLockTracked='1';
      if(el.tagName==='IMG'&&!el.complete)el.addEventListener('load',s.pin,{once:true});
      if(el.tagName==='VIDEO')el.addEventListener('loadedmetadata',s.pin,{once:true});
    });
  }

  function trackChild(s,node){
    if(!node||node.nodeType!==1)return;
    if(s.resize){
      try{s.resize.observe(node)}catch(_){}
    }
    trackMedia(s.box,s,node);
  }

  function lock(box){
    if(!isVisible(box)||settled.has(box))return;
    stop(box);
    const s={box,until:Date.now()+LOCK_MS,timer:null,raf:0,resize:null,release:null,pin:null};
    state.set(box,s);

    const pin=()=>{
      if(state.get(box)!==s)return;
      if(Date.now()>s.until||!isVisible(box)){settle(box);return}
      if(s.raf)cancelAnimationFrame(s.raf);
      s.raf=requestAnimationFrame(()=>{
        s.raf=0;
        if(state.get(box)===s&&!settled.has(box))atBottom(box);
      });
    };
    s.pin=pin;

    s.release=()=>settle(box);
    ['touchstart','pointerdown','wheel'].forEach(type=>box.addEventListener(type,s.release,{passive:true}));

    if(window.ResizeObserver){
      s.resize=new ResizeObserver(pin);
      s.resize.observe(box);
      Array.from(box.children).forEach(ch=>s.resize.observe(ch));
    }
    trackMedia(box,s,box);

    pin();
    requestAnimationFrame(pin);
    [80,220,500,900,1500,2300].forEach(ms=>setTimeout(pin,ms));
    s.timer=setTimeout(()=>settle(box),LOCK_MS+120);
  }

  function scanBox(box){
    if(!box)return;
    if(!isVisible(box)){
      stop(box);
      settled.delete(box);
      return;
    }
    if(!state.has(box)&&!settled.has(box))lock(box);
  }

  function scan(){
    scanBox(document.getElementById('parentChatMessages'));
    scanBox(document.getElementById('chatThreadBox'));
  }

  function boxForTarget(target){
    if(!target)return null;
    if(target.id==='parentChatMessages'||target.id==='chatThreadBox')return target;
    return target.closest&&target.closest('#parentChatMessages,#chatThreadBox');
  }

  const mo=new MutationObserver(records=>{
    let rescan=false;
    for(const record of records){
      if(record.type==='attributes'){
        rescan=true;
        continue;
      }
      const box=boxForTarget(record.target);
      const s=box&&state.get(box);
      if(s){
        record.addedNodes.forEach(node=>trackChild(s,node));
        s.pin();
        continue;
      }
      for(const node of record.addedNodes){
        if(node.nodeType!==1)continue;
        if(node.id==='parentChatMessages'||node.id==='chatThreadBox'||node.querySelector?.('#parentChatMessages,#chatThreadBox')){
          rescan=true;
          break;
        }
      }
    }
    if(rescan)requestAnimationFrame(scan);
  });

  function preserveManualPosition(event){
    const el=event.target;if(!el||!el.closest)return;
    const box=el.closest('#parentChatMessages,#chatThreadBox');
    if(!box||!settled.has(box))return;
    const top=box.scrollTop;
    queueMicrotask(()=>{
      if(settled.has(box)&&isVisible(box))box.scrollTop=top;
    });
  }

  function boot(){
    installTuningStyles();
    mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-screen']});
    scan();
    document.addEventListener('load',event=>{
      preserveManualPosition(event);
      const el=event.target;if(!el||!el.closest)return;
      const box=el.closest('#parentChatMessages,#chatThreadBox');
      const s=box&&state.get(box);if(s)s.pin();
    },true);
    document.addEventListener('loadedmetadata',event=>{
      preserveManualPosition(event);
      const el=event.target;if(!el||!el.closest)return;
      const box=el.closest('#parentChatMessages,#chatThreadBox');
      const s=box&&state.get(box);if(s)s.pin();
    },true);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();