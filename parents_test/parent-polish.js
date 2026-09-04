(function(){
  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const D1_KEY='medsi_d1_parent_session_v1';
  const PHONE_KEY='medsi_parent_phone';
  const PARENT_KEY='medsi_parent';
  const CHILD_KEY='medsi_child';
  const $=id=>document.getElementById(id);
  const digits=v=>String(v||'').replace(/\D+/g,'');
  const get=k=>{try{return localStorage.getItem(k)||''}catch(_){return''}};
  const set=(k,v)=>{try{localStorage.setItem(k,v)}catch(_){}};

  function installStyle(){
    const style=document.createElement('style');
    style.textContent=`
      #rim{display:none!important}
      body[data-screen="screenStart"] #chips,
      body[data-screen="screenNames"] #chips,
      body[data-screen="screenPhoneReg"] #chips,
      body[data-screen="screenAuth"] #chips{display:none!important}
      body[data-screen="screenStart"] #headerBlock,
      body[data-screen="screenNames"] #headerBlock,
      body[data-screen="screenPhoneReg"] #headerBlock,
      body[data-screen="screenAuth"] #headerBlock,
      body[data-screen="screenChoose"] #headerBlock{display:none!important}
      #boot{padding:24px;flex-direction:column;color:#11424a;background:radial-gradient(circle at top left,rgba(15,199,206,.12),transparent 32%),radial-gradient(circle at bottom right,rgba(15,199,206,.08),transparent 28%),#f7fbfc;transition:opacity .35s ease}
      #boot.hidden{display:flex!important;opacity:0;pointer-events:none}
      #boot.medsi-boot-gone{display:none!important}
      .parent-boot-title{font-size:18px;font-weight:700;margin:0 0 10px}
      .parent-boot-text{font-size:15px;color:#5f7f86;margin:0 0 22px;min-height:20px;text-align:center}
      .parent-boot-logo{position:relative;width:104px;height:48px}
      .parent-boot-dot{position:absolute;border-radius:50%;background:#0fc7ce;box-shadow:0 3px 10px rgba(15,199,206,.10);animation:parentBootFloat 1.8s infinite ease-in-out}
      .parent-boot-dot:nth-child(1){width:28px;height:28px;left:0;bottom:2px}
      .parent-boot-dot:nth-child(2){width:22px;height:22px;left:23px;top:1px;animation-delay:.1s}
      .parent-boot-dot:nth-child(3){width:19px;height:19px;left:45px;bottom:8px;animation-delay:.2s}
      .parent-boot-dot:nth-child(4){width:16px;height:16px;left:66px;top:5px;animation-delay:.3s}
      .parent-boot-dot:nth-child(5){width:12px;height:12px;left:84px;bottom:11px;animation-delay:.4s}
      @keyframes parentBootFloat{0%,100%{transform:translateY(0) scale(1);opacity:.95}50%{transform:translateY(-4px) scale(1.03);opacity:1}}

      #chatOverlay{position:fixed!important;inset:0!important;z-index:1000!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:clamp(8px,2vmin,18px)!important;background:radial-gradient(circle at top left,rgba(15,199,206,.10),transparent 32%),radial-gradient(circle at bottom right,rgba(15,199,206,.08),transparent 28%),#f7fbfc!important;overflow:hidden!important}
      #chatOverlay.hidden{display:none!important}
      #chatOverlayClose{display:none!important}
      #chatOverlayError{position:absolute!important;left:50%!important;top:18px!important;transform:translateX(-50%)!important;z-index:1002!important;width:min(560px,calc(100% - 32px))!important;margin:0!important;padding:10px 13px!important;border-radius:13px!important;background:#fff0f0!important;color:#a63f45!important;box-shadow:0 12px 28px rgba(17,66,74,.16)!important}
      #chatOverlayBody{width:min(94vmin,860px)!important;height:min(92dvh,860px)!important;max-width:100%!important;max-height:calc(100dvh - 16px)!important;display:flex!important;min-height:0!important;overflow:hidden!important}
      #chatOverlayBody>.medsi-legacy-wrap.parent-role{width:100%!important;height:100%!important;padding:0!important;background:transparent!important;align-items:center!important;justify-content:center!important}
      #chatOverlayBody .medsi-legacy-card{width:100%!important;height:100%!important;min-height:0!important}
      .parent-chat-loading{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid rgba(15,199,206,.18);border-radius:22px;box-shadow:0 12px 34px rgba(15,199,206,.10);color:#5f7f86;gap:10px}
      .parent-chat-loading .report-loading-spinner{flex:0 0 auto}
      @media(max-width:560px){#chatOverlay{padding:8px!important}#chatOverlayBody{width:100%!important;height:calc(100dvh - 16px)!important}}
    `;
    document.head.appendChild(style);
  }

  function installBoot(){
    const boot=$('boot');
    if(!boot)return;
    boot.innerHTML='<h1 class="parent-boot-title">Медси Бот</h1><p id="parentBootText" class="parent-boot-text">Подключаемся…</p><div class="parent-boot-logo"><span class="parent-boot-dot"></span><span class="parent-boot-dot"></span><span class="parent-boot-dot"></span><span class="parent-boot-dot"></span><span class="parent-boot-dot"></span></div>';
    const phrases=['Подключаемся…','Загружаем интерфейс…','Почти готово…','Ещё секундочку…'];
    let i=0;
    const timer=setInterval(()=>{const el=$('parentBootText');if(!el){clearInterval(timer);return}i=(i+1)%phrases.length;el.textContent=phrases[i]},850);
    const observer=new MutationObserver(()=>{
      if(!boot.classList.contains('hidden'))return;
      clearInterval(timer);
      observer.disconnect();
      setTimeout(()=>boot.classList.add('medsi-boot-gone'),350);
    });
    observer.observe(boot,{attributes:true,attributeFilter:['class']});
    if(boot.classList.contains('hidden')){clearInterval(timer);setTimeout(()=>boot.classList.add('medsi-boot-gone'),350)}
  }

  async function callApi(method,args){
    const r=await fetch(APP_BASE_URL,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'api',method,args:args||[]}),cache:'no-store'});
    const p=await r.json();
    if(!r.ok||!p||p.ok!==true)throw new Error((p&&p.message)||('HTTP '+r.status));
    return p.result;
  }

  function cachedSession(phone){
    try{
      const saved=JSON.parse(get(D1_KEY)||'null');
      if(!saved||digits(saved.phone).slice(-10)!==digits(phone).slice(-10))return null;
      const s=saved.session||saved;
      if(!s||!s.token||Number(s.expiresAt||0)<=Date.now()+30000)return null;
      return s;
    }catch(_){return null}
  }

  async function getSession(phone){
    const cached=cachedSession(phone);
    if(cached)return cached;
    const res=await callApi('getD1ChatSession',['parent',phone,'']);
    const s=res&&res.token?res:res&&res.session&&res.session.token?res.session:null;
    if(!s)throw new Error('Apps Script не вернул сессию чата.');
    set(D1_KEY,JSON.stringify({phone:digits(phone).slice(-10),session:s}));
    return s;
  }

  let cleanup=null;
  function closeChat(){
    if(cleanup){try{cleanup()}catch(_){}cleanup=null}
    const root=$('chatOverlay'),body=$('chatOverlayBody'),err=$('chatOverlayError');
    if(root)root.classList.add('hidden');
    if(body)body.replaceChildren();
    if(err){err.textContent='';err.classList.add('hidden')}
  }

  function chatApi(){
    const root=$('chatOverlay'),body=$('chatOverlayBody'),err=$('chatOverlayError');
    return{
      root,body,
      showError(message){if(!err)return;err.textContent=String(message||'Не удалось открыть чат.');err.classList.remove('hidden')},
      clearError(){if(!err)return;err.textContent='';err.classList.add('hidden')},
      close:closeChat
    };
  }

  async function openParentChat(){
    const phone=digits(get(PHONE_KEY)||get('medsi_phone'));
    const root=$('chatOverlay'),body=$('chatOverlayBody'),err=$('chatOverlayError');
    if(phone.length<10||!root||!body)return;
    root.classList.remove('hidden');
    if(err){err.textContent='';err.classList.add('hidden')}
    body.innerHTML='<div class="parent-chat-loading"><span class="report-loading-spinner"></span><span>Подключаем чат…</span></div>';
    try{
      const session=await getSession(phone);
      if(!window.MedsiParentOverlayChat)throw new Error('Компонент чата не загрузился.');
      body.replaceChildren();
      cleanup=MedsiParentOverlayChat.mount(chatApi(),{role:'parent',phone,parentName:get(PARENT_KEY),childName:get(CHILD_KEY),session})||null;
      if(!body.children.length)throw new Error('Чат не удалось отрисовать.');
    }catch(e){
      console.error('Parent chat open failed',e);
      body.innerHTML='<div class="parent-chat-loading">Не удалось открыть чат.</div>';
      chatApi().showError((e&&e.message)||'Не удалось открыть чат.');
    }
  }

  function installChatOverride(){
    const btn=$('btnChat');
    if(btn)btn.onclick=openParentChat;
    const close=$('chatOverlayClose');
    if(close)close.onclick=closeChat;
  }

  installStyle();
  installBoot();
  installChatOverride();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installChatOverride,{once:true});
  setTimeout(installChatOverride,100);
  setTimeout(installChatOverride,500);
})();