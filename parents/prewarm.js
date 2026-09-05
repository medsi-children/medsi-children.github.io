(function(){
  const t=window.MedsiOverlayTransport;if(!t)return;
  const cache=new Map(),pending=new Map();
  const p10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  const originalThread=t.thread.bind(t),originalSend=t.sendMessage.bind(t),originalEdit=t.edit.bind(t),originalRemove=t.remove.bind(t),originalReact=t.react.bind(t);
  const requestTimeout=(promise,ms)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>{const e=new Error('CHAT_PREWARM_TIMEOUT');e.code='CHAT_PREWARM_TIMEOUT';reject(e)},ms))]);
  function key(phone){return p10(phone)}
  function storageKey(phone){return 'medsi_parent_thread_session_v1_'+key(phone)}
  function fresh(entry){return entry&&Date.now()-entry.at<45000}
  function readSession(phone){try{const x=JSON.parse(sessionStorage.getItem(storageKey(phone))||'null');return fresh(x)?x:null}catch(_){return null}}
  function writeSession(phone,res){try{sessionStorage.setItem(storageKey(phone),JSON.stringify({res,at:Date.now()}))}catch(_){}}
  function clearSession(phone){try{if(phone)sessionStorage.removeItem(storageKey(phone));else Object.keys(sessionStorage).filter(k=>k.startsWith('medsi_parent_thread_session_v1_')).forEach(k=>sessionStorage.removeItem(k))}catch(_){}}
  async function fetchThread(session,phone){
    const k=key(phone);if(pending.has(k))return pending.get(k);
    let p;
    p=requestTimeout(originalThread(session,phone,'',100),8000).then(res=>{const entry={res,at:Date.now()};cache.set(k,entry);writeSession(phone,res);return res}).finally(()=>{if(pending.get(k)===p)pending.delete(k)});
    pending.set(k,p);return p
  }
  t.thread=function(session,phone,before,limit){
    const k=key(phone);
    if(!before){const c=cache.get(k)||readSession(phone);if(fresh(c)){cache.set(k,c);return Promise.resolve(c.res)}if(pending.has(k))return pending.get(k)}
    return requestTimeout(originalThread(session,phone,before,limit),8000).then(res=>{if(!before){const entry={res,at:Date.now()};cache.set(k,entry);writeSession(phone,res)}return res})
  };
  function invalidatePhone(phone){cache.delete(key(phone));clearSession(phone)}
  t.sendMessage=async function(session,role,phone,message){const r=await originalSend(session,role,phone,message);invalidatePhone(phone);return r};
  t.edit=async function(session,role,messageKey,text){const r=await originalEdit(session,role,messageKey,text);cache.clear();clearSession();return r};
  t.remove=async function(session,role,messageKey){const r=await originalRemove(session,role,messageKey);cache.clear();clearSession();return r};
  t.react=async function(session,messageKey,reaction){const r=await originalReact(session,messageKey,reaction);cache.clear();clearSession();return r};
  function ready(phone){
    const k=key(phone),p=pending.get(k);
    if(!p)return Promise.resolve((cache.get(k)||readSession(phone))?.res||null);
    return Promise.race([p,new Promise(resolve=>setTimeout(()=>{if(pending.get(k)===p)pending.delete(k);resolve((cache.get(k)||readSession(phone))?.res||null)},1200))]).catch(()=>null)
  }
  window.MedsiParentPrewarm={warm:(session,phone)=>fetchThread(session,phone).catch(()=>null),ready,peek:phone=>((cache.get(key(phone))||readSession(phone))?.res||null),clear:()=>{cache.clear();pending.clear();clearSession()}};

  const AUTH_WATCH_MS=2800;
  let authWatchTimer=null;
  function parentChatReady(){
    const screen=document.getElementById('screenChat');
    const box=document.getElementById('parentChatMessages');
    const err=document.getElementById('parentChatError');
    if(!screen||screen.classList.contains('hidden')||!box)return false;
    if(err&&!err.classList.contains('hidden')&&String(err.textContent||'').trim())return false;
    return !/Загружаем сообщения/i.test(String(box.textContent||''));
  }
  function clearParentAuthState(){
    cache.clear();pending.clear();clearSession();
    try{
      ['medsi_parent_phone','medsi_phone','medsi_parent','medsi_child','medsi_d1_parent_session_v1'].forEach(k=>localStorage.removeItem(k));
      Object.keys(localStorage).filter(k=>k.startsWith('medsi_parent_thread_')).forEach(k=>localStorage.removeItem(k));
    }catch(_){}
    try{Object.keys(sessionStorage).filter(k=>k.startsWith('medsi_parent_thread_')).forEach(k=>sessionStorage.removeItem(k))}catch(_){}
  }
  function forceParentReauth(){
    if(authWatchTimer){clearTimeout(authWatchTimer);authWatchTimer=null}
    clearParentAuthState();
    location.replace('/?reauth=1&reset='+Date.now());
  }
  function armParentAuthWatch(){
    if(authWatchTimer)clearTimeout(authWatchTimer);
    authWatchTimer=setTimeout(()=>{
      authWatchTimer=null;
      if(!parentChatReady())forceParentReauth();
    },AUTH_WATCH_MS);
  }
  document.addEventListener('click',e=>{if(e.target&&e.target.closest&&e.target.closest('#btnChat'))armParentAuthWatch()},true);
  window.addEventListener('DOMContentLoaded',()=>{
    try{
      if(new URLSearchParams(location.search).get('reauth')==='1'){
        setTimeout(()=>{const b=document.getElementById('btnGoAuth');if(b)b.click()},80);
      }
    }catch(_){}
  });
})();