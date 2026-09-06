(function(){
  if(!document.querySelector('script[data-medsi-upload-ux]')){const s=document.createElement('script');s.src='/chat-overlay/upload-ux.js?v=20260905-uploadux1';s.dataset.medsiUploadUx='1';document.head.appendChild(s)}
  if(!document.querySelector('script[data-medsi-chat-polish]')){const s=document.createElement('script');s.src='/chat-overlay/chat-polish-v2.js?v=20260906-polish3';s.dataset.medsiChatPolish='1';document.head.appendChild(s)}
  if(!document.querySelector('script[data-medsi-terminology-fix]')){const s=document.createElement('script');s.src='/chat-overlay/terminology-fix.js?v=20260906-1';s.dataset.medsiTerminologyFix='1';document.head.appendChild(s)}

  if(!window.__medsiTimewebSessionFetchWrapped){
    window.__medsiTimewebSessionFetchWrapped=true;
    const nativeFetch=window.fetch.bind(window);
    const allowed=new Set(['getD1ChatSession','verifyTutorSession','verifyTutorAccess']);
    window.fetch=function(input,init){
      try{
        const url=typeof input==='string'?input:(input&&input.url)||'';
        const body=init&&typeof init.body==='string'?init.body:'';
        if(url.includes('script.google.com/macros/s/')&&body){
          const payload=JSON.parse(body);
          if(payload&&payload.action==='api'&&allowed.has(String(payload.method||''))){
            return nativeFetch('/__session/apps-script',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),cache:'no-store'});
          }
        }
      }catch(_){}
      return nativeFetch(input,init);
    };
  }

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

  let loginWarm=null;
  function extractSession(res){if(!res)return null;if(res.token)return res;if(res.session&&res.session.token)return res.session;if(res.d1Session&&res.d1Session.token)return res.d1Session;return null}
  function saveLoginSession(phone,session){if(!session||!session.token)return;try{localStorage.setItem('medsi_d1_parent_session_v1',JSON.stringify({phone:p10(phone),session}))}catch(_){};fetchThread(session,phone).catch(()=>{})}
  function prewarmLogin(phone){const ph=p10(phone);if(!ph)return Promise.resolve(null);if(loginWarm&&loginWarm.phone===ph)return loginWarm.promise;const promise=fetch('/__session/apps-script',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'api',method:'getD1ChatSession',args:['parent',ph,'']}),cache:'no-store'}).then(r=>r.json()).then(p=>{const s=extractSession(p&&p.result);if(s)saveLoginSession(ph,s);return s}).catch(()=>null);loginWarm={phone:ph,promise};return promise}
  function installLoginWarm(){const run=()=>{const btn=document.getElementById('authBtn'),input=document.getElementById('phoneInputAuth');if(btn&&input&&!btn.dataset.medsiSessionWarm){btn.dataset.medsiSessionWarm='1';btn.addEventListener('click',()=>prewarmLogin(input.value),true);input.addEventListener('keydown',e=>{if(e.key==='Enter')prewarmLogin(input.value)},true)}};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run()}
  installLoginWarm();

  window.MedsiParentPrewarm={warm:(session,phone)=>fetchThread(session,phone).catch(()=>null),ready:phone=>pending.get(key(phone))||Promise.resolve((cache.get(key(phone))||readSession(phone))?.res||null),peek:phone=>((cache.get(key(phone))||readSession(phone))?.res||null),clear:()=>{cache.clear();clearSession()},prewarmLogin};
})();