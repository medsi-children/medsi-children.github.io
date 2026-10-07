(function(){
  const APP_BASE_URL='/__session/apps-script';
  const TUTOR_KEY='medsi_tutor_session_v1';
  const D1_KEY='medsi_d1_educator_session_v1';
  const $=id=>document.getElementById(id);
  const state={running:false,inFlight:false,timer:null,requests:[],selected:null,decision:''};
  function tutorToken(){try{return String(localStorage.getItem(TUTOR_KEY)||'')}catch(_){return''}}
  function savedSession(){try{const session=JSON.parse(localStorage.getItem(D1_KEY)||'null');return session&&session.token&&Number(session.expiresAt||0)>Date.now()+10000?session:null}catch(_){return null}}
  async function cloudflareApi(method,path,payload){
    const session=savedSession()||await window.MedsiTutorAdmin?.session();
    if(!session||!session.token)throw new Error('D1_SESSION_UNAVAILABLE');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(path,{method,headers:{'X-Medsi-Chat-Session':session.token,...(method==='POST'?{'content-type':'application/json'}:{})},body:method==='POST'?JSON.stringify(payload||{}):undefined,cache:'no-store',signal:controller.signal});
      const value=await response.json();
      if(!response.ok||!value||value.ok!==true)throw new Error(value&&value.message||('HTTP '+response.status));
      return value;
    }finally{clearTimeout(timer)}
  }
  function timeout(ms){return new Promise((_,reject)=>setTimeout(()=>reject(new Error('TIMEOUT')),ms))}
  async function callApi(method,args,ms){
    const readOnly=/^(get|list|verify|check)/i.test(String(method||''));
    const attempts=1;let lastError; // The gateway retries reads; keep the browser request alive for both attempts.
    for(let attempt=0;attempt<attempts;attempt++){
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),readOnly?35000:(ms||30000));
      try{const r=await fetch(APP_BASE_URL,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'api',method,args:args||[]}),cache:'no-store',signal:controller.signal});const raw=await r.text();let p;try{p=JSON.parse(raw)}catch(_){throw new Error('Некорректный ответ сервера.')}if(!r.ok||!p||p.ok!==true)throw new Error((p&&p.message)||('HTTP '+r.status));clearTimeout(timer);return p.result}catch(e){clearTimeout(timer);lastError=e;if(attempt+1<attempts)await new Promise(resolve=>setTimeout(resolve,350))}
    }
    throw lastError||new Error('TIMEOUT');
  }
  function targetRequestId(){try{return new URL(location.href).searchParams.get('reauth')||''}catch(_){return''}}
  function current(){return state.requests[0]||null}
  function render(){const toast=$('accessRequestToast'),request=current();if(!toast)return;if(!request){toast.classList.add('hidden');state.selected=null;return}toast.classList.remove('hidden','is-leaving');$('accessRequestText').textContent=request.text||((request.actor||'Родитель')+' запрашивает повторную авторизацию');$('accessRequestCode').textContent=request.code||'—';const extra=Math.max(0,state.requests.length-1),count=$('accessRequestCount');count.textContent=extra?('Ещё '+extra):'';count.classList.toggle('hidden',!extra)}
  function orderRequests(rows){const target=targetRequestId();return (rows||[]).slice().sort((a,b)=>{if(a.requestId===target)return-1;if(b.requestId===target)return 1;return String(a.createdAt||'').localeCompare(String(b.createdAt||''))})}
  async function refresh(){if(!state.running||state.inFlight||!tutorToken())return;state.inFlight=true;try{let res;try{res=await cloudflareApi('GET','/lab/parent-access/requests')}catch(_){res=await callApi('listPendingParentReauthorizations',[tutorToken()],14000)}if(res&&res.ok!==false){state.requests=orderRequests(Array.isArray(res.requests)?res.requests:[]);render()}}catch(_){}finally{state.inFlight=false;schedule()}}
  function schedule(){clearTimeout(state.timer);if(state.running)state.timer=setTimeout(refresh,document.hidden?12000:1800)}
  function openConfirm(decision){const request=current();if(!request)return;state.selected=request;state.decision=decision;const approve=decision==='APPROVE';$('accessConfirmIcon').textContent=approve?'✓':'!';$('accessConfirmTitle').textContent=approve?'Подтвердить повторную авторизацию?':'Отклонить запрос?';$('accessConfirmText').textContent=approve?((request.actor||'Родитель')+'. Код '+request.code+' совпадает?'):((request.actor||'Родитель')+' не получит доступ на этом устройстве.');const apply=$('accessConfirmApply');apply.textContent=approve?'Да, открыть доступ':'Да, отклонить';apply.className='btn '+(approve?'access-confirm-apply-approve':'access-confirm-apply-deny');$('accessConfirmError').classList.add('hidden');$('accessRequestConfirm').classList.remove('hidden')}
  function closeConfirm(){$('accessRequestConfirm').classList.add('hidden');state.selected=null;state.decision=''}
  function removeResolved(id){const toast=$('accessRequestToast');state.requests=state.requests.filter(item=>item.requestId!==id);toast.classList.add('is-leaving');setTimeout(()=>{toast.classList.remove('is-leaving');render()},220)}
  async function applyDecision(){const request=state.selected,decision=state.decision,btn=$('accessConfirmApply');if(!request||!decision)return;btn.disabled=true;$('accessConfirmBack').disabled=true;const old=btn.textContent;btn.textContent='Сохраняем…';try{let res;try{res=await cloudflareApi('POST','/lab/parent-access/decision',{requestId:request.requestId,decision})}catch(_){res=await callApi('decideParentReauthorization',[request.requestId,decision,tutorToken()],18000)}const expected=decision==='APPROVE'?'APPROVED':'DENIED';if(!res||res.ok===false||!(res.status===expected||(expected==='APPROVED'&&res.status==='CONSUMED')))throw new Error((res&&res.message)||'Запрос уже недоступен. Обновите список.');closeConfirm();removeResolved(request.requestId);setTimeout(refresh,350)}catch(e){const error=$('accessConfirmError');error.textContent=String(e&&e.message||e)==='TIMEOUT'?'Сервер отвечает медленно. Проверяем состояние запроса…':String(e&&e.message||e);error.classList.remove('hidden');setTimeout(refresh,400)}finally{btn.disabled=false;$('accessConfirmBack').disabled=false;btn.textContent=old}}
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
