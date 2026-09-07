(function(){
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
  new MutationObserver(syncPushPanel).observe(document.body,{
    attributes:true,
    attributeFilter:['data-screen']
  });
  syncPushPanel();
})();
