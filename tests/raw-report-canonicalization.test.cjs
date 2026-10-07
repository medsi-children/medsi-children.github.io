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
  const emptySheet = { getDataRange: () => ({ getValues: () => [[]] }) };
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
