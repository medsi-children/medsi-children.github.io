(function(){
  const t=window.MedsiOverlayTransport;if(!t)return;
  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const cache=new Map(),pending=new Map();let fallbackMode=false;
  const p10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  const originalThread=t.thread.bind(t),originalSend=t.sendMessage.bind(t),originalEdit=t.edit.bind(t),originalRemove=t.remove.bind(t),originalReact=t.react.bind(t);
  const requestTimeout=(promise,ms)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>{const e=new Error('CHAT_PREWARM_TIMEOUT');e.code='CHAT_PREWARM_TIMEOUT';reject(e)},ms))]);
  async function callApi(method,args,ms){
    const run=async()=>{const r=await fetch(APP_BASE_URL,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'api',method,args:args||[]}),cache:'no-store'});const raw=await r.text();let p;try{p=JSON.parse(raw)}catch(_){throw new Error('Apps Script вернул некорректный ответ.')}if(!r.ok||!p||p.ok!==true)throw new Error((p&&p.message)||('HTTP '+r.status));return p.result};
    return requestTimeout(run(),ms||15000);
  }
  const shouldFallback=e=>!!e&&(e.code==='CHAT_PREWARM_TIMEOUT'||e.code==='NETWORK'||String(e.message||e)==='CHAT_PREWARM_TIMEOUT');
  async function threadViaFallback(phone,before,limit){return callApi('getD1ThreadForParent',[p10(phone),String(before||''),Number(limit)||50],18000)}
  async function sendViaFallback(phone,message){return callApi('sendD1MessageForParent',[p10(phone),message||{}],20000)}
  async function resilientThread(session,phone,before,limit){
    if(fallbackMode)return threadViaFallback(phone,before,limit);
    try{return await requestTimeout(originalThread(session,phone,before,limit),2500)}catch(e){if(!shouldFallback(e))throw e;fallbackMode=true;return threadViaFallback(phone,before,limit)}
  }
  async function resilientSend(session,role,phone,message){
    if(fallbackMode)return sendViaFallback(phone,message);
    try{return await requestTimeout(originalSend(session,role,phone,message),2500)}catch(e){if(!shouldFallback(e))throw e;fallbackMode=true;return sendViaFallback(phone,message)}
  }
  function key(phone){return p10(phone)}
  function storageKey(phone){return 'medsi_parent_thread_session_v1_'+key(phone)}
  function fresh(entry){return entry&&Date.now()-entry.at<45000}
  function readSession(phone){try{const x=JSON.parse(sessionStorage.getItem(storageKey(phone))||'null');return fresh(x)?x:null}catch(_){return null}}
  function writeSession(phone,res){try{sessionStorage.setItem(storageKey(phone),JSON.stringify({res,at:Date.now()}))}catch(_){}}
  function clearSession(phone){try{if(phone)sessionStorage.removeItem(storageKey(phone));else Object.keys(sessionStorage).filter(k=>k.startsWith('medsi_parent_thread_session_v1_')).forEach(k=>sessionStorage.removeItem(k))}catch(_){}}
  async function fetchThread(session,phone){
    const k=key(phone);if(pending.has(k))return pending.get(k);
    let p;
    p=resilientThread(session,phone,'',100).then(res=>{const entry={res,at:Date.now()};cache.set(k,entry);writeSession(phone,res);return res}).finally(()=>{if(pending.get(k)===p)pending.delete(k)});
    pending.set(k,p);return p
  }
  t.thread=function(session,phone,before,limit){
    const k=key(phone);
    if(!before){const c=cache.get(k)||readSession(phone);if(fresh(c)){cache.set(k,c);return Promise.resolve(c.res)}if(pending.has(k))return pending.get(k)}
    return resilientThread(session,phone,before,limit).then(res=>{if(!before){const entry={res,at:Date.now()};cache.set(k,entry);writeSession(phone,res)}return res})
  };
  function invalidatePhone(phone){cache.delete(key(phone));clearSession(phone)}
  t.sendMessage=async function(session,role,phone,message){const r=await resilientSend(session,role,phone,message);invalidatePhone(phone);return r};
  t.edit=async function(session,role,messageKey,text){const r=await originalEdit(session,role,messageKey,text);cache.clear();clearSession();return r};
  t.remove=async function(session,role,messageKey){const r=await originalRemove(session,role,messageKey);cache.clear();clearSession();return r};
  t.react=async function(session,messageKey,reaction){const r=await originalReact(session,messageKey,reaction);cache.clear();clearSession();return r};
  function ready(phone){
    const k=key(phone),p=pending.get(k);
    if(!p)return Promise.resolve((cache.get(k)||readSession(phone))?.res||null);
    return Promise.race([p,new Promise(resolve=>setTimeout(()=>{if(pending.get(k)===p)pending.delete(k);resolve((cache.get(k)||readSession(phone))?.res||null)},3200))]).catch(()=>null)
  }
  window.MedsiParentPrewarm={warm:(session,phone)=>fetchThread(session,phone).catch(()=>null),ready,peek:phone=>((cache.get(key(phone))||readSession(phone))?.res||null),clear:()=>{cache.clear();pending.clear();clearSession()},usingFallback:()=>fallbackMode};
})();