const {test} = require('node:test');
const assert = require('node:assert/strict');
const {validate} = require('../tutors/report-validation.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('service sections are rejected by their headings, independent of room labels', () => {
  for (const heading of [
    'Для врачей:', '❗Для врачей', '‼️ ДЛЯ ВРАЧЕЙ： служебный текст',
    '**Для врачей** — заметка', 'Для врача / заметка', 'Врачам...',
    'Общий комментарий:', '📋 ОБЩИЙ КОММЕНТАРИЙ — заметка',
    'Общие комментарии', 'Общий комментарий:: заметка'
  ]) {
    for (const prefix of ['', '501: ']) {
      const result = validate('evening', `${heading}\n${prefix}Лена — Основной текст.`);
      assert.equal(result.ok, false, heading);
      assert.equal(result.issues[0].reason, 'service_section');
    }
  }
});

test('doctor and comment phrases inside a child body are ordinary prose', () => {
  assert.equal(validate('morning',
    'Лена — Передала заметку для врачей. Это общий комментарий о занятии.').ok, true);
});

test('a single bare child name is allowed; bare duplicates are rejected', () => {
  assert.equal(validate('morning', 'Лена: Основной текст.').ok, true);
  const result = validate('morning', 'Лена — Первый текст.\nЛена: Второй текст.');
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].reason, 'duplicate_name');
});

test('a bare name alongside an explicit initial requires an initial', () => {
  const result = validate('evening', 'Лена Т.: Первый текст.\nЛена — Второй текст.');
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].reason, 'missing_initial');
  assert.match(result.message, /без инициала/);
});

test('different initials distinguish namesakes', () => {
  assert.equal(validate('morning', 'Лена Т: Первый текст.\nЛена У. — Второй текст.').ok, true);
});

test('yo, case and initial dots cannot hide duplicate blocks', () => {
  assert.equal(validate('morning', 'Артём И.: Первый текст.\nАРТЕМ И — Второй текст.').ok, false);
  assert.equal(validate('morning', 'Артём: Первый текст.\nАртем — Второй текст.').ok, false);
});

test('popular alternative forms require distinct initials and never rename the source', () => {
  for (const [first, second] of [['Александр','Александра'], ['Саша','Александр'], ['Вова','Владимир'], ['Варя','Варвара']]) {
    const text = `${first}: Первый текст.\n${second} — Второй текст.`;
    const result = validate('evening', text);
    assert.equal(result.ok, false);
    assert.match(result.message, /разные формы имени/);
    assert.equal(validate('evening', `${first} Т.: Первый текст.\n${second} У.: Второй текст.`).ok, true);
  }
});

test('distinct unfamiliar names are not merged by fuzzy matching', () => {
  assert.equal(validate('evening', 'Дарья: Первый текст.\nДарина: Второй текст.').ok, true);
});

test('a surname may distinguish equal initials, while its initial alone cannot', () => {
  assert.equal(validate('evening', 'Кирилл Широков: Первый текст.\nКирилл Шестаков: Второй текст.').ok, true);
  assert.equal(validate('evening', 'Кирилл Ш.: Первый текст.\nКирилл Широков: Второй текст.').ok, false);
});

test('preamble, room labels, dates and author lines do not interfere with child blocks', () => {
  const text = [
    '09.10.2026 г. Утро — день', 'Игры 🎲', 'Общение 💬',
    'Поступление:', '508 Новый ребёнок, 16 лет',
    'Отчёт составили: Тестовый автор', '501',
    'Лена Т.: Основной текст в 17:00, число 1,5.',
    'Палата № 502: Маша — Второй текст.',
    '503 / Лена У — Третий текст.'
  ].join('\n');
  const result = validate('morning', text);
  assert.equal(result.ok, true);
  assert.equal(result.checkedBlocks, 3);
});

test('bare names at the beginning of body lines do not become headers', () => {
  const text = 'Лена — Основной текст.\nМаша говорила о занятии.\nЛена потом пошла на прогулку.';
  assert.equal(validate('evening', text).ok, true);
  assert.equal(validate('evening', text).checkedBlocks, 1);
});

test('empty reports and reports without any formatted child block are rejected', () => {
  assert.equal(validate('morning', ' ').ok, false);
  assert.equal(validate('morning', '09.10 вечер\nИгры\nОтчёт составили: Тестовые авторы').ok, false);
});

test('psychology reports do not use the child header rules', () => {
  assert.equal(validate('psychology', 'Общий комментарий: Синтетический текст.').ok, true);
});

test('report form keeps invalid text and shows success only after queue receipt', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        value:'', textContent:'', disabled:false, dataset:{}, handlers:{},
        classList:{add:name=>classes.add(name), remove:name=>classes.delete(name),
          toggle:(name,on)=>on?classes.add(name):classes.delete(name), contains:name=>classes.has(name)},
        addEventListener(event, handler) {this.handlers[event] = handler;}
      });
    }
    return elements.get(id);
  };
  let release;
  const received = new Promise(resolve => {release = resolve;});
  const queued = [];
  const transport = {chats:async()=>({chats:[]}), reportSubmit:async(_session,payload)=>{
    queued.push(payload); await received; return {accepted:true};
  }};
  const storage = {
    medsi_tutor_session_v1:'synthetic-token',
    medsi_d1_educator_session_v1:JSON.stringify({token:'synthetic-session',expiresAt:Date.now()+3600000})
  };
  const context = {
    window:{MedsiReportValidation:{validate}, MedsiOverlayTransport:transport, scrollTo(){}},
    document:{getElementById:element, body:{dataset:{started:'1'}}},
    MedsiOverlayTransport:transport, localStorage:{getItem:key=>storage[key],setItem(){},removeItem(){}},
    setTimeout:()=>1, clearTimeout(){}, console,
    fetch:()=>{throw new Error('Unexpected Apps Script request');}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../tutors/full-web.js'), 'utf8'), context);
  element('btnMorning').handlers.click();
  const invalid = 'Для врачей:\nЛена — Синтетическая заметка.';
  element('text').value = invalid;
  await element('btnSend').handlers.click();
  assert.match(element('reportError').textContent, /уберите раздел/i);
  assert.equal(element('text').value, invalid);
  assert.equal(context.document.body.dataset.screen, 'report-morning');
  assert.equal(queued.length, 0);

  const valid = 'Лена — Основной текст.';
  element('text').value = valid;
  const sending = element('btnSend').handlers.click();
  assert.equal(context.document.body.dataset.screen, 'report-morning');
  assert.equal(element('btnSend').disabled, true);
  assert.equal(queued[0].text, valid);
  release(); await sending;
  assert.equal(context.document.body.dataset.screen, 'screenDone');
  assert.equal(element('btnSend').disabled, false);
});

test('an aborted Apps Script fallback checks the same submission instead of showing AbortError', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../tutors/full-web.js'), 'utf8');
  const callApi = source.slice(source.indexOf('  async function callApi('), source.indexOf('  function setAuthError('));
  const submit = source.slice(source.indexOf('  async function submitReportPayload('), source.indexOf('  async function sendReport('));
  let requests = 0;
  const recovered = [];
  const context = {
    APP_BASE_URL:'https://example.invalid', tutorToken:'synthetic', d1Session:null,
    window:{MedsiReportValidation:{validate}}, AbortController,
    setTimeout:callback=>setTimeout(callback, 1), clearTimeout,
    fetch:async(_url, options)=>{
      requests++;
      return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{
        reject(Object.assign(new Error('This operation was aborted'),{name:'AbortError'}));
      }));
    },
    waitForReportAcceptance:async()=>null,
    recoverReportSubmission:async(kind,text,id)=>{recovered.push({kind,text,id});return {ok:true};}
  };
  vm.createContext(context);
  vm.runInContext(callApi + submit, context);
  const text = 'Лена — Основной текст.';
  const result = await context.submitReportPayload('morning',text,'report_synthetic_timeout');
  assert.equal(result.accepted, true);
  assert.equal(requests, 1);
  assert.deepEqual(recovered,[{kind:'morning',text,id:'report_synthetic_timeout'}]);
});
