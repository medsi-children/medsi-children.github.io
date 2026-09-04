(function(){
  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const TUTOR_KEY='medsi_tutor_session_v1';
  const D1_KEY='medsi_d1_educator_session_v1';
  const $=id=>document.getElementById(id);
  let tutorToken='';
  let d1Session=null;
  let overlay=null;
  let overlayCleanup=null;
  let parentsCache=[];
  let authBusy=false;

  function safeGet(key){try{return localStorage.getItem(key)||''}catch(_){return''}}
  function safeSet(key,val){try{localStorage.setItem(key,val)}catch(_){}}
  function safeRemove(key){try{localStorage.removeItem(key)}catch(_){}}
  function loadD1(){try{const s=JSON.parse(safeGet(D1_KEY)||'null');return s&&s.token&&Number(s.expiresAt||0)>Date.now()+30000?s:null}catch(_){return null}}
  function saveAuth(token,session){tutorToken=String(token||'');if(tutorToken)safeSet(TUTOR_KEY,tutorToken);if(session&&session.token){d1Session=session;safeSet(D1_KEY,JSON.stringify(session))}}
  function clearAuth(){tutorToken='';d1Session=null;safeRemove(TUTOR_KEY);safeRemove(D1_KEY)}

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

  async function refreshSavedSessionInBackground(){
    try{
      const res=await callApi('verifyTutorSession',[tutorToken],8000);
      if(!res||!res.ok)return;
      if(res.d1Session&&res.d1Session.token)saveAuth(tutorToken,res.d1Session);
    }catch(_){}
  }

  async function verifySaved(){
    tutorToken=String(safeGet(TUTOR_KEY)||'');d1Session=loadD1();
    if(!tutorToken){showGate(false);return}
    if(d1Session&&d1Session.token){hideGate();startApp();refreshSavedSessionInBackground();return}
    showGate(true);
    try{
      const res=await callApi('verifyTutorSession',[tutorToken],8000);
      if(!res||!res.ok){clearAuth();showGate(false);return}
      if(res.d1Session&&res.d1Session.token)saveAuth(tutorToken,res.d1Session);
      hideGate();startApp();
    }catch(e){
      clearAuth();showGate(false);
      if(String(e&&e.message||e)!=='TIMEOUT')setAuthError(String(e&&e.message||e));
    }
  }

  async function submitLogin(){
    if(authBusy)return;const login=$('tutorLogin').value.trim(),password=$('tutorPassword').value;
    if(!login||!password){setAuthError('Введите логин и пароль.');return}
    authBusy=true;$('tutorLoginBtn').disabled=true;$('tutorLoginBtn').textContent='Проверяем…';setAuthError('');
    try{
      const res=await callApi('verifyTutorAccess',[login,password],15000);
      if(!res||!res.ok||!res.token)throw new Error((res&&res.message)||'Не удалось войти.');
      saveAuth(String(res.token),res.d1Session||null);$('tutorPassword').value='';
      if(!d1Session){const vr=await callApi('verifyTutorSession',[tutorToken],8000);if(vr&&vr.d1Session)saveAuth(tutorToken,vr.d1Session)}
      hideGate();startApp();
    }catch(e){setAuthError(String(e&&e.message||e)==='TIMEOUT'?'Сервер долго не отвечает. Попробуйте ещё раз.':String(e&&e.message||e))}
    finally{authBusy=false;$('tutorLoginBtn').disabled=false;$('tutorLoginBtn').textContent='Войти в систему'}
  }

  function animateScreen(el){
    if(!el)return;
    el.classList.remove('web-screen-enter');
    void el.offsetWidth;
    el.classList.add('web-screen-enter');
    setTimeout(()=>el.classList.remove('web-screen-enter'),340);
  }
  function setScreen(name,title,meta){
    ['screenChoose','screenForm','screenDone','screenPhones'].forEach(id=>$(id).classList.toggle('hidden',id!==name));
    document.body.dataset.screen=name==='screenForm'?'report-'+($('btnSend').dataset.type||''):name;
    $('title').textContent=title||'Медси Бот';$('meta').textContent=meta||'Что хотите сделать?';
    animateScreen($(name));window.scrollTo(0,0);
  }
  function showMenu(){setScreen('screenChoose','Медси Бот','Что хотите сделать?');refreshUnreadBadge();}
  function openReport(type){
    $('btnSend').dataset.type=type;$('reportError').classList.add('hidden');$('text').value='';
    const spec=type==='morning'?['Утренний отчёт','Вставьте текст утреннего отчёта.']:type==='evening'?['Вечерний отчёт','Вставьте текст вечернего отчёта.']:['Психотерапия','Вставьте отчёт по психотерапии.'];
    setScreen('screenForm',spec[0],spec[1]);
  }
  async function sendReport(){
    const type=$('btnSend').dataset.type,text=$('text').value,btn=$('btnSend');
    $('reportError').classList.add('hidden');if(!text.trim()){showReportError('Пустой текст отчёта.');return}
    btn.disabled=true;btn.textContent='Отправляем…';
    try{
      const res=await callApi('appendReport',[{reportType:type,text},tutorToken],30000);
      if(!res||!res.ok)throw new Error((res&&res.message)||'Не удалось отправить отчёт.');
      $('doneText').textContent='Готово.';setScreen('screenDone','Готово','Отчёт отправлен.');
    }catch(e){showReportError(String(e&&e.message||e))}
    finally{btn.disabled=false;btn.textContent='Отправить'}
  }
  function showReportError(text){const el=$('reportError');el.textContent=text;el.classList.remove('hidden')}

  function makePhonesSkeleton(count){
    return '<div class="list-skeleton">'+Array.from({length:count||4}).map(()=>'<div class="skeleton-card"><div class="skeleton-line title"></div><div class="skeleton-line wide"></div><div class="skeleton-line mid"></div><div class="skeleton-actions"><div class="skeleton-btn"></div><div class="skeleton-btn"></div></div></div>').join('')+'</div>';
  }
  async function loadParents(){
    $('phonesError').classList.add('hidden');
    if(parentsCache.length)renderPhones(parentsCache);else $('phonesList').innerHTML=makePhonesSkeleton(4);
    try{const res=await callApi('listAvailableParentsForChat',[tutorToken],20000);if(!res||!res.ok)throw new Error((res&&res.message)||'Не удалось загрузить родителей.');parentsCache=Array.isArray(res.rows)?res.rows:[];renderPhones(parentsCache)}
    catch(e){$('phonesList').innerHTML='';$('phonesError').textContent=String(e&&e.message||e);$('phonesError').classList.remove('hidden')}
  }
  function phone10(v){return String(v||'').replace(/\D+/g,'').slice(-10)}
  function displayPhone(v){const p=phone10(v);return p?'8'+p:''}
  async function copyPhone(text,btn){
    text=String(text||'').trim();if(!text)return;
    const old=btn.textContent;
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText)await navigator.clipboard.writeText(text);
      else{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove()}
      btn.textContent='Скопировано';setTimeout(()=>{btn.textContent=old},900);
    }catch(_){btn.textContent='Не скопировано';setTimeout(()=>{btn.textContent=old},1100)}
  }
  function renderPhones(rows){
    const box=$('phonesList');box.replaceChildren();
    if(!rows.length){box.innerHTML='<div class="chat-empty">Нет родителей.</div>';return}
    rows.forEach((r,index)=>{
      const card=document.createElement('div');card.className='phone-card card-enter';card.style.animationDelay=Math.min(index*35,180)+'ms';
      const title=document.createElement('div');title.className='phone-card-title';title.textContent=r.childName||'Без имени ребёнка';
      const meta=document.createElement('div');meta.className='phone-card-meta';
      meta.append(document.createTextNode('Родитель: '+(r.parentName||'—')));meta.appendChild(document.createElement('br'));meta.append(document.createTextNode('Номер телефона: '));
      const strong=document.createElement('span');strong.className='phone-number-strong';strong.textContent=displayPhone(r.phone)||'—';meta.appendChild(strong);
      const actions=document.createElement('div');actions.className='phone-card-actions';
      const copy=document.createElement('button');copy.className='btn btn-teal phone-action-btn';copy.type='button';copy.textContent='Скопировать';copy.addEventListener('click',()=>copyPhone(displayPhone(r.phone),copy));
      const call=document.createElement('a');call.className='btn btn-mint phone-action-btn';call.href='tel:'+String(r.phone||'').replace(/\D+/g,'');call.textContent='Позвонить';
      const del=document.createElement('button');del.className='phone-delete';del.type='button';del.setAttribute('aria-label','Удалить ребёнка');del.textContent='×';del.addEventListener('click',()=>deleteParent(r));
      actions.append(copy,call);card.append(title,del,meta,actions);box.appendChild(card);
    });
  }
  async function deleteParent(row){
    const child=row.childName||'ребёнка';if(!confirm('Удалить «'+child+'» из активной базы? Архив DATABASE останется.'))return;
    try{const preview=await callApi('getReportChildDeletionPreview',[row.phone,tutorToken],15000);if(!preview||!preview.ok)throw new Error((preview&&preview.message)||'Удаление недоступно.');if(!confirm('Подтвердите удаление: '+(preview.childName||child)+'. Чат и активные данные будут очищены.'))return;const res=await callApi('deleteReportChildByPhone',[row.phone,tutorToken],30000);if(!res||!res.ok)throw new Error((res&&res.message)||'Не удалось удалить.');parentsCache=parentsCache.filter(x=>phone10(x.phone)!==phone10(row.phone));renderPhones(parentsCache)}catch(e){alert(String(e&&e.message||e))}
  }
  function openPhones(){setScreen('screenPhones','Телефоны родителей','Здесь можно быстро скопировать номер или позвонить.');loadParents()}

  async function ensureD1Fresh(){
    if(d1Session&&Number(d1Session.expiresAt||0)>Date.now()+60000)return d1Session;
    const res=await callApi('verifyTutorSession',[tutorToken],8000);if(!res||!res.ok||!res.d1Session)throw new Error('Не удалось обновить сессию чата.');saveAuth(tutorToken,res.d1Session);return d1Session;
  }
  async function openChat(){
    try{const s=await ensureD1Fresh();overlay.open({type:'medsi:chat-overlay',action:'open',role:'educator',session:s});}
    catch(e){alert(String(e&&e.message||e))}
  }
  async function refreshUnreadBadge(){
    const badge=$('newParentMsgBanner');if(!d1Session||!window.MedsiOverlayTransport){badge.classList.add('hidden');return}
    try{const res=await MedsiOverlayTransport.chats(d1Session,'unread');const chats=Array.isArray(res&&res.chats)?res.chats:[];badge.classList.toggle('hidden',!chats.some(x=>!!x.hasUnread))}catch(_){badge.classList.add('hidden')}
  }

  function startApp(){
    if(document.body.dataset.started==='1'){showMenu();return}document.body.dataset.started='1';
    overlay=window.MedsiChatOverlay.create({frameId:'__no_iframe__',onOpen:(state,api)=>{if(overlayCleanup){try{overlayCleanup()}catch(_){}overlayCleanup=null}if(window.MedsiEducatorOverlayChat)overlayCleanup=MedsiEducatorOverlayChat.mount(api,state)||null},onClose:()=>{if(overlayCleanup){try{overlayCleanup()}catch(_){}overlayCleanup=null}showMenu()}});
    showMenu();
  }

  $('btnParentChats').addEventListener('click',openChat);
  $('btnMorning').addEventListener('click',()=>openReport('morning'));
  $('btnEvening').addEventListener('click',()=>openReport('evening'));
  $('btnPsychology').addEventListener('click',()=>openReport('psychology'));
  $('btnParentPhones').addEventListener('click',openPhones);
  $('btnBack').addEventListener('click',showMenu);
  $('btnPhonesBack').addEventListener('click',showMenu);
  $('btnAgain').addEventListener('click',showMenu);
  $('btnSend').addEventListener('click',sendReport);
  $('tutorLoginBtn').addEventListener('click',submitLogin);
  $('tutorPassword').addEventListener('keydown',e=>{if(e.key==='Enter')submitLogin()});
  window.medsiForgetCachedChatToken=()=>{safeRemove(D1_KEY);d1Session=null;return true};
  window.medsiLogoutTutor=()=>{clearAuth();location.reload()};
  verifySaved();
})();