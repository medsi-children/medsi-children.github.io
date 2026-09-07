(function(){
  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const $=id=>document.getElementById(id);
  const TUTOR_KEY='medsi_tutor_session_v1';
  let sendBusy=false,tutorToken='';

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

  function showError(text){const el=$('reportError');el.textContent=String(text||'');el.classList.toggle('hidden',!text)}

  function safeGet(key){try{return localStorage.getItem(key)||''}catch(_){return''}}
  function safeSet(key,value){try{localStorage.setItem(key,value)}catch(_){} }

  function showForm(){
    $('authScreen').classList.add('hidden');
    $('formScreen').classList.remove('hidden');
    $('text').focus();
  }

  function showAuth(message){
    $('formScreen').classList.add('hidden');
    $('authScreen').classList.remove('hidden');
    if(message){$('authError').textContent=message;$('authError').classList.remove('hidden')}
  }

  async function restoreTutorSession(){
    tutorToken=safeGet(TUTOR_KEY).trim();
    if(!tutorToken){showAuth();return}
    try{
      const res=await callApi('verifyTutorSession',[tutorToken],10000);
      if(res&&res.ok){showForm();return}
    }catch(_){ }
    tutorToken='';safeSet(TUTOR_KEY,'');showAuth();
  }

  async function authenticate(){
    const login=$('authLogin').value.trim(),password=$('authPassword').value;
    const btn=$('authBtn'),error=$('authError');
    error.classList.add('hidden');
    if(!login||!password){error.textContent='Введите логин и пароль.';error.classList.remove('hidden');return}
    btn.disabled=true;btn.textContent='Проверяем…';
    try{
      const res=await callApi('verifyTutorAccess',[login,password],15000);
      if(!res||!res.ok)throw new Error((res&&res.message)||'Неверный логин или пароль.');
      tutorToken=String(res.token||'');
      if(!tutorToken)throw new Error('Сервер не выдал сессию.');
      safeSet(TUTOR_KEY,tutorToken);showForm();
    }catch(e){error.textContent=String(e&&e.message||e)==='TIMEOUT'?'Сервер долго не отвечает. Попробуйте ещё раз.':String(e&&e.message||e);error.classList.remove('hidden')}
    finally{btn.disabled=false;btn.textContent='Войти'}
  }

  async function sendReport(){
    if(sendBusy)return;
    const text=$('text').value,btn=$('sendBtn');showError('');
    if(!text.trim()){showError('Пустой текст отчёта.');return}
    sendBusy=true;btn.disabled=true;btn.textContent='Отправляем…';
    try{
      const res=await callApi('appendReport',[{reportType:'psychology',text},tutorToken],30000);
      if(!res||!res.ok)throw new Error((res&&res.message)||'Не удалось отправить отчёт.');
      $('formScreen').classList.add('hidden');$('doneScreen').classList.remove('hidden');
    }catch(e){
      const message=String(e&&e.message||e);
      showError(message==='TIMEOUT'?'Сервер долго не отвечает. Попробуйте ещё раз.':message);
    }finally{sendBusy=false;btn.disabled=false;btn.textContent='Отправить'}
  }

  $('authBtn').addEventListener('click',authenticate);
  $('authPassword').addEventListener('keydown',e=>{if(e.key==='Enter')authenticate()});
  $('sendBtn').addEventListener('click',sendReport);
  $('againBtn').addEventListener('click',()=>{$('text').value='';$('doneScreen').classList.add('hidden');$('formScreen').classList.remove('hidden');$('text').focus()});
  restoreTutorSession();
})();
