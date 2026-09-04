(function(){
  const $=id=>document.getElementById(id);

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
      clearInterval(timer);observer.disconnect();
      setTimeout(()=>boot.classList.add('medsi-boot-gone'),350);
    });
    observer.observe(boot,{attributes:true,attributeFilter:['class']});
    if(boot.classList.contains('hidden')){clearInterval(timer);setTimeout(()=>boot.classList.add('medsi-boot-gone'),350)}
  }

  function enforceLogoutLabel(){
    const btn=$('logoutBtn');
    if(!btn)return;
    if(btn.textContent!=='Выйти в меню')btn.textContent='Выйти в меню';
  }

  function installChatRoute(){
    const btn=$('btnChat');
    if(btn)btn.onclick=()=>{location.href='/parents_test/chat.html?v=radical1'};
  }

  function install(){
    enforceLogoutLabel();
    installChatRoute();
    const logout=$('logoutBtn');
    if(logout)new MutationObserver(enforceLogoutLabel).observe(logout,{childList:true,characterData:true,subtree:true});
  }

  installStyle();
  installBoot();
  install();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  setTimeout(install,100);
  setTimeout(install,500);
})();