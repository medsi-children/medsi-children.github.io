const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('parent assistant offer is limited to confident mapped topics and skips medical or uncertain messages', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'parents', 'chat-screen-test.js'), 'utf8');
  const anchor = '  window.MedsiParentChatScreen={open,close,refresh};';
  assert.ok(source.includes(anchor));
  const instrumented = source.replace(anchor, `window.__assistantIntent=assistantIntent;${anchor}`);
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { classList:{add(){},remove(){},toggle(){},contains(){return false}} });
    return elements.get(id);
  };
  const window = {
    MedsiSmartBot: { analyze(text) {
      if (text === 'report') return {intent:{key:'reportDelay',kind:'morning'},confidence:.95};
      if (text === 'medical') return {intent:{key:'medical'},confidence:.95};
      return {intent:{key:'delivery'},confidence:.7};
    } },
    MedsiOverlayTransport: { sendMessage:async()=>({}) }, addEventListener() {}
  };
  const document = { getElementById:element, addEventListener(){}, body:{dataset:{screen:'screenChat'}} };
  vm.runInNewContext(instrumented,{window,document,Intl,Date,setTimeout,clearTimeout});
  assert.equal(window.__assistantIntent('report').kind,'morning');
  assert.equal(window.__assistantIntent('medical'),null);
  assert.equal(window.__assistantIntent('uncertain'),null);
});

test('experimental parent assistant uses the Medsi blob and existing report-delay wording, without snapshot-error copy', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'parents', 'chat-screen-test.js'), 'utf8');
  assert.match(source, /src="\/parents\/blob\.webp"/);
  assert.match(source, /Похоже, сегодня подготовка отчёта занимает немного больше времени\. Пожалуйста, подождите ещё немного\./);
  assert.match(source, /Отчёт уже должен был появиться\. Обновите страницу и проверьте ещё раз\./);
  assert.doesNotMatch(source, /не могу (?:надёжно )?проверить|не смог проверить снимок публикации/);
  assert.doesNotMatch(source, /\/lab\/report-(?:current|history)/);
});
