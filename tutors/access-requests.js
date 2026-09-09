(function(){
  const APP_BASE_URL='https://script.google.com/macros/s/AKfycbzRKRjjI7NoHx8rD5ifEdrcexGuYlMEB453sOC2UTZDeBaybZiNPIY0vDTMkmeHhebVpA/exec';
  const TUTOR_KEY='medsi_tutor_session_v1';
  const $=id=>document.getElementById(id);
  const state={running:false,inFlight:false,timer:null,requests:[],selected:null,decision:''};
  function tutorToken(){try{return String(localStorage.getItem(TUTOR_KEY)||'')}catch(_){return''}}
  function timeout(ms){return new Promise((_,reject)=>setTimeout(()=>reject(new Error('TIMEOUT')),ms))}
  async function callApi(method,args,ms){const run=async()=>{const r=await fetch(APP_BASE_URL,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'api',method,args:args||[]}),cache:'no-store'});const raw=await r.text();let p;try{p=JSON.parse(raw)}catch(_){throw new Error('Некорректный ответ сервера.')}if(!r.ok||!p||p.ok!==true)throw new Error((p&&p.message)||('HTTP '+r.status));return p.result};return Promise.race([run(),timeout(ms||15000)])}
  function targetRequestId(){try{return new URL(location.href).searchParams.get('reauth')||''}catch(_){return''}}
  function current(){return state.requests[0]||null}
  function render(){const toast=$('accessRequestToast'),request=current();if(!toast)return;if(!request){toast.classList.add('hidden');state.selected=null;return}toast.classList.remove('hidden','is-leaving');$('accessRequestText').textContent=request.text||((request.actor||'Родитель')+' запрашивает повторную авторизацию');$('accessRequestCode').textContent=request.code||'—';const extra=Math.max(0,state.requests.length-1),count=$('accessRequestCount');count.textContent=extra?('Ещё '+extra):'';count.classList.toggle('hidden',!extra)}
  function orderRequests(rows){const target=targetRequestId();return (rows||[]).slice().sort((a,b)=>{if(a.requestId===target)return-1;if(b.requestId===target)return 1;return String(a.createdAt||'').localeCompare(String(b.createdAt||''))})}
  async function refresh(){if(!state.running||state.inFlight||!tutorToken())return;state.inFlight=true;try{const res=await callApi('listPendingParentReauthorizations',[tutorToken()],14000);if(res&&res.ok!==false){state.requests=orderRequests(Array.isArray(res.requests)?res.requests:[]);render()}}catch(_){}finally{state.inFlight=false;schedule()}}
  function schedule(){clearTimeout(state.timer);if(state.running)state.timer=setTimeout(refresh,7000)}
  function openConfirm(decision){const request=current();if(!request)return;state.selected=request;state.decision=decision;const approve=decision==='APPROVE';$('accessConfirmIcon').textContent=approve?'✓':'!';$('accessConfirmTitle').textContent=approve?'Подтвердить повторную авторизацию?':'Отклонить запрос?';$('accessConfirmText').textContent=approve?((request.actor||'Родитель')+'. Код '+request.code+' совпадает?'):((request.actor||'Родитель')+' не получит доступ на этом устройстве.');const apply=$('accessConfirmApply');apply.textContent=approve?'Да, открыть доступ':'Да, отклонить';apply.className='btn '+(approve?'access-confirm-apply-approve':'access-confirm-apply-deny');$('accessConfirmError').classList.add('hidden');$('accessRequestConfirm').classList.remove('hidden')}
  function closeConfirm(){$('accessRequestConfirm').classList.add('hidden');state.selected=null;state.decision=''}
  function removeResolved(id){const toast=$('accessRequestToast');state.requests=state.requests.filter(item=>item.requestId!==id);toast.classList.add('is-leaving');setTimeout(()=>{toast.classList.remove('is-leaving');render()},220)}
  async function applyDecision(){const request=state.selected,decision=state.decision,btn=$('accessConfirmApply');if(!request||!decision)return;btn.disabled=true;$('accessConfirmBack').disabled=true;const old=btn.textContent;btn.textContent='Сохраняем…';try{const res=await callApi('decideParentReauthorization',[request.requestId,decision,tutorToken()],18000);if(!res||res.ok===false)throw new Error((res&&res.message)||'Не удалось сохранить решение.');closeConfirm();removeResolved(request.requestId);setTimeout(refresh,350)}catch(e){const error=$('accessConfirmError');error.textContent=String(e&&e.message||e)==='TIMEOUT'?'Сервер отвечает медленно. Проверяем состояние запроса…':String(e&&e.message||e);error.classList.remove('hidden');setTimeout(refresh,400)}finally{btn.disabled=false;$('accessConfirmBack').disabled=false;btn.textContent=old}}
  function start(){if(state.running)return;state.running=true;refresh()}
  function stop(){state.running=false;clearTimeout(state.timer);state.timer=null;state.requests=[];render();closeConfirm()}
  $('accessRequestApprove').onclick=()=>openConfirm('APPROVE');
  $('accessRequestDeny').onclick=()=>openConfirm('DENY');
  $('accessConfirmBack').onclick=closeConfirm;
  $('accessConfirmApply').onclick=applyDecision;
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.running)refresh()});
  window.addEventListener('focus',()=>{if(state.running)refresh()});
  window.MedsiAccessRequests={start,stop,refresh};
})();
