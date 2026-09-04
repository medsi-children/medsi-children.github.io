(function(){
  const t=window.MedsiOverlayTransport;if(!t)return;
  const cache=new Map(),pending=new Map();
  const p10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  const originalThread=t.thread.bind(t),originalSend=t.sendMessage.bind(t),originalEdit=t.edit.bind(t),originalRemove=t.remove.bind(t),originalReact=t.react.bind(t);
  function key(phone){return p10(phone)}
  function storageKey(phone){return 'medsi_parent_thread_session_v1_'+key(phone)}
  function fresh(entry){return entry&&Date.now()-entry.at<45000}
  function readSession(phone){try{const x=JSON.parse(sessionStorage.getItem(storageKey(phone))||'null');return fresh(x)?x:null}catch(_){return null}}
  function writeSession(phone,res){try{sessionStorage.setItem(storageKey(phone),JSON.stringify({res,at:Date.now()}))}catch(_){}}
  function clearSession(phone){try{if(phone)sessionStorage.removeItem(storageKey(phone));else Object.keys(sessionStorage).filter(k=>k.startsWith('medsi_parent_thread_session_v1_')).forEach(k=>sessionStorage.removeItem(k))}catch(_){}}
  async function fetchThread(session,phone){const k=key(phone);if(pending.has(k))return pending.get(k);const p=originalThread(session,phone,'',100).then(res=>{const entry={res,at:Date.now()};cache.set(k,entry);writeSession(phone,res);return res}).finally(()=>pending.delete(k));pending.set(k,p);return p}
  t.thread=function(session,phone,before,limit){const k=key(phone);if(!before){const c=cache.get(k)||readSession(phone);if(fresh(c)){cache.set(k,c);return Promise.resolve(c.res)}if(pending.has(k))return pending.get(k)}return originalThread(session,phone,before,limit).then(res=>{if(!before){const entry={res,at:Date.now()};cache.set(k,entry);writeSession(phone,res)}return res})};
  function invalidatePhone(phone){cache.delete(key(phone));clearSession(phone)}
  t.sendMessage=async function(session,role,phone,message){const r=await originalSend(session,role,phone,message);invalidatePhone(phone);return r};
  t.edit=async function(session,role,messageKey,text){const r=await originalEdit(session,role,messageKey,text);cache.clear();clearSession();return r};
  t.remove=async function(session,role,messageKey){const r=await originalRemove(session,role,messageKey);cache.clear();clearSession();return r};
  t.react=async function(session,messageKey,reaction){const r=await originalReact(session,messageKey,reaction);cache.clear();clearSession();return r};
  window.MedsiParentPrewarm={warm:(session,phone)=>fetchThread(session,phone).catch(()=>null),ready:phone=>pending.get(key(phone))||Promise.resolve((cache.get(key(phone))||readSession(phone))?.res||null),peek:phone=>((cache.get(key(phone))||readSession(phone))?.res||null),clear:()=>{cache.clear();clearSession()}};
})();