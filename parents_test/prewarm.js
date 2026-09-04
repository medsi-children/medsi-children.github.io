(function(){
  const t=window.MedsiOverlayTransport;if(!t)return;
  const cache=new Map(),pending=new Map();
  const p10=v=>String(v||'').replace(/\D+/g,'').slice(-10);
  const originalThread=t.thread.bind(t),originalSend=t.sendMessage.bind(t),originalEdit=t.edit.bind(t),originalRemove=t.remove.bind(t),originalReact=t.react.bind(t);
  function key(phone){return p10(phone)}
  function fresh(entry){return entry&&Date.now()-entry.at<45000}
  async function fetchThread(session,phone){const k=key(phone);if(pending.has(k))return pending.get(k);const p=originalThread(session,phone,'',100).then(res=>{cache.set(k,{res,at:Date.now()});return res}).finally(()=>pending.delete(k));pending.set(k,p);return p}
  t.thread=function(session,phone,before,limit){const k=key(phone);if(!before){const c=cache.get(k);if(fresh(c))return Promise.resolve(c.res);if(pending.has(k))return pending.get(k)}return originalThread(session,phone,before,limit).then(res=>{if(!before)cache.set(k,{res,at:Date.now()});return res})};
  function invalidatePhone(phone){cache.delete(key(phone))}
  t.sendMessage=async function(session,role,phone,message){const r=await originalSend(session,role,phone,message);invalidatePhone(phone);return r};
  t.edit=async function(session,role,messageKey,text){const r=await originalEdit(session,role,messageKey,text);cache.clear();return r};
  t.remove=async function(session,role,messageKey){const r=await originalRemove(session,role,messageKey);cache.clear();return r};
  t.react=async function(session,messageKey,reaction){const r=await originalReact(session,messageKey,reaction);cache.clear();return r};
  window.MedsiParentPrewarm={warm:(session,phone)=>fetchThread(session,phone).catch(()=>null),ready:phone=>pending.get(key(phone))||Promise.resolve(cache.get(key(phone))&&cache.get(key(phone)).res||null),clear:()=>cache.clear()};
})();