(function(){
  if(window.__medsiTimewebSessionClient)return;
  window.__medsiTimewebSessionClient=true;

  const nativeFetch=window.fetch.bind(window);
  const allowed=new Set(['getD1ChatSession','verifyTutorSession','verifyTutorAccess']);

  window.fetch=function(input,init){
    try{
      const url=typeof input==='string'?input:(input&&input.url)||'';
      const body=init&&typeof init.body==='string'?init.body:'';
      if(url.includes('script.google.com/macros/s/')&&body){
        const payload=JSON.parse(body);
        if(payload&&payload.action==='api'&&allowed.has(String(payload.method||''))){
          return nativeFetch('/__session/apps-script',{
            method:'POST',
            headers:{'content-type':'application/json'},
            body:JSON.stringify(payload),
            cache:'no-store'
          });
        }
      }
    }catch(_){}
    return nativeFetch(input,init);
  };
})();
