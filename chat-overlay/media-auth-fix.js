(function(){
  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const TUTOR_KEY='medsi_tutor_session_v1';
  const imageCache=new Map();
  const PLACEHOLDER='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

  function tutorToken(){
    try{return String(localStorage.getItem(TUTOR_KEY)||'')}catch(_){return''}
  }

  function mediaKey(src){
    try{
      const u=new URL(src,location.href);
      const marker='/media/';
      const i=u.pathname.indexOf(marker);
      if(i<0)return'';
      return decodeURIComponent(u.pathname.slice(i+marker.length));
    }catch(_){return''}
  }

  async function callApi(method,args,ms){
    const request=fetch(APP_BASE_URL,{
      method:'POST',
      headers:{'content-type':'text/plain;charset=UTF-8'},
      body:JSON.stringify({action:'api',method,args:args||[]}),
      cache:'no-store'
    }).then(async r=>{
      const raw=await r.text();
      let p;
      try{p=JSON.parse(raw)}catch(_){throw new Error('Apps Script вернул некорректный ответ.')}
      if(!r.ok||!p||p.ok!==true)throw new Error((p&&p.message)||('HTTP '+r.status));
      return p.result;
    });
    return Promise.race([
      request,
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('MEDIA_FALLBACK_TIMEOUT')),ms||30000))
    ]);
  }

  function resolveImage(key){
    if(imageCache.has(key))return imageCache.get(key);
    const token=tutorToken();
    if(!token)return Promise.reject(new Error('NO_TUTOR_SESSION'));
    const p=callApi('getD1MediaForEducator',['kv:'+key,token],30000)
      .then(res=>{
        const dataUrl=String(res&&res.dataUrl||'');
        if(!/^data:image\//i.test(dataUrl))throw new Error('INVALID_MEDIA_DATA');
        return dataUrl;
      })
      .catch(err=>{imageCache.delete(key);throw err});
    imageCache.set(key,p);
    return p;
  }

  function patch(el){
    if(!el||el.tagName!=='IMG'||el.dataset.medsiMediaFallback==='1')return;
    const src=String(el.getAttribute('src')||'');
    if(!src||src.startsWith('data:')||src.startsWith('blob:'))return;
    const key=mediaKey(src);
    if(!key)return;

    el.dataset.medsiMediaFallback='1';
    el.dataset.medsiOriginalSrc=src;
    el.src=PLACEHOLDER;

    resolveImage(key).then(dataUrl=>{
      if(!document.contains(el))return;
      el.src=dataUrl;
      el.dataset.medsiMediaFallbackReady='1';
    }).catch(()=>{
      if(!document.contains(el))return;
      const original=el.dataset.medsiOriginalSrc||src;
      delete el.dataset.medsiMediaFallback;
      delete el.dataset.medsiOriginalSrc;
      el.src=original;
    });
  }

  function scan(root){
    const scope=root&&root.querySelectorAll?root:document;
    scope.querySelectorAll('img[src*="/media/"]').forEach(patch);
  }

  const observer=new MutationObserver(records=>{
    records.forEach(r=>{
      if(r.type==='attributes'&&r.target)patch(r.target);
      r.addedNodes&&r.addedNodes.forEach(n=>{
        if(n.nodeType!==1)return;
        patch(n);scan(n);
      });
    });
  });

  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
  scan(document);
})();