(function(){
  const PRIMARY='https://chat.xn----btbhdqvtun.xn--p1ai';
  const BACKUP='https://medsi-chat-worker.medsi-children.workers.dev';
  const SESSION_KEY='medsi_d1_educator_session_v1';
  const objectUrls=new Map();

  function sessionToken(){
    try{
      const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
      return s&&s.token?String(s.token):'';
    }catch(_){return''}
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
  async function fetchBlob(base,key,token){
    const r=await fetch(base+'/media/'+encodeURIComponent(key),{headers:{'X-Medsi-Chat-Session':token},cache:'no-store'});
    if(!r.ok)throw new Error('MEDIA_HTTP_'+r.status);
    return r.blob();
  }
  function race(primary,backup,delay){
    return new Promise((resolve,reject)=>{
      let done=false,backupStarted=false,pending=1,lastError=null,timer=0;
      const win=v=>{if(done)return;done=true;if(timer)clearTimeout(timer);resolve(v)};
      const lose=e=>{lastError=e;pending--;if(!backupStarted){startBackup();return}if(pending<=0&&!done)reject(lastError)};
      const startBackup=()=>{if(done||backupStarted)return;backupStarted=true;pending++;Promise.resolve().then(backup).then(win,lose)};
      Promise.resolve().then(primary).then(win,lose);
      timer=setTimeout(startBackup,delay||900);
    });
  }
  async function resolveObjectUrl(key,token){
    if(objectUrls.has(key))return objectUrls.get(key);
    const blob=await race(()=>fetchBlob(PRIMARY,key,token),()=>fetchBlob(BACKUP,key,token),900);
    const url=URL.createObjectURL(blob);
    objectUrls.set(key,url);
    return url;
  }
  function patch(el){
    if(!el||el.dataset.medsiMediaAuth==='1')return;
    const src=String(el.getAttribute('src')||'');
    if(!src||src.startsWith('blob:'))return;
    const key=mediaKey(src);
    if(!key)return;
    const token=sessionToken();
    if(!token)return;
    el.dataset.medsiMediaAuth='1';
    resolveObjectUrl(key,token).then(url=>{
      if(!document.contains(el))return;
      el.src=url;
      if(el.tagName==='VIDEO')el.load();
    }).catch(()=>{delete el.dataset.medsiMediaAuth});
  }
  function scan(root){
    (root||document).querySelectorAll('img[src*="/media/"],video[src*="/media/"]').forEach(patch);
  }
  const observer=new MutationObserver(records=>{
    records.forEach(r=>{
      if(r.type==='attributes'&&r.target)patch(r.target);
      r.addedNodes&&r.addedNodes.forEach(n=>{if(n.nodeType!==1)return;patch(n);scan(n)});
    });
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
  scan(document);
})();