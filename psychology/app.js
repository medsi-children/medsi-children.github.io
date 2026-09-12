(function(){
  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const $=id=>document.getElementById(id);
  const TUTOR_KEY='medsi_tutor_session_v1';
  let sendBusy=false,tutorToken='';

  function timeoutPromise(ms){return new Promise((_,reject)=>setTimeout(()=>reject(new Error('TIMEOUT')),ms))}
  function reportSubmissionId(){
    if(window.crypto&&typeof window.crypto.randomUUID==='function')return 'report_'+window.crypto.randomUUID().replace(/-/g,'');
    return 'report_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,12);
  }
  function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
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
    const submissionId=reportSubmissionId();
    sendBusy=true;btn.disabled=true;btn.textContent='Отправляем…';
    try{
      let stopped=false;
      const request=callApi('appendReport',[{reportType:'psychology',text,submissionId},tutorToken],30000)
        .then(value=>({source:'request',value}),error=>({source:'request',error}));
      const acceptance=waitForAcceptance(submissionId,()=>stopped)
        .then(value=>({source:'acceptance',value}),error=>({source:'acceptance',error}));
      const first=await Promise.race([request,acceptance]);
      if(first.source==='acceptance'&&first.value){showDone();return}
      let result=first;
      if(first.source==='request')stopped=true;
      else result=await request;
      if(result.error&&String(result.error&&result.error.message||result.error)!=='TIMEOUT')throw result.error;
      let res=result.value||null;
      if(!res||res.processing){btn.textContent='Проверяем результат…';res=await recoverSubmission(submissionId,text)}
      if(!res||!res.ok)throw new Error((res&&res.message)||'Не удалось отправить отчёт.');
      showDone();
    }catch(e){
      const message=String(e&&e.message||e);
      showError(message==='TIMEOUT'?'Сервер отвечает дольше обычного. Отчёт не нужно отправлять повторно.':message);
    }finally{sendBusy=false;btn.disabled=false;btn.textContent='Отправить'}
  }

  function showDone(){$('formScreen').classList.add('hidden');$('doneScreen').classList.remove('hidden')}

  async function waitForAcceptance(submissionId,shouldStop){
    const deadline=Date.now()+20000;await delay(700);
    while(Date.now()<deadline&&!(shouldStop&&shouldStop())){
      try{
        const status=await callApi('getReportSubmissionStatus',[submissionId,tutorToken],7000);
        if(status&&(status.status==='saved'||status.status==='completed'))return status;
        if(status&&status.status==='failed')throw new Error(status.message||'Не удалось отправить отчёт.');
      }catch(e){if(String(e&&e.message||e)!=='TIMEOUT')throw e}
      await delay(700);
    }
    return null;
  }

  async function recoverSubmission(submissionId,text){
    const deadline=Date.now()+120000;let retried=false,notFoundCount=0;
    while(Date.now()<deadline){
      await delay(2200);
      let status=null;
      try{status=await callApi('getReportSubmissionStatus',[submissionId,tutorToken],12000)}catch(e){if(String(e&&e.message||e)!=='TIMEOUT')throw e;continue}
      if(status&&(status.status==='saved'||status.status==='completed'))return status.result||{ok:true};
      if(status&&status.status==='failed')throw new Error(status.message||'Не удалось отправить отчёт.');
      if(status&&status.status==='not_found'&&++notFoundCount>=2&&!retried){
        retried=true;
        let retry=null;
        try{retry=await callApi('appendReport',[{reportType:'psychology',text,submissionId},tutorToken],30000)}catch(e){if(String(e&&e.message||e)!=='TIMEOUT')throw e}
        if(retry&&retry.ok&&!retry.processing)return retry;
        if(retry&&!retry.ok)throw new Error(retry.message||'Не удалось отправить отчёт.');
      }
    }
    throw new Error('Сервер отвечает дольше обычного. Отчёт продолжает обрабатываться; не отправляйте его повторно.');
  }

  $('authBtn').addEventListener('click',authenticate);
  $('authPassword').addEventListener('keydown',e=>{if(e.key==='Enter')authenticate()});
  $('sendBtn').addEventListener('click',sendReport);
  $('againBtn').addEventListener('click',()=>{$('text').value='';$('doneScreen').classList.add('hidden');$('formScreen').classList.remove('hidden');$('text').focus()});
  restoreTutorSession();
})();
