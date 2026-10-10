const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'medsi-bot', 'Медси бот.js'),
  'utf8'
);

function api() {
  const emptySheet = { getLastRow: () => 1, getDataRange: () => ({ getValues: () => [[]] }) };
  const context = {
    console,
    Logger: { log() {} },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => emptySheet }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: name => name === 'MEDSI_SPREADSHEET_ID' ? 'synthetic-sheet' : ''
      })
    }
  };
  vm.createContext(context);
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
    'Лиза Ф.: В 17:00 обсуждали комнату всё спокойно.'
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
    assert.match(prepared.message, /Уберите раздел «Для врачей»/);
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
  assert.match(prepared.message, /найдено два блока/);
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

test('room numbers are removed wherever they appear without changing other numbers', () => {
  const x = api();
  const raw = 'Лена — Комната 501: свободна. В 17:00 переход в 502 палату. Номер 1501 и число 3.501 остаются.';
  assert.equal(x.stripRoomNumbers_(raw),
    'Лена — Комната свободна. В 17:00 переход в палату. Номер 1501 и число 3.501 остаются.');
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
    'Артем К. — В целом поведение приемлемое.\nАртем И. — Сегодня хорошо поужинал.'
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
