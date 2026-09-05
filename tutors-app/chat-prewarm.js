(function(){
  const transport=window.MedsiOverlayTransport;
  if(!transport||transport.__medsiPrewarmWrapped)return;
  transport.__medsiPrewarmWrapped=true;

  const SESSION_KEY='medsi_d1_educator_session_v1';
  const listCache=new Map();
  const threadCache=new Map();
  const listInFlight=new Map();
  const threadInFlight=new Map();
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
  const sameSession=(a,b)=>!!(a&&b&&a.token&&b.token&&a.token===b.token);
  const requestTimeout=(promise,ms)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>{const e=new Error('CHAT_PREWARM_TIMEOUT');e.code='CHAT_PREWARM_TIMEOUT';reject(e)},ms))]);

  function savedSession(){
    try{
      const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
      if(!s||!s.token)return null;
      if(Number(s.expiresAt||0)&&Number(s.expiresAt)<=Date.now()+3000)return null;
      return s;
    }catch(_){return null}
  }

  function listKey(session,bucket){return String(session&&session.token||'').slice(-18)+'|'+String(bucket||'all')}
  function threadKey(session,phone,before,limit){return String(session&&session.token||'').slice(-18)+'|'+phone10(phone)+'|'+String(before||'')+'|'+String(limit||50)}

  async function fetchList(session,bucket){
    const key=listKey(session,bucket);
    if(listInFlight.has(key))return listInFlight.get(key);
    let p;
    p=requestTimeout(original.chats(session,bucket),8000).then(res=>{
      listCache.set(key,{value:res,at:now()});
      return res;
    }).finally(()=>{if(listInFlight.get(key)===p)listInFlight.delete(key)});
    listInFlight.set(key,p);
    return p;
  }

  async function fetchThread(session,phone,before,limit){
    const key=threadKey(session,phone,before,limit);
    if(threadInFlight.has(key))return threadInFlight.get(key);
    let p;
    p=requestTimeout(original.thread(session,phone,before,limit),8000).then(res=>{
      threadCache.set(key,{value:res,at:now()});
      return res;
    }).finally(()=>{if(threadInFlight.get(key)===p)threadInFlight.delete(key)});
    threadInFlight.set(key,p);
    return p;
  }

  transport.chats=function(session,bucket){
    const key=listKey(session,bucket);
    const cached=listCache.get(key);
    if(cached){
      if(now()-cached.at>3500)fetchList(session,bucket).catch(()=>{});
      return Promise.resolve(cached.value);
    }
    return fetchList(session,bucket);
  };

  transport.thread=function(session,phone,before,limit){
    const key=threadKey(session,phone,before,limit);
    const cached=threadCache.get(key);
    if(cached){
      if(now()-cached.at>5000)fetchThread(session,phone,before,limit).catch(()=>{});
      return Promise.resolve(cached.value);
    }
    return fetchThread(session,phone,before,limit);
  };

  function clearLists(session){
    const prefix=String(session&&session.token||'').slice(-18)+'|';
    [...listCache.keys()].forEach(k=>{if(k.startsWith(prefix))listCache.delete(k)});
  }
  function clearPhoneThreads(session,phone){
    const prefix=String(session&&session.token||'').slice(-18)+'|'+phone10(phone)+'|';
    [...threadCache.keys()].forEach(k=>{if(k.startsWith(prefix))threadCache.delete(k)});
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
    const res=await original.remove(session,role,key);clearLists(session);threadCache.clear();return res;
  };
  transport.pin=async function(session,phone,bucket){
    const res=await original.pin(session,phone,bucket);clearLists(session);return res;
  };

  let startedForToken='';
  function concurrency(){
    const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    if(c&&c.saveData)return 1;
    const type=String(c&&c.effectiveType||'').toLowerCase();
    if(type==='slow-2g'||type==='2g')return 1;
    if(type==='3g')return 2;
    return /Android/i.test(navigator.userAgent||'')?3:4;
  }

  async function warmThreads(session,chats){
    const seen=new Set();
    const queue=[];
    (chats||[]).forEach(chat=>{
      const p=phone10(chat&&chat.phone);
      if(!p||seen.has(p))return;
      seen.add(p);queue.push(p);
    });
    if(!queue.length)return;

    let cursor=0;
    const worker=async()=>{
      while(cursor<queue.length){
        const index=cursor++;
        const phone=queue[index];
        if(!sameSession(savedSession(),session))return;
        try{await fetchThread(session,phone,'',100)}catch(_){}
        if(index<6)await new Promise(r=>setTimeout(r,12));
        else await new Promise(r=>setTimeout(r,35));
      }
    };
    await Promise.all(Array.from({length:Math.min(concurrency(),queue.length)},worker));
  }

  async function start(session){
    if(!session||!session.token||startedForToken===session.token)return;
    startedForToken=session.token;
    try{
      const [unreadRes,readRes]=await Promise.all([
        fetchList(session,'unread').catch(()=>({chats:[]})),
        fetchList(session,'read').catch(()=>({chats:[]}))
      ]);
      if(!sameSession(savedSession(),session))return;
      const unread=Array.isArray(unreadRes&&unreadRes.chats)?unreadRes.chats:[];
      const read=Array.isArray(readRes&&readRes.chats)?readRes.chats:[];
      await warmThreads(session,unread.concat(read));
    }catch(_){}
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
    clear(){listCache.clear();threadCache.clear();listInFlight.clear();threadInFlight.clear();startedForToken=''}
  };
})();
