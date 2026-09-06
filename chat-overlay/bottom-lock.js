(function(){
  if(window.__medsiChatBottomLock)return;
  window.__medsiChatBottomLock=true;

  const LOCK_MS=3200;
  const state=new WeakMap();

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
    state.delete(box);
  }

  function lock(box){
    if(!isVisible(box))return;
    stop(box);
    const s={until:Date.now()+LOCK_MS,timer:null,raf:0,resize:null,user:false};
    state.set(box,s);

    const pin=()=>{
      if(s.user||Date.now()>s.until||!isVisible(box)){stop(box);return}
      if(s.raf)cancelAnimationFrame(s.raf);
      s.raf=requestAnimationFrame(()=>{s.raf=0;atBottom(box)});
    };

    const release=()=>{s.user=true;stop(box)};
    ['touchstart','pointerdown','wheel'].forEach(type=>box.addEventListener(type,release,{once:true,passive:true}));

    if(window.ResizeObserver){
      s.resize=new ResizeObserver(pin);
      s.resize.observe(box);
      Array.from(box.children).forEach(ch=>s.resize.observe(ch));
    }

    const media=box.querySelectorAll('img,video');
    media.forEach(el=>{
      if(el.tagName==='IMG'&&!el.complete)el.addEventListener('load',pin,{once:true});
      if(el.tagName==='VIDEO')el.addEventListener('loadedmetadata',pin,{once:true});
    });

    pin();
    requestAnimationFrame(pin);
    setTimeout(pin,80);
    setTimeout(pin,220);
    setTimeout(pin,500);
    setTimeout(pin,900);
    setTimeout(pin,1500);
    setTimeout(pin,2300);
    s.timer=setTimeout(()=>stop(box),LOCK_MS+120);
  }

  function scan(){
    const parent=document.getElementById('parentChatMessages');
    if(parent&&isVisible(parent)&&!state.has(parent))lock(parent);
    const educator=document.getElementById('chatThreadBox');
    if(educator&&isVisible(educator)&&!state.has(educator))lock(educator);
  }

  const mo=new MutationObserver(records=>{
    let rescan=false;
    for(const record of records){
      if(record.type==='attributes'){rescan=true;break}
      const target=record.target;
      if(target&&target.id==='parentChatMessages'){lock(target);continue}
      if(target&&target.id==='chatThreadBox'){lock(target);continue}
      for(const node of record.addedNodes){
        if(node.nodeType!==1)continue;
        if(node.id==='parentChatMessages'||node.id==='chatThreadBox'||node.querySelector?.('#parentChatMessages,#chatThreadBox')){rescan=true;break}
      }
      if(rescan)break;
    }
    if(rescan)requestAnimationFrame(scan);
  });

  function boot(){
    mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-screen']});
    scan();
    document.addEventListener('load',e=>{
      const el=e.target;if(!el||!el.closest)return;
      const box=el.closest('#parentChatMessages,#chatThreadBox');
      const s=box&&state.get(box);if(s&&!s.user&&Date.now()<s.until)atBottom(box);
    },true);
    document.addEventListener('loadedmetadata',e=>{
      const el=e.target;if(!el||!el.closest)return;
      const box=el.closest('#parentChatMessages,#chatThreadBox');
      const s=box&&state.get(box);if(s&&!s.user&&Date.now()<s.until)atBottom(box);
    },true);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
