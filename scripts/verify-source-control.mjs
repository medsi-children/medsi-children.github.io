import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...parts) => resolve(root, ...parts);
const failures = [];

function requireFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    failures.push(`Не найден обязательный файл: ${path.replace(`${root}/`, '')}`);
    return false;
  }
  if (statSync(path).size === 0) {
    failures.push(`Пустой обязательный файл: ${path.replace(`${root}/`, '')}`);
    return false;
  }
  return true;
}

const requiredFiles = [
  'server.js',
  'lib/session-preload.js',
  'services/cloudflare/chat-worker/src/index.js',
  'services/cloudflare/chat-worker/wrangler.production.toml',
  'services/cloudflare/chat-worker/migrations/0001_schema.sql',
  'services/cloudflare/chat-worker/migrations/0006_message_idempotency.sql',
  'services/cloudflare/chat-gateway/src/index.js',
  'services/cloudflare/chat-gateway/wrangler.toml',
  'services/cloudflare/push-worker/src/index.js',
  'services/cloudflare/push-worker/wrangler.toml',
  'apps-script/medsi-bot/appsscript.json',
  'apps-script/medsi-bot/Медси бот.js',
  'apps-script/medsi-bot/chat-d1-migration.js',
  'apps-script/medsi-bot/tutor-auth.js',
];

for (const file of requiredFiles) requireFile(rel(file));

const javascriptFiles = requiredFiles
  .filter((file) => file.endsWith('.js'))
  .map((file) => rel(file));

for (const file of javascriptFiles) {
  if (!existsSync(file)) continue;
  const checked = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: readFileSync(file, 'utf8'),
    encoding: 'utf8',
  });
  if (checked.status !== 0) {
    failures.push(`Синтаксическая ошибка в ${file.replace(`${root}/`, '')}: ${checked.stderr.trim()}`);
  }
}

for (const file of ['package.json', 'apps-script/medsi-bot/appsscript.json', 'apps-script/medsi-bot/script-properties.example.json']) {
  const path = rel(file);
  if (!requireFile(path)) continue;
  try {
    JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    failures.push(`Некорректный JSON в ${file}: ${error.message}`);
  }
}

for (const config of [
  'services/cloudflare/chat-worker/wrangler.production.toml',
  'services/cloudflare/chat-gateway/wrangler.toml',
  'services/cloudflare/push-worker/wrangler.toml',
]) {
  const path = rel(config);
  if (!requireFile(path)) continue;
  const body = readFileSync(path, 'utf8');
  const entry = body.match(/^main\s*=\s*"([^"]+)"/m)?.[1];
  if (!entry) {
    failures.push(`В ${config} отсутствует main.`);
  } else if (!existsSync(resolve(dirname(path), entry))) {
    failures.push(`В ${config} указан несуществующий main: ${entry}`);
  }
}

const appsScriptSource = [
  'apps-script/medsi-bot/Медси бот.js',
  'apps-script/medsi-bot/chat-d1-migration.js',
  'apps-script/medsi-bot/tutor-auth.js',
].map((file) => readFileSync(rel(file), 'utf8')).join('\n');

for (const forbidden of ['PUSH_WORKER_SECRET_FALLBACK', 'TUTOR_BOOTSTRAP_LOGIN_', 'TUTOR_BOOTSTRAP_PASSWORD_']) {
  if (appsScriptSource.includes(forbidden)) {
    failures.push(`В Apps Script остался запрещённый резервный секрет: ${forbidden}`);
  }
}

const trackedClasp = spawnSync(
  'git',
  ['ls-files', '--error-unmatch', 'apps-script/medsi-bot/.clasp.json'],
  { cwd: root, encoding: 'utf8' },
);
if (trackedClasp.status === 0) {
  failures.push('apps-script/medsi-bot/.clasp.json не должен быть закоммичен.');
}

if (failures.length) {
  console.error(failures.map((failure) => `✖ ${failure}`).join('\n'));
  process.exit(1);
}

console.log('✓ Исходники Медси Бота существуют, не пустые и проходят базовую проверку синтаксиса.');
