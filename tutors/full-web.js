(function(){
  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const TUTOR_KEY='medsi_tutor_session_v1';
  const D1_KEY='medsi_d1_educator_session_v1';
  const $=id=>document.getElementById(id);
  let tutorToken='';
  let d1Session=null;
  let d1RefreshPromise=null;
  let d1WarmTimer=null;
  let overlay=null;
  let overlayCleanup=null;
  let parentsCache=[];
  let parentsSignature='';
  let authBusy=false;

  function safeGet(key){try{return localStorage.getItem(key)||''}catch(_){return''}}
  function safeSet(key,val){try{localStorage.setItem(key,val)}catch(_){}}
  function safeRemove(key){try{localStorage.removeItem(key)}catch(_){}}
  function loadD1(){try{const s=JSON.parse(safeGet(D1_KEY)||'null');return s&&s.token&&Number(s.expiresAt||0)>Date.now()+30000?s:null}catch(_){return null}}
  function extractD1(res){if(!res)return null;if(res.d1Session&&res.d1Session.token)return res.d1Session;if(res.session&&res.session.token)return res.session;if(res.token)return res;return null}
  function saveAuth(token,session){tutorToken=String(token||'');if(tutorToken)safeSet(TUTOR_KEY,tutorToken);if(session&&session.token){d1Session=session;safeSet(D1_KEY,JSON.stringify(session))}}
  function clearAuth(){tutorToken='';d1Session=null;d1RefreshPromise=null;if(d1WarmTimer){clearTimeout(d1WarmTimer);d1WarmTimer=null}safeRemove(TUTOR_KEY);safeRemove(D1_KEY)}
  function phone10(v){return String(v||'').replace(/\D+/g,'').slice(-10)}
  function displayPhone(v){const p=phone10(v);return p?'8'+p:''}
  function parentSig(rows){return (rows||[]).map(r=>[phone10(r.phone),r.parentName||'',r.childName||''].join('|')).sort().join('~')}

  function timeoutPromise(ms){return new Promise((_,reject)=>setTimeout(()=>reject(new Error('TIMEOUT')),ms))}
  async function callApi(method,args,timeoutMs){
    const run=async()=>{
      const r=await fetch(APP_BASE_URL,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'api',method,args:args||[]}),cache:'no-store'});
      const raw=await r.text();let p;try{p=JSON.parse(raw)}catch(_){throw new Error('Apps Script вернул некорректный ответ.')}
      if(!r.ok||!p||p.ok!==true)throw new Error((p&&p.message)||('HTTP '+r.status));
      return p.result;
    };
    return Promise.race([run(),timeoutPromise(timeoutMs||15000)]);
  }

  function setAuthError(text){const el=$('tutorAuthError');el.textContent=String(text||'');el.classList.toggle('hidden',!text)}
  function showGate(checking){
    const gate=$('tutorAuthGate');gate.classList.remove('hidden');gate.classList.toggle('checking',!!checking);
    $('authChecking').classList.toggle('hidden',!checking);$('authForm').classList.toggle('hidden',!!checking);
    if(!checking)setTimeout(()=>$('tutorLogin').focus(),30);
  }
  function hideGate(){$('tutorAuthGate').classList.add('hidden');$('tutorAuthGate').classList.remove('checking')}

  function requestFreshD1(){
    if(d1RefreshPromise)return d1RefreshPromise;
    d1RefreshPromise=(async()=>{
      let verify=null;
      try{verify=await callApi('verifyTutorSession',[tutorToken],8000)}catch(_){}
      let session=extractD1(verify);
      if(!session){
        try{session=extractD1(await callApi('getD1ChatSession',['educator','',tutorToken],10000))}catch(_){}
      }
      if(!session||!session.token)throw new Error('Не удалось обновить сессию чата.');
      saveAuth(tutorToken,session);return session;
    })().finally(()=>{d1RefreshPromise=null});
    return d1RefreshPromise;
  }
  function scheduleD1Warm(){
    if(!tutorToken)return;
    if(d1WarmTimer)clearTimeout(d1WarmTimer);
    d1WarmTimer=setTimeout(()=>{
      d1WarmTimer=null;
      const expiry=Number(d1Session&&d1Session.expiresAt||0);
      if(d1Session&&expiry>Date.now()+10*60*1000)return;
      requestFreshD1().then(session=>{if(session){prewarmParents();refreshUnreadBadge()}}).catch(()=>{});
    },80);
  }
  async function refreshSavedSessionInBackground(){
    try{const session=await requestFreshD1();if(session){prewarmParents();refreshUnreadBadge()}}catch(_){}
  }
  async function verifySaved(){
    tutorToken=String(safeGet(TUTOR_KEY)||'');d1Session=loadD1();
    if(!tutorToken){showGate(false);return}
    if(d1Session&&d1Session.token){hideGate();startApp();refreshSavedSessionInBackground();return}
    showGate(true);
    try{
      const res=await callApi('verifyTutorSession',[tutorToken],8000);
      if(!res||!res.ok){clearAuth();showGate(false);return}
      const session=extractD1(res);
      if(session)saveAuth(tutorToken,session);
      hideGate();startApp();
      if(!session)scheduleD1Warm();
    }catch(e){clearAuth();showGate(false);if(String(e&&e.message||e)!=='TIMEOUT')setAuthError(String(e&&e.message||e))}
  }

  async function submitLogin(){
    if(authBusy)return;const login=$('tutorLogin').value.trim(),password=$('tutorPassword').value;
    if(!login||!password){setAuthError('Введите логин и пароль.');return}
    authBusy=true;$('tutorLoginBtn').disabled=true;$('tutorLoginBtn').textContent='Проверяем…';setAuthError('');
    try{
      const res=await callApi('verifyTutorAccess',[login,password],15000);
      if(!res||!res.ok||!res.token)throw new Error((res&&res.message)||'Не удалось войти.');
      saveAuth(String(res.token),extractD1(res));$('tutorPassword').value='';
      hideGate();startApp();scheduleD1Warm();
    }catch(e){setAuthError(String(e&&e.message||e)==='TIMEOUT'?'Сервер долго не отвечает. Попробуйте ещё раз.':String(e&&e.message||e))}
    finally{authBusy=false;$('tutorLoginBtn').disabled=false;$('tutorLoginBtn').textContent='Войти в систему'}
  }

  function animateScreen(el){if(!el)return;el.classList.remove('web-screen-enter');void el.offsetWidth;el.classList.add('web-screen-enter');setTimeout(()=>el.classList.remove('web-screen-enter'),340)}
  function setScreen(name,title,meta){
    ['screenChoose','screenForm','screenDone','screenPhones'].forEach(id=>$(id).classList.toggle('hidden',id!==name));
    document.body.dataset.screen=name==='screenForm'?'report-'+($('btnSend').dataset.type||''):name;
    $('title').textContent=title||'Медси Бот';$('meta').textContent=meta||'Что хотите сделать?';animateScreen($(name));window.scrollTo(0,0)
  }
  function showMenu(){setScreen('screenChoose','Медси Бот','Что хотите сделать?');refreshUnreadBadge();scheduleD1Warm()}
  function openReport(type){$('btnSend').dataset.type=type;$('reportError').classList.add('hidden');$('text').value='';const spec=type==='morning'?['Утренний отчёт','Вставьте текст утреннего отчёта.']:type==='evening'?['Вечерний отчёт','Вставьте текст вечернего отчёта.']:['Психотерапия','Вставьте отчёт по психотерапии.'];setScreen('screenForm',spec[0],spec[1])}
  async function sendReport(){
    const type=$('btnSend').dataset.type,text=$('text').value,btn=$('btnSend');$('reportError').classList.add('hidden');if(!text.trim()){showReportError('Пустой текст отчёта.');return}
    btn.disabled=true;btn.textContent='Отправляем…';
    try{const res=await callApi('appendReport',[{reportType:type,text},tutorToken],30000);if(!res||!res.ok)throw new Error((res&&res.message)||'Не удалось отправить отчёт.');$('doneText').textContent='Готово.';setScreen('screenDone','Готово','Отчёт отправлен.')}
    catch(e){showReportError(String(e&&e.message||e))}finally{btn.disabled=false;btn.textContent='Отправить'}
  }
  function showReportError(text){const el=$('reportError');el.textContent=text;el.classList.remove('hidden')}

  async function prewarmParents(){
    if(!d1Session||!window.MedsiOverlayTransport)return;
    try{
      const res=await MedsiOverlayTransport.parents(d1Session);
      const rows=Array.isArray(res&&res.parents)?res.parents:(Array.isArray(res&&res.rows)?res.rows:[]);
      if(rows.length||res){parentsCache=rows;parentsSignature=parentSig(rows)}
    }catch(_){}
  }
  async function refreshPhones(){
    try{
      let rows=[];
      if(d1Session&&window.MedsiOverlayTransport){
        const res=await MedsiOverlayTransport.parents(d1Session);
        rows=Array.isArray(res&&res.parents)?res.parents:(Array.isArray(res&&res.rows)?res.rows:[]);
      }else{
        const res=await callApi('listAvailableParentsForChat',[tutorToken],20000);
        if(!res||!res.ok)throw new Error((res&&res.message)||'Не удалось загрузить родителей.');
        rows=Array.isArray(res.rows)?res.rows:[];
      }
      parentsCache=rows.map(r=>({phone:r.phone||r.phone10||'',parentName:r.parentName||r.parent_name||'',childName:r.childName||r.child_name||''}));
      parentsSignature=parentSig(parentsCache);return parentsCache;
    }catch(e){throw e}
  }
  async function copyPhone(phone,btn){
    const value=String(phone||'').trim();if(!value)return;
    try{await navigator.clipboard.writeText(value);const old=btn.textContent;btn.textContent='Скопировано';setTimeout(()=>btn.textContent=old,1000)}
    catch(_){const ta=document.createElement('textarea');ta.value=value;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();const old=btn.textContent;btn.textContent='Скопировано';setTimeout(()=>btn.textContent=old,1000)}
  }
  function renderPhones(rows){
    const box=$('phonesList');if(!box)return;box.replaceChildren();
    if(!rows||!rows.length){const empty=document.createElement('div');empty.className='chat-empty';empty.textContent='Нет родителей.';box.appendChild(empty);return}
    rows.forEach((r,index)=>{
      const card=document.createElement('div');card.className='phone-card card-enter';card.style.animationDelay=Math.min(index*24,160)+'ms';
      const title=document.createElement('div');title.className='phone-card-title';title.textContent=r.childName||'Без имени ребёнка';
      const meta=document.createElement('div');meta.className='phone-card-meta';
      const parentLine=document.createElement('div');parentLine.textContent='Родитель: '+(r.parentName||'—');
      const phoneLine=document.createElement('div');phoneLine.append('Номер телефона: ');const strong=document.createElement('span');strong.className='phone-number-strong';strong.textContent=displayPhone(r.phone)||'—';phoneLine.appendChild(strong);meta.append(parentLine,phoneLine);
      const actions=document.createElement('div');actions.className='phone-card-actions';
      const copy=document.createElement('button');copy.type='button';copy.className='btn btn-teal phone-action-btn';copy.textContent='Скопировать';copy.onclick=()=>copyPhone(displayPhone(r.phone),copy);
      const call=document.createElement('a');call.className='btn btn-mint phone-action-btn';call.href='tel:'+String(r.phone||'').replace(/\D+/g,'');call.textContent='Позвонить';
      const del=document.createElement('button');del.type='button';del.className='phone-delete';del.setAttribute('aria-label','Удалить ребёнка');del.textContent='×';del.onclick=()=>deleteParent(r,card);
      actions.append(copy,call);card.append(title,del,meta,actions);box.appendChild(card);
    });
  }
  function removePhoneCardOptimistically(row,card){
    const snapshot=parentsCache.slice();
    parentsCache=parentsCache.filter(x=>phone10(x.phone)!==phone10(row.phone));
    parentsSignature=parentSig(parentsCache);
    if(card){card.classList.add('phone-card-deleting');requestAnimationFrame(()=>card.classList.add('phone-card-deleting-go'));setTimeout(()=>{if(card.isConnected)card.remove()},230)}
    return snapshot;
  }
  function restorePhoneAfterFailedDelete(snapshot,message){
    parentsCache=snapshot;parentsSignature=parentSig(parentsCache);
    if(document.body.dataset.screen==='screenPhones')renderPhones(parentsCache);
    alert(String(message||'Не удалось удалить ребёнка.'));
  }
  async function deleteParent(row,card){
    const child=String(row.childName||'ребёнка').trim();
    if(!confirm('Удалить ребёнка '+child+' из бота?\n\nВся история сообщений будет удалена.'))return;
    const request=callApi('deleteReportChildByPhone',[row.phone,tutorToken],30000);
    const snapshot=removePhoneCardOptimistically(row,card);
    try{const res=await request;if(!res||!res.ok)throw new Error((res&&res.message)||'Не удалось удалить.')}catch(e){restorePhoneAfterFailedDelete(snapshot,e&&e.message||e)}
  }
  async function openPhones(){
    setScreen('screenPhones','Телефоны родителей','Здесь можно быстро скопировать номер или позвонить.');
    const box=$('phonesList');const err=$('phonesError');err.classList.add('hidden');
    if(parentsCache.length){
      renderPhones(parentsCache);
      const shownSignature=parentsSignature||parentSig(parentsCache);
      refreshPhones().then(rows=>{if(document.body.dataset.screen==='screenPhones'&&parentSig(rows)!==shownSignature)renderPhones(rows)}).catch(()=>{});
      return;
    }
    box.innerHTML='<div class="phone-mini-loader" aria-label="Загрузка"></div>';
    try{const rows=await refreshPhones();if(document.body.dataset.screen==='screenPhones')renderPhones(rows)}catch(e){if(document.body.dataset.screen==='screenPhones'){box.replaceChildren();err.textContent=String(e&&e.message||e);err.classList.remove('hidden')}}
  }

  async function ensureD1Fresh(){if(d1Session&&Number(d1Session.expiresAt||0)>Date.now()+60000)return d1Session;return requestFreshD1()}
  async function openChat(){try{const s=await ensureD1Fresh();overlay.open({type:'medsi:chat-overlay',action:'open',role:'educator',session:s})}catch(e){alert(String(e&&e.message||e))}}
  async function refreshUnreadBadge(){const badge=$('newParentMsgBanner');if(!d1Session||!window.MedsiOverlayTransport){badge.classList.add('hidden');return}try{const res=await MedsiOverlayTransport.chats(d1Session,'unread');const chats=Array.isArray(res&&res.chats)?res.chats:[];badge.classList.toggle('hidden',!chats.some(x=>!!x.hasUnread))}catch(_){badge.classList.add('hidden')}}

  function startApp(){
    if(document.body.dataset.started==='1'){showMenu();return}document.body.dataset.started='1';
    window.MEDSI_APP_BASE_URL=APP_BASE_URL;
    overlay=window.MedsiChatOverlay.create({frameId:'__no_iframe__',onOpen:(state,api)=>{if(overlayCleanup){try{overlayCleanup()}catch(_){}overlayCleanup=null}if(window.MedsiEducatorOverlayChat)overlayCleanup=MedsiEducatorOverlayChat.mount(api,state)||null},onClose:()=>{if(overlayCleanup){try{overlayCleanup()}catch(_){}overlayCleanup=null}showMenu()}});
    showMenu();prewarmParents()
  }

  $('btnParentChats').addEventListener('click',openChat);$('btnMorning').addEventListener('click',()=>openReport('morning'));$('btnEvening').addEventListener('click',()=>openReport('evening'));$('btnPsychology').addEventListener('click',()=>openReport('psychology'));$('btnParentPhones').addEventListener('click',openPhones);$('btnBack').addEventListener('click',showMenu);$('btnPhonesBack').addEventListener('click',showMenu);$('btnAgain').addEventListener('click',showMenu);$('btnSend').addEventListener('click',sendReport);$('tutorLoginBtn').addEventListener('click',submitLogin);$('tutorPassword').addEventListener('keydown',e=>{if(e.key==='Enter')submitLogin()});
  window.medsiForgetCachedChatToken=()=>{safeRemove(D1_KEY);d1Session=null;return true};window.medsiLogoutTutor=()=>{clearAuth();location.reload()};verifySaved();
})();