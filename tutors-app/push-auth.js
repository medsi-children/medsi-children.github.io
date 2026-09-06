(function(){
  const TUTOR_KEY='medsi_tutor_session_v1';
  const PUSH_ORIGIN='https://medsi-push-worker.medsi-children.workers.dev';
  const nativeFetch=window.fetch.bind(window);

  function tutorToken(){
    try{return String(localStorage.getItem(TUTOR_KEY)||'').trim()}catch(_){return''}
  }

  window.fetch=function(input,init){
    let nextInput=input;
    try{
      let url=typeof input==='string'?input:String(input&&input.url||'');
      if(url.startsWith(PUSH_ORIGIN)){
        const parsed=new URL(url);
        nextInput='/push'+parsed.pathname+parsed.search;
        url=String(nextInput);
      }
      if(/\/subscribe(?:\?|$)/.test(url)&&init&&typeof init.body==='string'){
        const body=JSON.parse(init.body);
        if(String(body&&body.role||'').toLowerCase()==='educator'){
          const token=tutorToken();
          if(token){
            body.tutorToken=token;
            init={...init,body:JSON.stringify(body)};
          }
        }
      }
    }catch(_){}
    return nativeFetch(nextInput,init);
  };
})();
