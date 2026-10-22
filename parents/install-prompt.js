(function(){
  const KEY='medsi-install-prompt-dismissed-v1';
  const dialog=document.getElementById('installPrompt');
  if(!dialog)return;
  const isStandalone=()=>!!navigator.standalone||window.matchMedia('(display-mode: standalone)').matches||window.matchMedia('(display-mode: fullscreen)').matches;
  const ua=navigator.userAgent||'';
  const isIphone=/iPhone|iPad|iPod/i.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const mobile=window.matchMedia('(max-width: 600px)').matches;
  let platform=isIphone?'iphone':'android',deferredInstall=null,opened=false;
  const tabs=[...dialog.querySelectorAll('[data-install-platform]')];
  const steps=[...dialog.querySelectorAll('[data-install-steps]')];
  const installButton=document.getElementById('installPromptInstall');
  function selectPlatform(next){
    platform=next;
    tabs.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.installPlatform===platform)));
    steps.forEach(section=>{section.hidden=mobile&&section.dataset.installSteps!==platform});
    installButton.hidden=!(deferredInstall&&platform==='android');
  }
  function close(remember){
    if(dialog.open){if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}
    opened=false;
    if(remember){try{localStorage.setItem(KEY,'1')}catch(_){}}
  }
  function open(){
    if(isStandalone())return false;
    selectPlatform(platform);
    if(!dialog.open){
      if(typeof dialog.showModal==='function')dialog.showModal();
      else dialog.setAttribute('open','');
    }
    opened=true;
    return true;
  }
  function openIfNeeded(){
    if(opened)return;
    if(isStandalone()||document.body.dataset.screen!=='screenStart'){
      if(dialog.open)close(false);
      return;
    }
    try{if(localStorage.getItem(KEY)==='1')return}catch(_){}
    open();
  }
  tabs.forEach(button=>button.addEventListener('click',()=>selectPlatform(button.dataset.installPlatform)));
  document.getElementById('installPromptContinue').addEventListener('click',()=>close(true));
  document.getElementById('installPromptClose').addEventListener('click',()=>close(true));
  dialog.addEventListener('cancel',event=>{event.preventDefault();close(true)});
  dialog.addEventListener('close',()=>{opened=false});
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();deferredInstall=event;selectPlatform(platform);
  });
  window.addEventListener('appinstalled',()=>close(true));
  installButton.addEventListener('click',async()=>{
    if(!deferredInstall)return;
    const prompt=deferredInstall;deferredInstall=null;selectPlatform(platform);
    try{await prompt.prompt();const choice=await prompt.userChoice;if(choice&&choice.outcome==='accepted')close(true)}catch(_){}
  });
  document.addEventListener('medsi:open-install-instructions',open);
  window.MedsiInstallPrompt={open,close:function(){close(false)}};
  const observer=new MutationObserver(openIfNeeded);
  observer.observe(document.body,{attributes:true,attributeFilter:['data-screen']});
  openIfNeeded();
})();
