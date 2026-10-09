const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('parent draft survives an uncertain send and a failed refresh does not report a successful send as failed', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'parents', 'chat-screen.js'), 'utf8');
  const anchor = '  window.MedsiParentChatScreen={open,close,refresh};';
  assert.ok(source.includes(anchor));
  const instrumented = source.replace(anchor, `
    render = function(list){rows=list};
    refresh = function(){return Promise.reject(new Error('read failed'))};
    focusComposer = function(){};
    scheduleLive = function(){};
    window.__testChat = {setState(next){state=next},getRows(){return rows}};
    ${anchor}`);
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', disabled: false, textContent: '',
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }
    });
    return elements.get(id);
  };
  const sentIds = [];
  let fail = true;
  const window = {
    addEventListener() {},
    MedsiOverlayTransport: {
      async sendMessage(_session, _role, _phone, payload) {
        sentIds.push(payload.clientMessageId);
        if (fail) throw new Error('network lost');
        return { ok: true, message: { messageKey: 'saved', side: 'parent', type: 'text', text: payload.text, timestamp: Date.now() } };
      }
    }
  };
  const document = { getElementById: element, addEventListener() {}, body: { dataset: { screen: 'screenChat' } } };
  vm.runInNewContext(instrumented, { window, document, crypto: { randomUUID: () => 'same-id' }, setTimeout, clearTimeout, Intl, Date });
  window.__testChat.setState({ phone: '9991112233', session: { token: 'session' } });
  const input = element('parentChatInput');
  input.value = 'Текст для мамы';
  const submit = element('parentChatCompose').onsubmit;
  await submit({ preventDefault() {} });
  assert.equal(input.value, 'Текст для мамы');
  assert.equal(element('parentChatError').textContent.includes('Текст сохранён'), true);

  fail = false;
  await submit({ preventDefault() {} });
  assert.deepEqual(sentIds, ['same-id', 'same-id']);
  assert.equal(input.value, '');
  assert.equal(element('parentChatError').textContent, '');
  assert.equal(window.__testChat.getRows()[0].messageKey, 'saved');
});
