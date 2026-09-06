(function(){
  const TUTOR_KEY='medsi_tutor_session_v1';
  const nativeFetch=window.fetch.bind(window);

  function tutorToken(){
    try{return String(localStorage.getItem(TUTOR_KEY)||'').trim()}catch(_){return''}
  }

  window.fetch=function(input,init){
    try{
      const url=typeof input==='string'?input:String(input&&input.url||'');
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
    return nativeFetch(input,init);
  };
})();
