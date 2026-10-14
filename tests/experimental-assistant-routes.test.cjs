const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('experimental parent and educator routes load isolated assets; production pages stay on stable assets', () => {
  const server = read('server.js');
  const parent = read('parents_test.html');
  const tutor = read('tutors_test.html');
  const productionParent = read('index.html');
  const productionTutor = read('tutors.html');
  assert.match(server, /\/parents_test.*parents_test\.html/);
  assert.match(server, /\/tutors_test.*tutors_test\.html/);
  assert.match(parent, /chat-screen-test\.js/);
  assert.match(parent, /chat-ui-test\.css/);
  assert.match(tutor, /educator-chat-test\.js/);
  assert.match(tutor, /educator-chat-test\.js\?v=20261014-experiment-2/);
  assert.match(tutor, /educator-exact-test\.css/);
  const tutorAssistant = read('chat-overlay/educator-chat-test.js');
  assert.match(tutorAssistant, /if\(!initialMessagesRendered\)\{/);
  assert.match(tutorAssistant, /detectTutorSuggestion\(\[\],cached\.rows\)/);
  assert.doesNotMatch(tutorAssistant, /if\(!initialMessagesRendered\|\|/);
  assert.doesNotMatch(productionParent, /chat-screen-test|chat-ui-test/);
  assert.doesNotMatch(productionTutor, /educator-chat-test|educator-exact-test/);
});
