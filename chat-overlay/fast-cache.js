(function(){
  const t=window.MedsiOverlayTransport;
  if(!t||t.__medsiFastCachePatched)return;
  t.__medsiFastCachePatched=true;

  const chatsCache=new Map();
  const threadCache=new Map();
  const inflight=new Map();
  const now=()=>Date.now();
  const tokenKey=s=>String(s&&s.token||'').slice(-24);
  const phone10=v=>String(v||'').replace(/\D+/g,'').slice(-10);

  function cached(map,key,maxAge){
    const hit=map.get(key);
    return hit&&now()-hit.at<maxAge?hit.value:null;
  }
  function remember(map,key,value){map.set(key,{at:now(),value});return value}
  function once(key,fn){
    if(inflight.has(key))return inflight.get(key);
    const p=Promise.resolve().then(fn).finally(()=>inflight.delete(key));
    inflight.set(key,p);return p;
  }

  if(typeof t.chats==='function'){
    const original=t.chats.bind(t);
    t.chats=function(session,bucket){
      const key=tokenKey(session)+'|'+String(bucket||'all');
      const hit=cached(chatsCache,key,12000);
      if(hit)return Promise.resolve(hit);
      return once('chats|'+key,()=>original(session,bucket).then(v=>remember(chatsCache,key,v)));
    };
  }

  if(typeof t.thread==='function'){
    const original=t.thread.bind(t);
    t.thread=function(session,phone,beforeKey,limit){
      const key=tokenKey(session)+'|'+phone10(phone)+'|'+String(beforeKey||'')+'|'+String(limit||'');
      const hit=cached(threadCache,key,8000);
      if(hit)return Promise.resolve(hit);
      return once('thread|'+key,()=>original(session,phone,beforeKey,limit).then(v=>remember(threadCache,key,v)));
    };
  }

  function clearThread(phone){
    const p=phone10(phone);
    for(const key of threadCache.keys())if(key.includes('|'+p+'|'))threadCache.delete(key);
  }
  function clearChats(){chatsCache.clear()}
  ['sendMessage','edit','remove','react'].forEach(name=>{
    if(typeof t[name]!=='function')return;
    const original=t[name].bind(t);
    t[name]=async function(){
      const args=[...arguments];
      const result=await original(...args);
      clearChats();
      const phone=name==='sendMessage'?args[2]:'';
      if(phone)clearThread(phone); else threadCache.clear();
      return result;
    };
  });
  if(typeof t.pin==='function'){
    const original=t.pin.bind(t);
    t.pin=async function(){const r=await original(...arguments);clearChats();return r};
  }

  window.MedsiOverlayFastCache={clear(){chatsCache.clear();threadCache.clear()}};
})();