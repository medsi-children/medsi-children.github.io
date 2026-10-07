const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'medsi-bot', 'chat-d1-migration.js'),
  'utf8'
);

function api() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test('report history slots match the Moscow schedule', () => {
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

test('snapshot key keeps one independent slot per kind and date', () => {
  const x = api();
  assert.equal(x.reportHistorySnapshotKey_('2026-10-07', 15), '2026-10-07T15:00');
  assert.equal(x.reportHistorySnapshotKey_('2026-10-07', 23), '2026-10-07T23:00');
  assert.equal(x.reportHistorySnapshotKey_('bad-date', 21), '');
  assert.equal(x.reportHistorySnapshotKey_('2026-10-07', 24), '');
});

test('production worker cron covers every requested Moscow slot after UTC conversion', () => {
  const toml = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'cloudflare', 'chat-worker', 'wrangler.worker.toml'),
    'utf8'
  );
  assert.match(toml, /0 12-15 \* \* \*/);
  assert.match(toml, /0 17-20 \* \* \*/);
});

test('worker accepts psychotherapy snapshots and exposes slot time in history', () => {
  const worker = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'cloudflare', 'chat-worker', 'src', 'index.js'),
    'utf8'
  );
  assert.match(worker, /\['morning', 'evening', 'psychology'\]\.includes\(kind\)/);
  assert.match(worker, /snapshotTime/);
  assert.match(worker, /candidate\.snapshotKey/);
});
