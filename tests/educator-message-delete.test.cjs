const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function worker(row) {
  const updates = [];
  const context = {Response, console};
  const source = read('services/cloudflare/chat-worker/src/index.js')
    .replace('export default {', 'globalThis.__mutateMessage = mutateMessage;\nconst worker = {');
  vm.createContext(context);
  vm.runInContext(source, context);
  const env = {CHAT_DB:{prepare(sql) {
    return {bind(...args) {
      return {
        first:async()=>row,
        run:async()=>{updates.push({sql,args});return {meta:{changes:1}};}
      };
    }};
  }}};
  return {mutate:(kind, role, payload={})=>context.__mutateMessage(
    new Request('https://example.test', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),
    env,kind,'message-key',{role,phone10:'9990000001'}
  ),updates};
}

test('educators may delete parent messages but may not edit them', async()=>{
  const target = worker({message_key:'message-key',side:'parent',phone10:'9990000001',text:'Test'});
  const deleted = await target.mutate('delete','educator');
  assert.equal(deleted.status,200);
  assert.equal((await deleted.json()).ok,true);
  assert.equal(target.updates.length,1);
  assert.match(target.updates[0].sql,/status = 'deleted'/);

  const edit = await target.mutate('edit','educator',{text:'Changed'});
  assert.equal(edit.status,403);
  assert.equal(target.updates.length,1);
});

test('educators can edit captions on their own media messages', async()=>{
  for (const type of ['image','video']) {
    const target = worker({message_key:'message-key',side:'educator',phone10:'9990000001',type,text:'Old caption'});
    const response = await target.mutate('edit','educator',{text:'New caption'});
    assert.equal(response.status,200);
    assert.equal((await response.json()).text,'New caption');
    assert.equal(target.updates.length,1);
    assert.match(target.updates[0].sql,/UPDATE chat_messages SET text = \?, edited_at = \?/);
    assert.equal(target.updates[0].args[0],'New caption');
  }
});

test('parents still cannot delete another side message', async()=>{
  const target = worker({message_key:'message-key',side:'educator',phone10:'9990000001',text:'Test'});
  const response = await target.mutate('delete','parent');
  assert.equal(response.status,403);
  assert.equal(target.updates.length,0);
});

test('both educator panels expose delete for parent messages while keeping own-message editing',()=>{
  for(const file of ['chat-overlay/educator-chat.js','chat-overlay/educator-chat-test.js']) {
    const source=read(file);
    assert.match(source,/m\.side==='educator'\|\|m\.side==='parent'/);
    assert.match(source,/contextAction\('⌫','Удалить',async\(\)=>\{if\(!confirm\('Удалить это сообщение\?'\)\)/);
    assert.match(source,/m\.side==='educator'&&\['text','image','video'\]\.includes\(m\.type\).*Редактировать/);
  }
});

test('educator chat keeps manual quick replies but no longer mounts the contextual assistant',()=>{
  const production=read('chat-overlay/educator-chat.js');
  const experimental=read('chat-overlay/educator-chat-test.js');
  const styles=read('tutors/assistant.css');
  assert.equal(production,experimental);
  assert.match(production,/\['reportDelay','Задержка отчёта','quick-indigo'\]/);
  assert.match(read('chat-overlay/educator-exact.css'),/\.quick-indigo\{/);
  assert.doesNotMatch(production,/tutorSuggestionPlan|detectTutorSuggestion|makeTutorSuggestion|closeTutorAssistant|tutor-assistant-suggestion/);
  assert.doesNotMatch(production,/Кажется, здесь могу помочь\. Предложить ответ\?/);
  assert.doesNotMatch(styles,/\.tutor-assistant-suggestion|\.tutor-assistant-copy|\.tutor-assistant-actions/);
});

for (const file of ['chat-overlay/educator-chat.js', 'chat-overlay/educator-chat-test.js']) {
  function threadLoader(thread) {
    const source = read(file);
    const prefix = source.slice(0, source.indexOf('  function mount('));
    const helper = source.slice(source.indexOf('    function threadWithTimeout('), source.indexOf('    function showThreadLoadFailure('));
    let fireTimeout, cleared = false, delay;
    const context = {transport:{thread},session:{token:'fixture'},
      setTimeout(fn,ms){fireTimeout=fn;delay=ms;return 1;},
      clearTimeout(){cleared=true;}};
    vm.runInNewContext(prefix + helper + '\nglobalThis.load=threadWithTimeout;})();', context);
    return {load:context.load,timeout:()=>fireTimeout(),delay:()=>delay,cleared:()=>cleared};
  }
  test(`${file}: opening a thread reaches transport and clears its timeout`,async()=>{
    const response={messages:[{text:'Fixture message'}]};
    let calls=0;
    const loader=threadLoader(async(session,phone)=>{calls++;assert.equal(session.token,'fixture');assert.equal(phone,'0000000000');return response;});
    assert.equal(await loader.load('0000000000'),response);
    assert.equal(calls,1);assert.equal(loader.delay(),8000);assert.equal(loader.cleared(),true);
  });
  test(`${file}: a stalled thread rejects with a recoverable timeout`,async()=>{
    const loader=threadLoader(()=>new Promise(()=>{}));
    const pending=loader.load('0000000000');
    loader.timeout();
    await assert.rejects(pending,error=>error.code==='THREAD-TIMEOUT');
  });
  test(`${file}: a network rejection reaches the caller`,async()=>{
    const loader=threadLoader(async()=>{throw new Error('network unavailable');});
    await assert.rejects(loader.load('0000000000'),/network unavailable/);
    assert.equal(loader.cleared(),true);
  });
}

for(const file of ['tutors.html','tutors_test.html']) {
  test(`${file}: stalled deferred scripts cannot prevent the loading watchdog`,()=>{
    const script=read(file).match(/<script>\s*([\s\S]*?)<\/script>/)[1];
    const nodes={authCheckingText:{textContent:''},authRetry:{classList:{remove(value){this.removed=value;}}}};
    let timer,delay;
    vm.runInNewContext(script,{window:{},document:{getElementById:id=>nodes[id]},setTimeout(fn,ms){timer=fn;delay=ms;}});
    assert.equal(delay,12000);timer();
    assert.match(nodes.authCheckingText.textContent,/Не удалось полностью загрузить/);
    assert.equal(nodes.authRetry.classList.removed,'hidden');
  });
}
