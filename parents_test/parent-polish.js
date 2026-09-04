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
      .medsi-chat-overlay.parent-original-active{background:radial-gradient(circle at top left,rgba(15,199,206,.10),transparent 32%),radial-gradient(circle at bottom right,rgba(15,199,206,.08),transparent 28%),#f7fbfc}
      .medsi-chat-overlay.parent-original-active .medsi-chat-overlay__body{display:flex;align-items:center;justify-content:center;overflow:hidden;padding:clamp(8px,2vmin,18px)}
      .medsi-chat-overlay.parent-original-active .medsi-legacy-wrap.parent-role{width:100%!important;height:100%!important;padding:0!important;align-items:center!important;justify-content:center!important;background:transparent!important}
      .medsi-chat-overlay.parent-original-active .medsi-legacy-card{width:min(94vmin,860px)!important;max-width:100%!important;height:min(92dvh,860px)!important;max-height:calc(100dvh - 16px)!important}
      @media(max-width:560px){.medsi-chat-overlay.parent-original-active .medsi-chat-overlay__body{padding:8px}.medsi-chat-overlay.parent-original-active .medsi-legacy-card{width:100%!important;height:calc(100dvh - 16px)!important}}
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

  let overlay=null,cleanup=null;
  function ensureOverlay(){
    if(overlay)return overlay;
    if(!window.MedsiChatOverlay||!window.MedsiParentOverlayChat)throw new Error('Компонент чата не загрузился.');
    overlay=MedsiChatOverlay.create({
      onOpen:(state,api)=>{
        api.root.classList.add('parent-original-active');
        if(cleanup){try{cleanup()}catch(_){}cleanup=null}
        try{cleanup=MedsiParentOverlayChat.mount(api,state)||null}
        catch(e){api.showError((e&&e.message)||'Не удалось отрисовать чат.');console.error('Parent chat mount failed',e)}
      },
      onClose:()=>{if(cleanup){try{cleanup()}catch(_){}cleanup=null}}
    });
    overlay.root.classList.add('parent-original-active');
    return overlay;
  }

  async function openParentChat(){
    const phone=digits(get(PHONE_KEY)||get('medsi_phone'));
    if(phone.length<10)return;
    try{
      const session=await getSession(phone);
      if(window.MedsiParentPrewarm)await MedsiParentPrewarm.ready(phone).catch(()=>{});
      const ov=ensureOverlay();
      ov.open({role:'parent',phone,parentName:get(PARENT_KEY),childName:get(CHILD_KEY),session});
    }catch(e){
      console.error('Parent chat open failed',e);
      try{ensureOverlay().showError((e&&e.message)||'Не удалось открыть чат.')}catch(_){}
    }
  }

  function installChatOverride(){
    const btn=$('btnChat');
    if(!btn)return;
    btn.onclick=openParentChat;
  }

  function loadOverlayCore(){
    if(window.MedsiChatOverlay){installChatOverride();return}
    const script=document.createElement('script');
    script.src='/chat-overlay/overlay-core.js?v=3';
    script.onload=installChatOverride;
    script.onerror=()=>console.error('Не удалось загрузить overlay-core.js');
    document.head.appendChild(script);
  }

  installStyle();
  installBoot();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadOverlayCore,{once:true});else loadOverlayCore();
  setTimeout(installChatOverride,250);
})();
