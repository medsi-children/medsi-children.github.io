(function(){
  document.documentElement.classList.add('medsi-parent-ready');

  if(!document.getElementById('medsi-date-chip-theme')){
    const style=document.createElement('style');
    style.id='medsi-date-chip-theme';
    style.textContent=`
      .medsi-date-separator{
        background:#f2fcfd!important;
        border-color:rgba(22,184,192,.25)!important;
        box-shadow:0 3px 10px rgba(22,184,192,.06)!important;
        color:#16aeb7!important;
      }
    `;
    document.head.appendChild(style);
  }

  const PUSH_ORIGIN='https://medsi-push-worker.medsi-children.workers.dev';
  const nativeFetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    let nextInput=input;
    try{
      const url=typeof input==='string'?input:String(input&&input.url||'');
      if(url.startsWith(PUSH_ORIGIN)){
        const parsed=new URL(url);
        nextInput='/push'+parsed.pathname+parsed.search;
      }
    }catch(_){}
    return nativeFetch(nextInput,init);
  };

  function syncPushPanel(){
    if(!window.MedsiPush)return;
    MedsiPush.setPanelVisible(document.body.dataset.screen==='screenChoose');
  }
  const observer=new MutationObserver(syncPushPanel);
  observer.observe(document.body,{attributes:true,attributeFilter:['data-screen']});
  syncPushPanel();

})();
