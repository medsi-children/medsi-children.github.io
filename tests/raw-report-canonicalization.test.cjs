const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'medsi-bot', 'Медси бот.js'),
  'utf8'
);

function api(nameVariantRows = []) {
  const emptySheet = { getLastRow: () => 1, getDataRange: () => ({ getValues: () => [[]] }) };
  const nameVariantsSheet = {
    getLastRow: () => nameVariantRows.length + 1,
    getDataRange: () => ({
      getValues: () => [['Имя-ориентир', 'Варианты'], ...nameVariantRows]
    })
  };
  const context = {
    console,
    Logger: { log() {} },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: name => name === 'NAME_VARIANTS' ? nameVariantsSheet : emptySheet
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: name => name === 'MEDSI_SPREADSHEET_ID' ? 'synthetic-sheet' : ''
      })
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/medsi-bot/report-rules.js'), 'utf8'), context);
  vm.runInContext(source, context);
  return context;
}

function child(api, name, family, phone) {
  const out = api.buildReportChildren_(
    [api.normalizeReportChildName_(name, family)],
    [family]
  )[0];
  out.phone = phone || '';
  out.phone10 = api.last10_(phone || '');
  return out;
}

test('canonicalizer normalizes initial punctuation and delimiter without touching the body', () => {
  const x = api();
  const lisa = child(x, 'Лиза', 'Федорова', '89990000001');
  const variants = [
    'Лиза Ф: Текст с авторской формулировкой.',
    'Лиза Ф.: Текст с авторской формулировкой.',
    'Лиза Ф - Текст с авторской формулировкой.',
    'Лиза: Текст с авторской формулировкой.'
  ];

  variants.forEach(raw => {
    const result = x.canonicalizeRawChildReport_(raw, { children:[lisa] });
    assert.equal(result.text, 'Лиза Ф. — Текст с авторской формулировкой.');
  });
});

test('room number before a child header is removed without consuming the name separator', () => {
  const x = api();
  const lisa = child(x, 'Лиза', 'Федорова', '89990000001');
  const raw = [
    '501: Лиза Ф.: Была на встрече в 17:00.',
    '502 Маша — Играла в настольные игры.',
    '503\nЛиза Ф. — Отдыхала.',
    '№ 504:\nМаша: Читала книгу.'
  ].join('\n');

  assert.equal(
    x.stripRoomNumbers_(raw),
    'Лиза Ф.: Была на встрече в 17:00.\nМаша — Играла в настольные игры.\nЛиза Ф. — Отдыхала.\nМаша: Читала книгу.'
  );
  const result = x.canonicalizeRawChildReport_(raw, { children:[lisa] });
  assert.equal(
    result.text,
    'Лиза Ф. — Была на встрече в 17:00.\nМаша — Играла в настольные игры.\nЛиза Ф. — Отдыхала.\nМаша — Читала книгу.'
  );
  assert.equal(result.changed, true);
  assert.equal(
    x.stripRoomNumbers_('Лиза Ф.: В 17:00 обсуждали комнату 501: всё спокойно.'),
    'Лиза Ф.: В 17:00 обсуждали комнату 501: всё спокойно.'
  );
});

test('room label after report boilerplate does not remove the first child', () => {
  const x = api();
  const lena = child(x, 'Лена', 'Тестовая', '89990000001');
  const masha = child(x, 'Маша', 'Учебная', '89990000002');
  lena.index = 0;
  masha.index = 1;
  const raw = [
    'Вечерний отчёт',
    'Игры и общение',
    '',
    '501: Лена — Первое вымышленное предложение.',
    '502: Маша — Второе вымышленное предложение.'
  ].join('\n');
  const context = x.buildDistributionContext_([lena, masha], []);
  x.buildReportValidationChildren_ = () => [lena, masha];
  for (const variant of ['501: Лена', '501 Лена', '501:\nЛена', '501\nЛена', '№ 501: Лена', '501 / Лена', '501 — Лена', '501, Лена', 'Палата № 501: Лена']) {
    const prepared = x.prepareRawReportSourceText_('evening', raw.replace('501: Лена', variant));
    assert.equal(prepared.ok, true);
    assert.equal(prepared.text,
      'Лена Т. — Первое вымышленное предложение.\nМаша У. — Второе вымышленное предложение.');
    const parsed = x.parseReportBlocks_(prepared.text, x.buildKnownBaseKeys_([lena, masha]), context);
    const distributed = x.buildSafeDistribution_('evening', parsed, context);
    assert.match(distributed.byRow[0], /^Лена: Первое вымышленное предложение\.$/);
    assert.match(distributed.byRow[1], /^Маша: Второе вымышленное предложение\.$/);
  }
});

test('a doctors section is rejected before child report cleanup, with or without rooms', () => {
  const x = api();
  const lena = child(x, 'Лена', 'Тестовая', '89990000001');
  x.buildReportValidationChildren_ = () => [lena];
  for (const marker of ['Для врачей:', '❗Для врачей']) {
    const raw = [
      'Вечерний отчёт',
      marker,
      'Лена — Служебная запись.',
      '501: Лена — Основной текст.'
    ].join('\n');
    const prepared = x.prepareRawReportSourceText_('evening', raw);
    assert.equal(prepared.ok, false);
    assert.match(prepared.message, /уберите раздел «Для врачей»/i);
    assert.equal(prepared.text, raw);
  }
});

test('two blocks for one child are rejected even with a bare name and no rooms', () => {
  const x = api();
  const lena = child(x, 'Лена', 'Тестовая', '89990000001');
  x.buildReportValidationChildren_ = () => [lena];
  const prepared = x.prepareRawReportSourceText_('evening',
    'Лена — Первая запись.\nЛена — Вторая запись.');
  assert.equal(prepared.ok, false);
  assert.match(prepared.message, /повторяется/);
});

test('admissions are preamble when the doctors section has been removed', () => {
  const x = api();
  const lena = child(x, 'Лена', 'Тестовая', '89990000001');
  x.buildReportValidationChildren_ = () => [lena];
  const prepared = x.prepareRawReportSourceText_('morning',
    'Поступление:\nНовый ребёнок, 16 лет\nЛена: Основной текст.');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.text, 'Лена Т. — Основной текст.');
});

test('room numbers inside a child body are preserved', () => {
  const x = api();
  const raw = 'Лена — Комната 501: свободна. В 17:00 переход в 502 палату. Номер 1501 и число 3.501 остаются.';
  assert.equal(x.stripRoomNumbers_(raw),
    raw);
  assert.equal(x.stripRoomNumbers_('503:\n  Лена — Текст.\nМаша — Текст.'),
    'Лена — Текст.\nМаша — Текст.');
});

test('unregistered child keeps a bare name, while an explicit initial gets a dot', () => {
  const x = api();
  assert.equal(
    x.canonicalizeRawChildReport_('Лиза: Пока без регистрации.', { children:[] }).text,
    'Лиза — Пока без регистрации.'
  );
  assert.equal(
    x.canonicalizeRawChildReport_('Лиза М: Пока без регистрации.', { children:[] }).text,
    'Лиза М. — Пока без регистрации.'
  );
});

test('an old bare name is recovered when a second same-named child appears and previous assignment is confirmed', () => {
  const x = api();
  const oldLisa = child(x, 'Лиза', 'Федорова', '89990000001');
  const newLisa = child(x, 'Лиза', 'Морозова', '89990000002');

  const result = x.canonicalizeRawChildReport_(
    'Лиза: Старый уже распределённый текст.',
    {
      children:[oldLisa, newLisa],
      previousChildren:[oldLisa],
      confirmPreviousAssignment:payload => (
        payload.previousTargets.length === 1 &&
        payload.currentTargets.length === 1 &&
        payload.currentTargets[0].phone10 === '9990000001'
      )
    }
  );

  assert.equal(result.text, 'Лиза Ф. — Старый уже распределённый текст.');
  assert.equal(result.recovered, 1);
  assert.deepEqual(Array.from(result.unresolved), []);
});

test('an ambiguous old bare name is never guessed without proof', () => {
  const x = api();
  const oldLisa = child(x, 'Лиза', 'Федорова', '89990000001');
  const newLisa = child(x, 'Лиза', 'Морозова', '89990000002');

  const result = x.canonicalizeRawChildReport_(
    'Лиза: Нельзя угадывать.',
    {
      children:[oldLisa, newLisa],
      previousChildren:[oldLisa],
      confirmPreviousAssignment:() => false
    }
  );

  assert.equal(result.text, 'Лиза: Нельзя угадывать.');
  assert.deepEqual(Array.from(result.unresolved), ['Лиза']);
});

test('same surname initial escalates to the shortest supported unique prefix', () => {
  const x = api();
  const wide = child(x, 'Кирилл', 'Широков', '89990000003');
  const six = child(x, 'Кирилл', 'Шестаков', '89990000004');

  const result = x.canonicalizeRawChildReport_(
    'Кирилл Шир: Первый ребёнок.\nКирилл Шест: Второй ребёнок.',
    { children:[wide, six] }
  );

  assert.equal(
    result.text,
    'Кирилл Ши — Первый ребёнок.\nКирилл Ше — Второй ребёнок.'
  );
});

test('service headers are preserved and are not mistaken for children', () => {
  const x = api();
  const lisa = child(x, 'Лиза', 'Федорова', '89990000001');
  const result = x.canonicalizeRawChildReport_(
    'Лиза: Всё хорошо.\nДля врачей: Наблюдение без изменений.',
    { children:[lisa] }
  );

  assert.equal(
    result.text,
    'Лиза Ф. — Всё хорошо.\nДля врачей: Наблюдение без изменений.'
  );
});


test('a child name without colon or dash is plain text, never a canonicalized header', () => {
  const x = api();
  const lisa = child(x, 'Лиза', 'Федорова', '89990000001');
  const raw = 'Маша: Сегодня общалась с Лиза Ф\nЛиза Ф потом присоединилась к игре.';
  const result = x.canonicalizeRawChildReport_(raw, { children:[lisa] });

  assert.equal(
    result.text,
    'Маша — Сегодня общалась с Лиза Ф\nЛиза Ф потом присоединилась к игре.'
  );
  assert.doesNotMatch(result.text, /Лиза Ф\. —/);
});


test('canonicalizer removes report boilerplate before the first explicit child header', () => {
  const x = api();
  const artemK = child(x, 'Артём', 'Кузнецов', '89990000005');
  const artemI = child(x, 'Артём', 'Иванов', '89990000006');
  const raw = [
    '# 🐸 ОТЧЕТ ПО ДЕТЯМ: ВЕЧЕР',
    '6 октября 🌙 День-вечер',
    'Сегодня у ребят были:',
    '💃 Танцы',
    '🎨 Творчество',
    '💬 Общение',
    '🎲 Настольные игры',
    '🍿 Киносеанс',
    '',
    'Отчёт составили: Денис и Лиза',
    '•••',
    '',
    'Артём К. - В целом поведение приемлемое.',
    'Артём И. - Сегодня хорошо поужинал.'
  ].join('\n');

  const result = x.canonicalizeRawChildReport_(raw, { children:[artemK, artemI] });

  assert.equal(
    result.text,
    'Артём К. — В целом поведение приемлемое.\nАртём И. — Сегодня хорошо поужинал.'
  );
  assert.equal(result.preambleRemoved, true);
  assert.doesNotMatch(result.text, /ОТЧЕТ ПО ДЕТЯМ|Сегодня у ребят были|Отчёт составили|Танцы|Киносеанс/);
});

test('preamble trimming never starts from a bare child-name mention without a delimiter', () => {
  const x = api();
  const lisa = child(x, 'Лиза', 'Федорова', '89990000001');
  const raw = [
    'Служебная строка',
    'Лиза Ф была на прогулке',
    'Лиза Ф: Настоящий блок отчёта.'
  ].join('\n');

  const result = x.canonicalizeRawChildReport_(raw, { children:[lisa] });
  assert.equal(result.text, 'Лиза Ф. — Настоящий блок отчёта.');
});

test('room cleanup preserves multiline child content and removes only separate labels', () => {
  const x=api();
  const raw=[
    '10.10.2026 Утро',
    'Поступление: 508 Новый ребёнок, 16 лет',
    '501: Лена — Обсуждала комнату 502: всё спокойно.',
    'В игре получила 503 балла; записала 17:00 и 1,5.',
    '504',
    'Это число относится к предыдущему предложению.',
    'Палата № 505:',
    '',
    '506 Маша: Упомянула палату 507. Число 508 осталось в тексте.',
    '509'
  ].join('\n');
  const clean=x.stripRoomNumbers_(raw);
  assert.match(clean,/Лена — Обсуждала комнату 502: всё спокойно/);
  assert.match(clean,/503 балла; записала 17:00 и 1,5/);
  assert.match(clean,/\n504\nЭто число/);
  assert.doesNotMatch(clean,/Палата № 505/);
  assert.match(clean,/Маша: Упомянула палату 507. Число 508 осталось/);
  assert.match(clean,/\n509$/);
  assert.doesNotMatch(clean,/501: Лена|506 Маша/);
  const children=[child(x,'Лена','Тестовая'),child(x,'Маша','Учебная')];
  x.buildReportValidationChildren_=()=>children;
  const prepared=x.prepareRawReportSourceText_('morning',raw);
  assert.equal(prepared.ok,true);
  const parsed=x.parseReportBlocks_(prepared.text,x.buildKnownBaseKeys_(children),x.buildDistributionContext_(children,[]));
  assert.match(parsed.blocks[0].body,/комнату 502:/);
  assert.match(parsed.blocks[0].body,/504 Это число/);
  assert.match(parsed.blocks[1].body,/палату 507/);
  assert.match(parsed.blocks[1].body,/509$/);
});

test('web and manual sheet edits share structural rules and allow correctable formatting', () => {
  const x=api();
  const web=require('../tutors/report-validation.js');
  const children=[child(x,'Лена','Тестовая'),child(x,'Маша','Учебная')];
  x.buildReportValidationChildren_=()=>children;
  const examples=[
    ['Лена — Единственный ребёнок без инициала.',true],
    ['501: Лена Т : Текст .\nМаша У— Ещё текст ,без пробела.',true],
    ['Палата № 501\n  Лена Т. – В 17:00 съела 1,5 порции.',true],
    ['Лена — Первый блок.\nЛена Т. — Второй блок.',false],
    ['Лена — Первый блок.\nЛена — Второй блок.',false],
    ['Вова — Первый блок.\nВладимир — Второй блок.',false],
    ['📋 Общие комментарии： текст\nЛена — Основной блок.',false],
    ['**Для врача** — заметка\nЛена — Основной блок.',false]
  ];
  for(const [raw,expected] of examples){
    const frontend=web.validate('morning',raw);
    const sheet=x.prepareRawReportSourceText_('morning',raw);
    assert.equal(frontend.ok,expected,raw);
    assert.equal(sheet.ok,expected,raw);
    if(!expected)assert.equal(sheet.message,frontend.message);
  }
  let note='';
  const raw='Лена — Первый блок.\nЛена — Второй блок.';
  const cell={getValue:()=>raw,setNote:value=>{note=value;}};
  x.getLatestReportCell_=()=>cell;
  x.saveRawReportPublication_=()=>{throw new Error('Invalid source must not be saved or distributed');};
  x.distributeChildReports=()=>{throw new Error('Invalid source must not distribute');};
  const result=x.processRawReportSourceEdit_('morning',{});
  assert.equal(result.ok,false);
  assert.match(note,/повторяется/);
  assert.equal(cell.getValue(),raw);
});


test('NAME_VARIANTS matches aliases without renaming the registered display name', () => {
  const x = api([['Владимир', 'Вова, Володя']]);
  const volodya = child(x, 'Володя', 'Сидоров', '89990000001');
  volodya.index = 0;

  assert.equal(x.normalizeReportChildName_('Володя', 'Сидоров'), 'Володя С');
  assert.equal(x.getNameBaseKey_('Володя'), x.getNameBaseKey_('Вова'));

  const context = x.buildDistributionContext_([volodya], []);
  const prepared = x.canonicalizeRawChildReport_(
    'Вова С: Спокойно участвовал в занятиях.',
    { children:[volodya] }
  );
  assert.equal(prepared.text, 'Володя С. — Спокойно участвовал в занятиях.');

  const parsed = x.parseReportBlocks_(
    prepared.text,
    x.buildKnownBaseKeys_([volodya]),
    context
  );
  const distributed = x.buildSafeDistribution_('morning', parsed, context);
  assert.equal(distributed.byRow[0], 'Володя: Спокойно участвовал в занятиях.');
});

test('exact registered spelling wins before a shared alias group', () => {
  const x = api([['Александр', 'Саша, Александра']]);
  const alexander = child(x, 'Александр', 'Петров', '89990000011');
  const alexandra = child(x, 'Александра', 'Иванова', '89990000012');
  alexander.index = 0;
  alexandra.index = 1;
  const children = [alexander, alexandra];
  const context = x.buildDistributionContext_(children, []);
  const known = x.buildKnownBaseKeys_(children);

  const exact = x.parseReportBlocks_(
    'Александр П. — Первый текст.\nАлександра И. — Второй текст.',
    known,
    context
  );
  const exactDistribution = x.buildSafeDistribution_('morning', exact, context);
  assert.equal(exactDistribution.byRow[0], 'Александр: Первый текст.');
  assert.equal(exactDistribution.byRow[1], 'Александра: Второй текст.');

  const aliases = x.parseReportBlocks_(
    'Саша П. — Первый текст.\nСаша И. — Второй текст.',
    known,
    context
  );
  const aliasDistribution = x.buildSafeDistribution_('morning', aliases, context);
  assert.equal(aliasDistribution.byRow[0], 'Александр: Первый текст.');
  assert.equal(aliasDistribution.byRow[1], 'Александра: Второй текст.');

  const ambiguous = x.parseReportBlocks_('Саша — Нельзя угадывать.', known, context);
  const ambiguousDistribution = x.buildSafeDistribution_('morning', ambiguous, context);
  assert.deepEqual(Object.keys(ambiguousDistribution.byRow), []);
});

test('explicit exact name with a wrong initial never falls back to another alias', () => {
  const x = api([['Александр', 'Саша, Александра']]);
  const alexander = child(x, 'Александр', 'Петров', '89990000011');
  const alexandra = child(x, 'Александра', 'Иванова', '89990000012');
  alexander.index = 0;
  alexandra.index = 1;
  const children = [alexander, alexandra];
  const context = x.buildDistributionContext_(children, []);
  const parsed = x.parseReportBlocks_(
    'Александр И. — Не должен попасть Александре.',
    x.buildKnownBaseKeys_(children),
    context
  );
  const distributed = x.buildSafeDistribution_('morning', parsed, context);
  assert.deepEqual(Object.keys(distributed.byRow), []);
});
