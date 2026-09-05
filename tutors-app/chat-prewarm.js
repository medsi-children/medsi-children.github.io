(function(){
  const transport=window.MedsiOverlayTransport;
  if(!transport||transport.__medsiPrewarmWrapped)return;
  transport.__medsiPrewarmWrapped=true;

  const SESSION_KEY='medsi_d1_educator_session_v1';
  const CACHE_PREFIX='medsi_educator_chat_cache_v3:';
  const LIST_TTL=45000;
  const THREAD_TTL=45000;
  const listCache=new Map();
  const threadCache=new Map();
  const listInFlight=new Map();
  const threadInFlight=new Map();
  const warmQueue=[];
  const warmQueued=new Set();
  let warming=false;
  let startedForToken='';

  const original={
    chats:transport.chats.bind(transport),
    thread:transport.thread.bind(transport),
    sendMessage:transport.sendMessage.bind(transport),
    markRead:transport.markRead.bind(transport),
    markUnread:transport.markUnread.bind(transport),
    remove:transport.remove.bind(transport),
    pin:transport.pin.bind(transport)
  };

  const phone10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  const now=()=>Date.now();
  const tokenPart=s=>String(s&&s.token||'').slice(-18);
  const sameSession=(a,b)=>!!(a&&b&&a.token&&b.token&&a.token===b.token);

  function savedSession(){
    try{
      const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
      if(!s||!s.token)return null;
      if(Number(s.expiresAt||0)&&Number(s.expiresAt)<=Date.now()+3000)return null;
      return s;
    }catch(_){return null}
  }

  function storageGet(key,ttl){
    try{
      const x=JSON.parse(sessionStorage.getItem(CACHE_PREFIX+key)||'null');
      if(!x||!x.value||now()-Number(x.at||0)>ttl)return null;
      return x;
    }catch(_){return null}
  }
  function storageSet(key,value){
    try{sessionStorage.setItem(CACHE_PREFIX+key,JSON.stringify({value,at:now()}))}catch(_){}
  }
  function storageDeletePrefix(prefix){
    try{Object.keys(sessionStorage).filter(k=>k.startsWith(CACHE_PREFIX+prefix)).forEach(k=>sessionStorage.removeItem(k))}catch(_){}
  }

  function listKey(session,bucket){return 'list:'+tokenPart(session)+':'+String(bucket||'all')}
  function threadKey(session,phone,before,limit){return 'thread:'+tokenPart(session)+':'+phone10(phone)+':'+String(before||'')+':'+String(limit||50)}

  async function fetchList(session,bucket){
    const key=listKey(session,bucket);
    if(listInFlight.has(key))return listInFlight.get(key);
    let p;
    p=original.chats(session,bucket).then(res=>{
      const entry={value:res,at:now()};
      listCache.set(key,entry);storageSet(key,res);return res;
    }).finally(()=>{if(listInFlight.get(key)===p)listInFlight.delete(key)});
    listInFlight.set(key,p);return p;
  }

  async function fetchThread(session,phone,before,limit){
    const key=threadKey(session,phone,before,limit);
    if(threadInFlight.has(key))return threadInFlight.get(key);
    let p;
    p=original.thread(session,phone,before,limit).then(res=>{
      const entry={value:res,at:now()};
      threadCache.set(key,entry);storageSet(key,res);return res;
    }).finally(()=>{if(threadInFlight.get(key)===p)threadInFlight.delete(key)});
    threadInFlight.set(key,p);return p;
  }

  function readList(session,bucket){
    const key=listKey(session,bucket);
    const mem=listCache.get(key);if(mem&&now()-mem.at<LIST_TTL)return mem;
    const stored=storageGet(key,LIST_TTL);if(stored){listCache.set(key,stored);return stored}
    return null;
  }
  function readThread(session,phone,before,limit){
    const key=threadKey(session,phone,before,limit);
    const mem=threadCache.get(key);if(mem&&now()-mem.at<THREAD_TTL)return mem;
    const stored=storageGet(key,THREAD_TTL);if(stored){threadCache.set(key,stored);return stored}
    return null;
  }

  transport.chats=function(session,bucket){
    const cached=readList(session,bucket);
    if(cached){
      fetchList(session,bucket).then(res=>queueWarmFromList(session,res)).catch(()=>{});
      return Promise.resolve(cached.value);
    }
    return fetchList(session,bucket).then(res=>{queueWarmFromList(session,res);return res});
  };

  transport.thread=function(session,phone,before,limit){
    const cached=readThread(session,phone,before,limit);
    if(cached){
      if(!before)fetchThread(session,phone,before,limit).catch(()=>{});
      return Promise.resolve(cached.value);
    }
    return fetchThread(session,phone,before,limit);
  };

  function clearLists(session){
    const prefix='list:'+tokenPart(session)+':';
    [...listCache.keys()].forEach(k=>{if(k.startsWith(prefix))listCache.delete(k)});
    storageDeletePrefix(prefix);
  }
  function clearPhoneThreads(session,phone){
    const prefix='thread:'+tokenPart(session)+':'+phone10(phone)+':';
    [...threadCache.keys()].forEach(k=>{if(k.startsWith(prefix))threadCache.delete(k)});
    storageDeletePrefix(prefix);
  }

  transport.sendMessage=async function(session,role,phone,message){
    const res=await original.sendMessage(session,role,phone,message);
    clearPhoneThreads(session,phone);clearLists(session);return res;
  };
  transport.markRead=async function(session,role,phone){
    const res=await original.markRead(session,role,phone);clearLists(session);return res;
  };
  transport.markUnread=async function(session,phone){
    const res=await original.markUnread(session,phone);clearLists(session);return res;
  };
  transport.remove=async function(session,role,key){
    const res=await original.remove(session,role,key);
    clearLists(session);threadCache.clear();storageDeletePrefix('thread:'+tokenPart(session)+':');return res;
  };
  transport.pin=async function(session,phone,bucket){
    const res=await original.pin(session,phone,bucket);clearLists(session);return res;
  };

  function queueWarmFromList(session,res){
    const chats=Array.isArray(res&&res.chats)?res.chats:[];
    chats.slice(0,8).forEach(chat=>{
      const phone=phone10(chat&&chat.phone);if(!phone)return;
      const qkey=tokenPart(session)+':'+phone;
      if(warmQueued.has(qkey)||readThread(session,phone,'',100))return;
      warmQueued.add(qkey);warmQueue.push({session,phone,qkey});
    });
    runWarmQueue();
  }

  async function runWarmQueue(){
    if(warming)return;warming=true;
    try{
      while(warmQueue.length){
        const item=warmQueue.shift();warmQueued.delete(item.qkey);
        if(!sameSession(savedSession(),item.session))continue;
        try{await fetchThread(item.session,item.phone,'',100)}catch(_){}
        await new Promise(r=>setTimeout(r,160));
      }
    }finally{warming=false}
  }

  async function start(session){
    if(!session||!session.token||startedForToken===session.token)return;
    startedForToken=session.token;
    fetchList(session,'unread').then(res=>queueWarmFromList(session,res)).catch(()=>{});
    setTimeout(()=>{
      if(sameSession(savedSession(),session))fetchList(session,'read').then(res=>queueWarmFromList(session,res)).catch(()=>{});
    },500);
  }

  function kick(){const s=savedSession();if(s)start(s)}
  kick();
  const timer=setInterval(()=>{
    const s=savedSession();
    if(s&&s.token!==startedForToken)start(s);
    if(startedForToken&&s&&s.token===startedForToken)clearInterval(timer);
  },450);
  setTimeout(()=>clearInterval(timer),30000);

  window.MedsiEducatorPrewarm={
    kick,
    clear(){listCache.clear();threadCache.clear();listInFlight.clear();threadInFlight.clear();warmQueue.length=0;warmQueued.clear();storageDeletePrefix('');startedForToken=''}
  };
})();