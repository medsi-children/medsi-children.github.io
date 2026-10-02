import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../parents/smart-bot.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
runInNewContext(source, sandbox);
const bot = sandbox.window.MedsiSmartBot;
const key = result => typeof result === 'string' ? result : result && result.key;

const cases = [
  ['почему нету отчета', 'reportDelay'],
  ['вечерний ещё не пришёл', 'reportDelay'],
  ['утреннего отчёта до сих пор нет', 'reportDelay'],
  ['утренний опаздывает', 'reportDelay'],
  ['когда будет утренний отчёт', 'reports'],
  ['пришлите последний отчёт', 'reportRequest'],
  ['почему в отчёте написано про лекарства', 'medical'],
  ['спасибо за отчёт', 'thanks'],
  ['как заказать доставку еды ребёнку', 'delivery'],
  ['можно ли привезти таблетки ребёнку', 'delivery'],
  ['когда я могу встретиться с ребёнком', 'meetTime'],
  ['номер лечащего врача', 'doctors'],
  ['во сколько групповая психотерапия', 'groupTherapyTime'],
  ['индивидуальные занятия с психологом', 'individualTherapy'],
  ['как оплатить лечение', 'payment'],
  ['привет, где отчёт', 'reportDelay']
];
for (const [question, expected] of cases) {
  assert.equal(key(bot.classify(question)), expected, question);
}

for (const greeting of ['приветики', 'здарова', 'здрасьте', 'добрый день', 'доброго времени суток', 'приветик, Медси Бот', 'hello']) {
  assert.equal(bot.isGreetingOnly(greeting), true, greeting);
}
for (const question of ['привет, где отчёт?', 'приветствие в отчёте', 'добрый день, когда встреча с ребёнком?']) {
  assert.equal(bot.isGreetingOnly(question), false, question);
}
console.log('✓ Распознавание Медси Бота: 26 сценариев');
