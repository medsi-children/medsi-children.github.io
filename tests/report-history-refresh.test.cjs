const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const migrationSource = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'medsi-bot', 'chat-d1-migration.js'),
  'utf8'
);

function api() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(migrationSource, context);
  return context;
}

test('report history refresh windows match Moscow time', () => {
  const x = api();
  const expected = new Map([
    [15, ['morning']],
    [16, ['morning', 'psychology']],
    [17, ['morning']],
    [18, ['psychology']],
    [20, ['evening']],
    [21, ['psychology', 'evening']],
    [22, ['evening']],
    [23, ['psychology', 'evening']]
  ]);

  for (let hour = 0; hour < 24; hour += 1) {
    assert.deepEqual(Array.from(x.reportHistoryKindsForHour_(hour)), expected.get(hour) || []);
  }
});

test('production worker cron covers every requested Moscow refresh time', () => {
  const toml = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'cloudflare', 'chat-worker', 'wrangler.worker.toml'),
    'utf8'
  );
  assert.match(toml, /0 12-15 \* \* \*/);
  assert.match(toml, /0 17-20 \* \* \*/);
});

test('same-day history updates the existing snapshot instead of creating another one', () => {
  const worker = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'cloudflare', 'chat-worker', 'src', 'index.js'),
    'utf8'
  );
  assert.match(worker, /WHERE phone10 = \? AND kind = \? AND report_date = \?/);
  assert.match(worker, /UPDATE report_snapshots\s+SET text = \?, captured_at = \?/);
  assert.match(worker, /\['morning', 'evening', 'psychology'\]\.includes\(kind\)/);
});

test('psychology requires a publication for the current date', () => {
  assert.match(migrationSource, /\['morning', 'evening', 'psychology'\]\.includes/);
  assert.match(migrationSource, /return !!publication && String\(publication\.date \|\| ''\) === String\(reportDate \|\| ''\)/);
  assert.match(migrationSource, /recordReportHistoryPublication_\('psychology', text\)/);
});

test('D1 migration allows psychology while preserving one row per parent kind and date', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'cloudflare', 'chat-worker', 'migrations', '0010_report_snapshot_psychology.sql'),
    'utf8'
  );
  assert.match(sql, /kind IN \('morning', 'evening', 'psychology'\)/);
  assert.match(sql, /PRIMARY KEY \(phone10, kind, report_date\)/);
});
