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
    assert.match(source,/Удалить сообщение родителя/);
    assert.match(source,/m\.side==='educator'&&m\.type==='text'.*Редактировать/);
  }
});
