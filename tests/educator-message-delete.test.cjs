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
    assert.match(source,/m\.side==='educator'&&m\.type==='text'.*Редактировать/);
  }
});

test('the production educator panel includes the tested assistant suggestions and their reply preset',()=>{
  const production=read('chat-overlay/educator-chat.js');
  const experimental=read('chat-overlay/educator-chat-test.js');
  const styles=read('tutors/assistant.css');
  assert.equal(production,experimental);
  assert.match(production,/function detectTutorSuggestion\(previous,next\)/);
  assert.match(production,/\['reportDelay','Задержка отчёта','quick-indigo'\]/);
  assert.match(production,/function tutorMessageHasLaterReply\(list,key\)/);
  assert.match(production,/editor\.addEventListener\('input'/);
  assert.match(styles,/\.tutor-assistant-suggestion\.is-compact\{/);
  assert.match(styles,/\.tutor-assistant-suggestion\.is-expanded\{/);
  assert.match(styles,/right:max\(12px,env\(safe-area-inset-right\)\)/);
  assert.match(read('chat-overlay/educator-exact.css'),/\.quick-indigo\{/);
});

test('educator assistant is time-aware and conservative about context',()=>{
  const source=read('chat-overlay/educator-chat-test.js');
  const anchor='  window.MedsiEducatorOverlayChat={mount};';
  assert.ok(source.includes(anchor));
  const instrumented=source.replace(anchor, '  window.__tutorSuggestionPlan=tutorSuggestionPlan;\n'+anchor);
  const context={window:{},Intl,Date};
  vm.createContext(context);
  vm.runInContext(instrumented,context);
  const plan=context.window.__tutorSuggestionPlan;
  const morningBefore=Date.parse('2026-10-15T07:42:00Z'); // 10:42 Moscow
  const morningLate=Date.parse('2026-10-15T14:10:00Z');   // 17:10 Moscow

  assert.equal(plan('когда утренний отчет?',morningBefore).key,'reportSchedule');
  assert.equal(plan('где утренний отчет?',morningBefore).key,'reportSchedule');
  assert.equal(plan('где утренний отчет?',morningLate).key,'reportDelay');
  assert.equal(plan('где отчет?',morningLate),null);
  assert.equal(plan('спасибо, доставку получили',morningBefore),null);
  assert.equal(plan('куда курьеру привезти вещи?',morningBefore).key,'delivery');
  assert.equal(plan('номер лечащего врача',morningBefore).key,'doctors');
  assert.equal(plan('какие препараты принимает ребенок?',morningBefore).key,'medical');
  assert.equal(plan('у ребенка температура, какие лекарства дать?',morningBefore),null);
  assert.equal(plan('почему в утреннем отчете нет лекарства?',morningBefore),null);
  assert.equal(plan('срочно где утренний отчет',morningLate),null);
});
