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

test('same-day correction updates one D1 row; unchanged and yesterday duplicates are skipped', async () => {
  const worker = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'cloudflare', 'chat-worker', 'src', 'index.js'),
    'utf8'
  );
  const start = worker.indexOf('async function upsertReportSnapshots(');
  const end = worker.indexOf('async function getParentReportHistory(', start);
  assert.ok(start >= 0 && end > start);
  const rows = new Map();
  let inserts = 0;
  let updates = 0;
  const database = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (/report_date = \?/.test(sql)) return rows.get(args.slice(0, 3).join('|')) || null;
              const prefix = args.slice(0, 2).join('|') + '|';
              const previous = [...rows.entries()]
                .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length) < args[2])
                .sort(([left], [right]) => right.localeCompare(left));
              return previous.length ? previous[0][1] : null;
            },
            async run() {
              if (/INSERT INTO report_snapshots/.test(sql)) {
                const key = args.slice(0, 3).join('|');
                if (rows.has(key)) return { meta: { changes: 0 } };
                rows.set(key, { text: args[3], capturedAt: args[4] });
                inserts++;
              } else if (/UPDATE report_snapshots/.test(sql)) {
                rows.set(args.slice(2, 5).join('|'), { text: args[0], capturedAt: args[1] });
                updates++;
              } else if (/DELETE FROM report_snapshots/.test(sql)) {
                return { meta: { changes: 0 } };
              } else {
                throw new Error('Unexpected SQL: ' + sql);
              }
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
  const context = {
    body: request => request,
    phone10: value => String(value).replace(/\D/g, '').slice(-10),
    json: value => value,
    Date
  };
  vm.createContext(context);
  vm.runInContext(worker.slice(start, end), context);
  const capture = (date, text) => context.upsertReportSnapshots({
    snapshots: [{ phone: '79001234567', kind: 'psychology', reportDate: date, text, capturedAt: 42 }],
    skipIfMatchesPrevious: true
  }, { CHAT_DB: database });
  assert.equal((await capture('2026-10-07', 'Начало')).saved, 1);
  assert.equal((await capture('2026-10-07', 'Начало. Заключение')).updated, 1);
  assert.equal((await capture('2026-10-07', 'Начало.  Заключение')).skippedDuplicate, 1);
  assert.equal((await capture('2026-10-08', 'Начало. Заключение')).skippedDuplicate, 1);
  assert.equal(rows.size, 1);
  assert.equal(inserts, 1);
  assert.equal(updates, 1);
  assert.equal(rows.get('9001234567|psychology|2026-10-07').text, 'Начало. Заключение');
});

test('yesterday publication cannot capture psychology as today', () => {
  assert.match(migrationSource, /\['morning', 'evening', 'psychology'\]\.includes/);
  assert.match(migrationSource, /recordReportHistoryPublication_\('psychology', text\)/);
  const x = api();
  x.readReportHistoryPublication_ = () => ({ date: '2026-10-06' });
  x.reportHistoryDate_ = () => '2026-10-07';
  x.Utilities = { formatDate: () => '16' };
  x.captureReportHistoryKind_ = () => { throw new Error('Yesterday report was captured'); };
  assert.equal(x.reportHistoryPublicationMatches_('psychology', '2026-10-07'), false);
  assert.equal(x.reportHistoryPublicationMatches_('psychology', '2026-10-06'), true);
  const captured = x.captureDueReportHistorySnapshots_().captured;
  assert.equal(captured.length, 2);
  assert.ok(captured.every(item => item.skipped === true));
});

test('D1 migration allows psychology while preserving one row per parent kind and date', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'cloudflare', 'chat-worker', 'migrations', '0010_report_snapshot_psychology.sql'),
    'utf8'
  );
  assert.match(sql, /kind IN \('morning', 'evening', 'psychology'\)/);
  assert.match(sql, /PRIMARY KEY \(phone10, kind, report_date\)/);
});
