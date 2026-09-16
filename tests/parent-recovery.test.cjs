const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function environment(fetch){
  const elements=new Map(),storage=new Map(),timers=new Map();let timerId=0;
  const noop=()=>{};
  const node=()=>({classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},style:{},dataset:{},addEventListener:noop,setAttribute:noop,scrollTo:noop,replaceChildren:noop,appendChild:noop,querySelector:()=>null,value:'',textContent:''});
  const ctx={console,AbortController,fetch,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{getElementById:id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id)},createElement:node,addEventListener:noop,body:node()},window:{scrollTo:noop,addEventListener:noop},navigator:{},alert:message=>{throw new Error('Unexpected alert: '+message)},requestAnimationFrame:noop,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)};
  vm.createContext(ctx);return {ctx,elements,storage,timers};
}
function parent(fetch){
  const env=environment(fetch);
  let source=fs.readFileSync(path.join(root,'parents/full-web.js'),'utf8');
  source=source.replace('  boot();',`  window.audit={warmD1,warmReport,readD1,clearSession,openChat,setup(session){currentPhone='0000000000';parentSession='test-auth';d1Session=session;},setSession(session){d1Session=session;},cache:reportCache};`);
  vm.runInContext(source,env.ctx);return {...env,api:env.ctx.window.audit};
}
const session={token:'synthetic',expiresAt:Date.now()+3600000};
const response=value=>({ok:true,status:200,json:async()=>value,text:async()=>JSON.stringify(value)});
test('parallel session renewal makes only one gateway request and allows its retries to finish',async()=>{
  let calls=0,resolve;const env=parent(()=>{calls++;return new Promise(r=>resolve=r)});env.api.setup({...session,expiresAt:0});
  const a=env.api.warmD1(),b=env.api.warmD1();assert.equal(calls,1);assert.ok([...env.timers.values()].some(t=>t.ms===35000));
  resolve(response({ok:true,result:session}));assert.equal((await a).token,'synthetic');assert.equal((await b).token,'synthetic');
});
test('hung report requests are aborted, released, and can be requested again',async()=>{
  let calls=0,healthy=false;const env=parent((url,options)=>{calls++;if(healthy)return Promise.resolve(response({ok:true,reports:[]}));return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));});env.api.setup(session);
  const pending=env.api.warmReport('morning');await tick();
  assert.equal(calls,1);
  for(const timer of [...env.timers.values()])if(timer.ms===12000)timer.fn();await tick();
  for(const timer of [...env.timers.values()])if(timer.ms===400)timer.fn();await tick();
  for(const timer of [...env.timers.values()])if(timer.ms===12000)timer.fn();await tick();
  assert.equal(await pending,null);healthy=true;
  assert.ok((await env.api.warmReport('morning')).ok);assert.equal(calls,3);
});
test('expired report cache refreshes without restarting the page',async()=>{
  let calls=0;const env=parent(async()=>{calls++;return response({ok:true,reports:[{kind:'morning',text:'new',version:'2'}]})});env.api.setup(session);
  env.api.cache.morning={ok:true,text:'old',fetchedAt:Date.now()-61000};
  assert.equal((await env.api.warmReport('morning')).text,'new');assert.equal(calls,1);
  await env.api.warmReport('morning');assert.equal(calls,1);
});
test('late session renewal cannot restore a logged-out account',async()=>{
  let resolve;const env=parent(()=>new Promise(r=>resolve=r));env.api.setup(null);
  const pending=env.api.warmD1();env.api.clearSession();resolve(response({ok:true,result:session}));
  assert.equal(await pending,null);assert.equal(env.storage.has('medsi_d1_parent_session_v1'),false);
});
test('chat schedules recovery after first network failure',async()=>{
  const env=environment();env.ctx.window.MedsiOverlayTransport={thread:async()=>{throw Object.assign(new Error('offline'),{code:'NETWORK'})}};
  vm.runInContext(fs.readFileSync(path.join(root,'parents/chat-screen.js'),'utf8'),env.ctx);
  await env.ctx.window.MedsiParentChatScreen.open({phone:'0000000000',session});
  assert.ok([...env.timers.values()].some(t=>t.ms===1500));
  assert.equal(env.elements.get('parentChatError').textContent,'Восстанавливаем соединение…');
});
test('chat obtains a fresh session before reading and does not wait for prewarm',async()=>{
  const env=environment();let used;
  env.ctx.window.MedsiParentPrewarm={peek:()=>null,ready:()=>new Promise(()=>{})};env.ctx.MedsiParentPrewarm=env.ctx.window.MedsiParentPrewarm;
  env.ctx.window.MedsiOverlayTransport={thread:async s=>{used=s.token;throw new Error('offline')}};
  vm.runInContext(fs.readFileSync(path.join(root,'parents/chat-screen.js'),'utf8'),env.ctx);
  await env.ctx.window.MedsiParentChatScreen.open({phone:'0000000000',session:{token:'expired'},getSession:async()=>session});
  assert.equal(used,'synthetic');
});
test('rejected read token is renewed once and the read resumes',async()=>{
  let reads=0,renewals=0;const tokens=[];
  const env=parent(async(url,options)=>{
    if(url==='/__session/apps-script'){renewals++;return response({ok:true,result:{...session,token:'renewed'}});}
    reads++;tokens.push(options.headers['X-Medsi-Chat-Session']);
    if(reads===1)return {ok:false,status:401,json:async()=>({ok:false})};
    return response({ok:true,reports:[]});
  });env.api.setup(session);
  const result=env.api.readD1('/lab/report-current');await tick();
  for(const timer of [...env.timers.values()])if(timer.ms===400)timer.fn();
  assert.ok((await result).ok);assert.equal(renewals,1);assert.deepEqual(tokens,['synthetic','renewed']);
});
test('menu startup finishes even when every auxiliary script hangs',async()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const loader=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const env=environment();let coreLoaded=false;const appended=[];
  env.ctx.document.createElement=()=>({remove(){}});
  env.ctx.document.head={appendChild(script){appended.push(script.src);if(script.src.startsWith('/parents/full-web.js')){coreLoaded=true;env.ctx.window.MedsiParentApp={ready:true};Promise.resolve().then(()=>script.onload());}}};
  vm.runInContext(loader,env.ctx);await tick();
  assert.ok(coreLoaded);assert.ok(env.ctx.window.MedsiParentApp.ready);
  assert.ok(appended.some(src=>src.startsWith('/chat-overlay/transport.js')));
  assert.equal(appended[0].split('?')[0],'/parents/full-web.js');
});
test('empty chat renders after the first request failed and a background read recovered',async()=>{
  const env=environment();let offline=true;
  env.ctx.window.MedsiOverlayTransport={thread:async()=>{if(offline)throw new Error('offline');return {ok:true,messages:[]}},markRead:async()=>({ok:true})};
  vm.runInContext(fs.readFileSync(path.join(root,'parents/chat-screen.js'),'utf8'),env.ctx);
  await env.ctx.window.MedsiParentChatScreen.open({phone:'0000000000',session});
  let rendered;env.elements.get('parentChatMessages').replaceChildren=el=>{rendered=el.textContent;};
  offline=false;await env.ctx.window.MedsiParentChatScreen.refresh({fresh:true,background:true});
  assert.equal(rendered,'Сообщений пока нет.');
});
test('a confirmed empty cache is shown immediately while the next read is still pending',async()=>{
  const env=environment();let finish;
  env.ctx.window.MedsiParentPrewarm={peek:()=>({ok:true,messages:[]})};env.ctx.MedsiParentPrewarm=env.ctx.window.MedsiParentPrewarm;
  env.ctx.window.MedsiOverlayTransport={thread:()=>new Promise(resolve=>finish=resolve),markRead:async()=>({ok:true})};
  vm.runInContext(fs.readFileSync(path.join(root,'parents/chat-screen.js'),'utf8'),env.ctx);
  let rendered;env.ctx.document.getElementById('parentChatMessages').replaceChildren=el=>{if(el)rendered=el.textContent;};
  const opening=env.ctx.window.MedsiParentChatScreen.open({phone:'0000000000',session});await tick();
  assert.equal(rendered,'Сообщений пока нет.');finish({ok:true,messages:[]});await opening;
});
test('reopening is not locked by a previous unfinished chat read',async()=>{
  const env=parent(async()=>response({ok:true,result:{ok:true}}));env.api.setup(session);
  let opens=0;const completions=[];
  env.ctx.window.MedsiParentChatScreen={close(){},open(){opens++;return new Promise(resolve=>completions.push(resolve));}};
  env.ctx.MedsiParentChatScreen=env.ctx.window.MedsiParentChatScreen;
  const first=env.api.openChat();await tick();const second=env.api.openChat();await tick();
  assert.equal(opens,2);completions.forEach(resolve=>resolve());await Promise.all([first,second]);
});
test('previously loaded history remains available for display after its freshness interval',()=>{
  const env=environment();const saved={res:{ok:true,messages:[{messageKey:'example',text:'synthetic'}]},at:Date.now()-120000};
  env.ctx.sessionStorage={getItem:()=>JSON.stringify(saved)};
  const noop=async()=>({ok:true});env.ctx.window.fetch=noop;
  env.ctx.window.MedsiOverlayTransport={thread:noop,sendMessage:noop,edit:noop,remove:noop,react:noop};
  vm.runInContext(fs.readFileSync(path.join(root,'parents/prewarm.js'),'utf8'),env.ctx);
  assert.equal(env.ctx.window.MedsiParentPrewarm.peek('0000000000').messages[0].messageKey,'example');
});
