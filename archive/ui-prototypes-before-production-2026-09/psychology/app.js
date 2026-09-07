(function(){
  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const $=id=>document.getElementById(id);
  let sendBusy=false;

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

  async function sendReport(){
    if(sendBusy)return;
    const text=$('text').value,btn=$('sendBtn');showError('');
    if(!text.trim()){showError('Пустой текст отчёта.');return}
    sendBusy=true;btn.disabled=true;btn.textContent='Отправляем…';
    try{
      const res=await callApi('appendReport',[{reportType:'psychology',text}],30000);
      if(!res||!res.ok)throw new Error((res&&res.message)||'Не удалось отправить отчёт.');
      $('formScreen').classList.add('hidden');$('doneScreen').classList.remove('hidden');
    }catch(e){
      const message=String(e&&e.message||e);
      showError(message==='TIMEOUT'?'Сервер долго не отвечает. Попробуйте ещё раз.':message);
    }finally{sendBusy=false;btn.disabled=false;btn.textContent='Отправить'}
  }

  $('sendBtn').addEventListener('click',sendReport);
  $('againBtn').addEventListener('click',()=>{$('text').value='';$('doneScreen').classList.add('hidden');$('formScreen').classList.remove('hidden');$('text').focus()});
})();