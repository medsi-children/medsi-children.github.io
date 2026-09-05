(function(){
  const TUTOR_KEY='medsi_tutor_session_v1';
  const RESET_KEY='medsi_educator_push_reset';
  const RESET_ID='20260905-staff-reset-1';
  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const PUSH_SERVICE_URL='https://medsi-push-worker.medsi-children.workers.dev';
  const SERVICE_WORKER_URL='/sw.js?v=20260629-panel2';
  const nativeFetch=window.fetch.bind(window);
  let started=false;

  function tutorToken(){
    try{return String(localStorage.getItem(TUTOR_KEY)||'').trim()}catch(_){return''}
  }

  window.fetch=function(input,init){
    try{
      const url=typeof input==='string'?input:String(input&&input.url||'');
      if(/\/subscribe(?:\?|$)/.test(url)&&init&&typeof init.body==='string'){
        const body=JSON.parse(init.body);
        if(String(body&&body.role||'').toLowerCase()==='educator'){
          body.tutorToken=tutorToken();
          init={...init,body:JSON.stringify(body)};
        }
      }
    }catch(_){}
    return nativeFetch(input,init);
  };

  async function applyOneTimeReset(){
    try{if(localStorage.getItem(RESET_KEY)===RESET_ID)return}catch(_){}
    try{
      if('serviceWorker' in navigator&&'PushManager' in window){
        const registration=await navigator.serviceWorker.register(SERVICE_WORKER_URL);
        const subscription=await registration.pushManager.getSubscription();
        if(subscription)await subscription.unsubscribe();
      }
    }catch(_){}
    try{localStorage.setItem(RESET_KEY,RESET_ID)}catch(_){}
  }

  async function startPush(){
    if(started||!window.MedsiPush)return;
    if(!tutorToken())return;
    started=true;
    await applyOneTimeReset();
    window.MedsiPush.init({
      frameId:'__no_tutor_iframe__',
      appEndpointUrl:APP_BASE_URL,
      pushServiceUrl:PUSH_SERVICE_URL,
      identity:{role:'educator',phone:''}
    });
  }

  const timer=setInterval(()=>{
    startPush().catch(()=>{});
    if(started)clearInterval(timer);
  },250);
  setTimeout(()=>clearInterval(timer),30000);
  startPush().catch(()=>{});
})();
