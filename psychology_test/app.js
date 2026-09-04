(function(){
  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const TUTOR_KEY='medsi_tutor_session_v1';
  const $=id=>document.getElementById(id);
  let tutorToken='';
  let authBusy=false;

  function safeGet(key){try{return localStorage.getItem(key)||''}catch(_){return''}}
  function safeSet(key,val){try{localStorage.setItem(key,val)}catch(_){}}
  function safeRemove(key){try{localStorage.removeItem(key)}catch(_){}}
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

  function setAuthError(text){const el=$('authError');el.textContent=String(text||'');el.classList.toggle('hidden',!text)}
  function showLogin(){
    $('authGate').classList.remove('hidden');$('authChecking').classList.add('hidden');$('authCard').classList.remove('hidden');$('app').classList.add('hidden');
    setTimeout(()=>$('login').focus(),30);
  }
  function showApp(){
    $('authGate').classList.add('hidden');$('app').classList.remove('hidden');$('formScreen').classList.remove('hidden');$('doneScreen').classList.add('hidden');
  }
  function clearAuth(){tutorToken='';safeRemove(TUTOR_KEY)}

  async function verifySaved(){
    tutorToken=String(safeGet(TUTOR_KEY)||'');
    if(!tutorToken){showLogin();return}
    try{
      const res=await callApi('verifyTutorSession',[tutorToken],8000);
      if(!res||!res.ok){clearAuth();showLogin();return}
      showApp();
    }catch(_){clearAuth();showLogin()}
  }

  async function submitLogin(){
    if(authBusy)return;
    const login=$('login').value.trim(),password=$('password').value;
    if(!login||!password){setAuthError('Введите логин и пароль.');return}
    authBusy=true;$('loginBtn').disabled=true;$('loginBtn').textContent='Проверяем…';setAuthError('');
    try{
      const res=await callApi('verifyTutorAccess',[login,password],15000);
      if(!res||!res.ok||!res.token)throw new Error((res&&res.message)||'Не удалось войти.');
      tutorToken=String(res.token);safeSet(TUTOR_KEY,tutorToken);$('password').value='';showApp();
    }catch(e){setAuthError(String(e&&e.message||e)==='TIMEOUT'?'Сервер долго не отвечает. Попробуйте ещё раз.':String(e&&e.message||e))}
    finally{authBusy=false;$('loginBtn').disabled=false;$('loginBtn').textContent='Войти в систему'}
  }

  async function sendReport(){
    const text=$('text').value,btn=$('sendBtn'),err=$('reportError');err.classList.add('hidden');
    if(!text.trim()){err.textContent='Пустой текст отчёта.';err.classList.remove('hidden');return}
    btn.disabled=true;btn.textContent='Отправляем…';
    try{
      const res=await callApi('appendReport',[{reportType:'psychology',text},tutorToken],30000);
      if(!res||!res.ok)throw new Error((res&&res.message)||'Не удалось отправить отчёт.');
      $('formScreen').classList.add('hidden');$('doneScreen').classList.remove('hidden');
    }catch(e){
      const message=String(e&&e.message||e);
      if(/сесс|авториз|доступ/i.test(message)){clearAuth();showLogin();setAuthError('Сессия истекла. Войдите ещё раз.');return}
      err.textContent=message;err.classList.remove('hidden');
    }finally{btn.disabled=false;btn.textContent='Отправить'}
  }

  $('loginBtn').addEventListener('click',submitLogin);
  $('password').addEventListener('keydown',e=>{if(e.key==='Enter')submitLogin()});
  $('sendBtn').addEventListener('click',sendReport);
  $('againBtn').addEventListener('click',()=>{$('text').value='';$('doneScreen').classList.add('hidden');$('formScreen').classList.remove('hidden');$('text').focus()});
  $('logoutBtn').addEventListener('click',()=>{clearAuth();location.reload()});
  verifySaved();
})();