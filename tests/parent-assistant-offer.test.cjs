const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('parent assistant offers only for confident mapped topics and still skips urgent or uncertain messages', () => {
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
      if (text === 'calls') return {intent:{key:'calls'},confidence:.95};
      return {intent:{key:'delivery'},confidence:.7};
    } },
    MedsiOverlayTransport: { sendMessage:async()=>({}) }, addEventListener() {}
  };
  const document = { getElementById:element, addEventListener(){}, body:{dataset:{screen:'screenChat'}} };
  vm.runInNewContext(instrumented,{window,document,Intl,Date,setTimeout,clearTimeout});
  assert.equal(window.__assistantIntent('report').kind,'morning');
  assert.equal(window.__assistantIntent('medical').key,'medical');
  assert.equal(window.__assistantIntent('calls').key,'calls');
  assert.equal(window.__assistantIntent('uncertain'),null);
});

test('doctor-directed answers reveal doctor contacts before asking whether the question was resolved', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'parents', 'chat-screen-test.js'), 'utf8');
  assert.match(source, /const DOCTOR_CONTACT_INTENTS=new Set\(\['meetings','meetTime','calls','payment','medical','medicine'\]\)/);
  assert.match(source, /assistantButton\('Контакты врача',\(\)=>\{body\.textContent=ASSISTANT_ANSWERS\.doctors;showResolutionActions\(\)\}\)/);
  assert.match(source, /function showResolutionActions\(\)\{actions\.replaceChildren\(assistantButton\('Да, вопрос решился'/);
});

test('experimental parent assistant uses the Medsi blob and existing report-delay wording, without snapshot-error copy', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'parents', 'chat-screen-test.js'), 'utf8');
  assert.match(source, /src="\/parents\/blob\.webp"/);
  assert.match(source, /Похоже, сегодня подготовка отчёта занимает немного больше времени\. Пожалуйста, подождите ещё немного\./);
  assert.match(source, /Отчёт уже должен был появиться\. Обновите страницу и проверьте ещё раз\./);
  assert.match(source, /Вы про утренний отчёт или вечерний отчёт\?/);
  assert.doesNotMatch(source, /не могу (?:надёжно )?проверить|не смог проверить снимок публикации/);
  assert.match(source, /\/lab\/report-current/);
  assert.match(source, /\/lab\/report-history/);
});

test('experimental parent and educator doctor contacts match the assistant and stay in one quick-reply button', () => {
  const parentTest = fs.readFileSync(path.join(__dirname, '..', 'parents', 'chat-screen-test.js'), 'utf8');
  const parentAssistant = fs.readFileSync(path.join(__dirname, '..', 'parents', 'bot-chat-runtime.js'), 'utf8');
  const educatorTest = fs.readFileSync(path.join(__dirname, '..', 'chat-overlay', 'educator-chat-test.js'), 'utf8');
  const unescapeNewlines = value => value.replace(/\\n/g, '\n');
  const testParentContacts = parentTest.match(/doctors:'([^']*)'/)?.[1];
  const sourceContacts = parentAssistant.match(/DOCTOR_CONTACTS_TEXT = "([^"]*)"/)?.[1];
  const educatorContacts = educatorTest.match(/doctors:"([^"]*)"/)?.[1];
  assert.ok(testParentContacts && sourceContacts && educatorContacts);
  assert.equal(unescapeNewlines(testParentContacts), unescapeNewlines(sourceContacts));
  assert.equal(unescapeNewlines(educatorContacts), unescapeNewlines(sourceContacts));
  assert.equal((educatorTest.match(/\['doctors','Контакты врачей'/g) || []).length, 1);
  assert.doesNotMatch(educatorTest, /\['(?:anastasia|anton)','/);
});
