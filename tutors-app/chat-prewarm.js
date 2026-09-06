(function(){
  if(!document.querySelector('script[data-medsi-upload-ux]')){const s=document.createElement('script');s.src='/chat-overlay/upload-ux.js?v=20260905-uploadux1';s.dataset.medsiUploadUx='1';document.head.appendChild(s)}
  if(!document.querySelector('script[data-medsi-chat-polish]')){const s=document.createElement('script');s.src='/chat-overlay/chat-polish.js?v=20260906-polish1';s.dataset.medsiChatPolish='1';document.head.appendChild(s)}
  const transport=window.MedsiOverlayTransport;
  if(!transport||transport.__medsiPrewarmWrapped)return;
  transport.__medsiPrewarmWrapped=true;

  const SESSION_KEY='medsi_d1_educator_session_v1';
  const TUTOR_KEY='medsi_tutor_session_v1';
  const APP_BASE_URL=window.MEDSI_APP_BASE_URL||'https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const listCache=new Map(),threadCache=new Map(),listInFlight=new Map(),threadInFlight=new Map();
  let sessionRequest=null,startedForToken='',backgroundRun=0;
  const original={chats:transport.chats.bind(transport),thread:transport.thread.bind(transport),sendMessage:transport.sendMessage.bind(transport),markRead:transport.markRead.bind(transport),markUnread:transport.markUnread.bind(transport),remove:transport.remove.bind(transport),pin:transport.pin.bind(transport)};
  const phone10=v=>String(v||'').replace(/\D+/g,'').slice(-10),now=()=>Date.now();
  const sameSession=(a,b)=>!!(a&&b&&a.token&&b.token&&a.token===b.token);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function savedSession(){try{const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');if(!s||!s.token)return null;if(Number(s.expiresAt||0)&&Number(s.expiresAt)<=Date.now()+3000)return null;return s}catch(_){return null}}
  function saveSession(s){try{if(s&&s.token)localStorage.setItem(SESSION_KEY,JSON.stringify(s))}catch(_){}return s}
  function listKey(session,bucket){return String(session&&session.token||'').slice(-18)+'|'+String(bucket||'all')}
  function threadKey(session,phone,before,limit){return String(session&&session.token||'').slice(-18)+'|'+phone10(phone)+'|'+String(before||'')+'|'+String(limit||50)}
  async function fetchList(session,bucket){const key=listKey(session,bucket);if(listInFlight.has(key))return listInFlight.get(key);const p=original.chats(session,bucket).then(res=>{listCache.set(key,{value:res,at:now()});return res}).finally(()=>listInFlight.delete(key));listInFlight.set(key,p);return p}
  async function fetchThread(session,phone,before,limit){const key=threadKey(session,phone,before,limit);if(threadInFlight.has(key))return threadInFlight.get(key);const p=original.thread(session,phone,before,limit).then(res=>{threadCache.set(key,{value:res,at:now()});return res}).finally(()=>threadInFlight.delete(key));threadInFlight.set(key,p);return p}
  async function warmThread(session,phone){
    const key=threadKey(session,phone,'',100);
    const cached=threadCache.get(key);if(cached&&now()-cached.at<45000)return cached.value;
    try{const res=await original.thread(session,phone,'',100);threadCache.set(key,{value:res,at:now()});return res}catch(_){return null}
  }
  transport.chats=function(session,bucket){const key=listKey(session,bucket),cached=listCache.get(key);if(cached){if(now()-cached.at>3500)fetchList(session,bucket).catch(()=>{});return Promise.resolve(cached.value)}return fetchList(session,bucket)};
  transport.thread=function(session,phone,before,limit){const key=threadKey(session,phone,before,limit),cached=threadCache.get(key);if(cached){if(now()-cached.at>5000)warmThread(session,phone).catch(()=>{});return Promise.resolve(cached.value)}return fetchThread(session,phone,before,limit)};
  function clearLists(session){const prefix=String(session&&session.token||'').slice(-18)+'|';[...listCache.keys()].forEach(k=>{if(k.startsWith(prefix))listCache.delete(k)})}
  function clearPhoneThreads(session,phone){const prefix=String(session&&session.token||'').slice(-18)+'|'+phone10(phone)+'|';[...threadCache.keys()].forEach(k=>{if(k.startsWith(prefix))threadCache.delete(k)})}
  transport.sendMessage=async function(session,role,phone,message){const res=await original.sendMessage(session,role,phone,message);clearPhoneThreads(session,phone);clearLists(session);return res};
  transport.markRead=async function(session,role,phone){const res=await original.markRead(session,role,phone);clearLists(session);return res};
  transport.markUnread=async function(session,phone){const res=await original.markUnread(session,phone);clearLists(session);return res};
  transport.remove=async function(session,role,key){const res=await original.remove(session,role,key);clearLists(session);threadCache.clear();return res};
  transport.pin=async function(session,phone,bucket){const res=await original.pin(session,phone,bucket);clearLists(session);return res};

  function uniquePhones(chats){const seen=new Set(),out=[];(chats||[]).forEach(chat=>{const p=phone10(chat&&chat.phone);if(p&&!seen.has(p)){seen.add(p);out.push(p)}});return out}
  async function warmQueue(session,phones,runId,delay){
    for(const phone of phones){
      if(runId!==backgroundRun||document.hidden||!sameSession(savedSession(),session))return;
      await warmThread(session,phone);
      await sleep(delay);
    }
  }
  async function start(session){
    if(!session||!session.token||startedForToken===session.token)return;
    startedForToken=session.token;
    const runId=++backgroundRun;
    try{
      const [u,r]=await Promise.all([fetchList(session,'unread').catch(()=>({chats:[]})),fetchList(session,'read').catch(()=>({chats:[]}))]);
      if(runId!==backgroundRun||!sameSession(savedSession(),session))return;
      const unread=Array.isArray(u&&u.chats)?u.chats:[],read=Array.isArray(r&&r.chats)?r.chats:[];
      const all=uniquePhones(unread.concat(read));
      const priority=all.slice(0,4),rest=all.slice(4);
      await warmQueue(session,priority,runId,90);
      if(rest.length){await sleep(1200);await warmQueue(session,rest,runId,180)}
    }catch(_){}
  }
  async function ensureSession(){const existing=savedSession();if(existing){start(existing);return existing}const tutor=String(localStorage.getItem(TUTOR_KEY)||'');if(!tutor)return null;if(sessionRequest)return sessionRequest;sessionRequest=(async()=>{try{const r=await fetch(APP_BASE_URL,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'api',method:'getD1ChatSession',args:['educator','',tutor]}),cache:'no-store'});const p=await r.json();const x=p&&p.ok?p.result:null;const s=x&&x.d1Session&&x.d1Session.token?x.d1Session:x&&x.session&&x.session.token?x.session:x&&x.token?x:null;if(s&&s.token){saveSession(s);start(s);return s}}catch(_){}return null})().finally(()=>{sessionRequest=null});return sessionRequest}
  function kick(){ensureSession().catch(()=>{})}
  kick();
  const timer=setInterval(()=>{const s=savedSession();if(s&&s.token!==startedForToken)start(s);else if(!s)ensureSession().catch(()=>{});if(startedForToken&&s&&s.token===startedForToken)clearInterval(timer)},450);
  setTimeout(()=>clearInterval(timer),30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){const s=savedSession();if(s)start(s)}});
  window.MedsiEducatorPrewarm={kick,clear(){backgroundRun++;listCache.clear();threadCache.clear();startedForToken=''}};
})();
