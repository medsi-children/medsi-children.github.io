import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
  'services/cloudflare/chat-worker/wrangler.production.toml',
  'services/cloudflare/chat-worker/migrations/0001_schema.sql',
  'services/cloudflare/chat-worker/migrations/0006_message_idempotency.sql',
];

for (const file of requiredFiles) requireFile(rel(file));

const configPath = rel('services/cloudflare/chat-worker/wrangler.production.toml');
if (existsSync(configPath)) {
  const config = readFileSync(configPath, 'utf8');
  if (!/^database_name\s*=\s*"medsi-chat-production"$/m.test(config)) {
    failures.push('D1 migration config must target medsi-chat-production.');
  }
  if (!/^database_id\s*=\s*"[0-9a-f-]{36}"$/m.test(config)) {
    failures.push('D1 migration config must include the production database ID.');
  }
  if (/^(main|name|workers_dev|routes|crons|APP_SCRIPT_URL)\s*=/m.test(config)) {
    failures.push('D1 migration config must not contain Worker deployment or Apps Script settings.');
  }
}

// Apps Script publishes only the explicit allowlist. A new source file must
// never pass repository checks while silently disappearing from deployment.
const appsDirectory = rel('apps-script/medsi-bot');
const claspRules = readFileSync(resolve(appsDirectory, '.claspignore'), 'utf8').split(/\r?\n/).map(line => line.trim());
for (const file of readdirSync(appsDirectory).filter(file => file.endsWith('.js'))) {
  if (!claspRules.includes('!' + file)) failures.push(`Apps Script source is excluded from publication: ${file}`);
}

if (failures.length) {
  console.error(failures.map((failure) => `✖ ${failure}`).join('\n'));
  process.exit(1);
}

console.log('✓ Исходники сайта и минимальная конфигурация ручных D1-миграций на месте.');
