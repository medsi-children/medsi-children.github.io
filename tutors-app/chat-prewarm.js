(function(){
  const transport=window.MedsiOverlayTransport;
  if(!transport||transport.__medsiPrewarmWrapped)return;
  transport.__medsiPrewarmWrapped=true;

  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const SESSION_KEY='medsi_d1_educator_session_v1';
  const TUTOR_KEY='medsi_tutor_session_v1';
  const listCache=new Map();
  const threadCache=new Map();
  const listInFlight=new Map();
  const threadInFlight=new Map();
  const warmedPhones=new Set();
  const warmQueuedPhones=new Set();
  const warmQueue=[];
  let warmWorkers=0;
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
  const tutorToken=()=>{try{return String(localStorage.getItem(TUTOR_KEY)||'')}catch(_){return''}};
  async function callApi(method,args,ms){
    const run=async()=>{const r=await fetch(APP_BASE_URL,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'api',method,args:args||[]}),cache:'no-store'});const raw=await r.text();let p;try{p=JSON.parse(raw)}catch(_){throw new Error('Apps Script вернул некорректный ответ.')}if(!r.ok||!p||p.ok!==true)throw new Error((p&&p.message)||('HTTP '+r.status));return p.result};
    return requestTimeout(run(),ms||15000);
  }
  async function fallbackChats(bucket){const tok=tutorToken();if(!tok)throw new Error('Сессия воспитателя недоступна.');return callApi('listD1ChatsForEducator',[tok,bucket||'all'],18000)}
  async function fallbackThread(phone,before,limit){const tok=tutorToken();if(!tok)throw new Error('Сессия воспитателя недоступна.');return callApi('getD1ThreadForEducator',[phone10(phone),tok,String(before||''),Number(limit)||50],18000)}
  async function fallbackSend(phone,message){const tok=tutorToken();if(!tok)throw new Error('Сессия воспитателя недоступна.');return callApi('sendD1MessageForEducator',[phone10(phone),message||{},tok],20000)}

  function resilient(direct,fallback){
    return new Promise((resolve,reject)=>{
      let done=false,fallbackStarted=false,pending=1,lastError=null,timer=null;
      const win=value=>{if(done)return;done=true;if(timer)clearTimeout(timer);resolve(value)};
      const lose=error=>{lastError=error;pending-=1;if(!fallbackStarted){startFallback();return}if(pending<=0&&!done)reject(lastError)};
      const startFallback=()=>{
        if(done||fallbackStarted)return;
        fallbackStarted=true;pending+=1;
        Promise.resolve().then(fallback).then(win,lose);
      };
      Promise.resolve().then(direct).then(win,lose);
      timer=setTimeout(startFallback,900);
    });
  }

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
    p=resilient(()=>original.chats(session,bucket),()=>fallbackChats(bucket)).then(res=>{
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
    p=resilient(()=>original.thread(session,phone,before,limit),()=>fallbackThread(phone,before,limit)).then(res=>{
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
    const p=phone10(phone);
    const prefix=String(session&&session.token||'').slice(-18)+'|'+p+'|';
    [...threadCache.keys()].forEach(k=>{if(k.startsWith(prefix))threadCache.delete(k)});
    warmedPhones.delete(p);
  }

  transport.sendMessage=async function(session,role,phone,message){
    const res=await resilient(()=>original.sendMessage(session,role,phone,message),()=>fallbackSend(phone,message));
    clearPhoneThreads(session,phone);clearLists(session);return res;
  };
  transport.markRead=async function(session,role,phone){
    const res=await original.markRead(session,role,phone);clearLists(session);return res;
  };
  transport.markUnread=async function(session,phone){
    const res=await original.markUnread(session,phone);clearLists(session);return res;
  };
  transport.remove=async function(session,role,key){
    const res=await original.remove(session,role,key);clearLists(session);threadCache.clear();warmedPhones.clear();return res;
  };
  transport.pin=async function(session,phone,bucket){
    const res=await original.pin(session,phone,bucket);clearLists(session);return res;
  };

  function backgroundConcurrency(){
    const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    if(c&&c.saveData)return 1;
    const type=String(c&&c.effectiveType||'').toLowerCase();
    if(type==='slow-2g'||type==='2g'||type==='3g')return 1;
    return /iPhone|iPad|Android/i.test(navigator.userAgent||'')?1:2;
  }

  function queueWarm(session,chats){
    if(!session||!session.token)return;
    (chats||[]).forEach(chat=>{
      const p=phone10(chat&&chat.phone);
      if(!p||warmedPhones.has(p)||warmQueuedPhones.has(p))return;
      warmQueuedPhones.add(p);
      warmQueue.push({session,phone:p});
    });
    scheduleWarmWorkers();
  }

  function scheduleWarmWorkers(){
    const max=backgroundConcurrency();
    while(warmWorkers<max&&warmQueue.length){
      warmWorkers+=1;
      setTimeout(runWarmWorker,180);
    }
  }

  async function runWarmWorker(){
    try{
      while(warmQueue.length){
        const item=warmQueue.shift();
        const p=item&&item.phone;
        if(p)warmQueuedPhones.delete(p);
        const current=savedSession();
        if(!item||!sameSession(current,item.session))continue;
        if(warmedPhones.has(p))continue;
        try{
          await fetchThread(item.session,p,'',100);
          if(sameSession(savedSession(),item.session))warmedPhones.add(p);
        }catch(_){}
        await new Promise(r=>setTimeout(r,120));
      }
    }finally{
      warmWorkers=Math.max(0,warmWorkers-1);
      if(warmQueue.length)scheduleWarmWorkers();
    }
  }

  let startedForToken='';
  async function start(session){
    if(!session||!session.token||startedForToken===session.token)return;
    startedForToken=session.token;

    // Lists start warming immediately from the main menu. Each list feeds the
    // thread queue as soon as it arrives; we do not wait for the other bucket.
    const warmBucket=bucket=>fetchList(session,bucket).then(res=>{
      if(!sameSession(savedSession(),session))return res;
      const chats=Array.isArray(res&&res.chats)?res.chats:[];
      queueWarm(session,chats);
      return res;
    }).catch(()=>null);

    warmBucket('unread');
    setTimeout(()=>{
      if(sameSession(savedSession(),session))warmBucket('read');
    },220);
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
    usingFallback:()=>false,
    activateFallback:()=>{},
    callApi,
    tutorToken,
    clear(){listCache.clear();threadCache.clear();listInFlight.clear();threadInFlight.clear();warmedPhones.clear();warmQueuedPhones.clear();warmQueue.length=0;startedForToken=''}
  };
})();