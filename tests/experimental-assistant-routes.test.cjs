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
  const tutorChat = read('chat-overlay/educator-chat-test.js');
  const parentAssistant = read('parents/chat-screen-test.js');
  const educatorLayout = read('tutors/full-web-fixes.css');

  assert.match(server, /\/parents_test.*parents_test\.html/);
  assert.match(server, /\/tutors_test.*tutors_test\.html/);
  assert.match(parent, /chat-screen-test\.js/);
  assert.match(parent, /chat-ui-test\.css/);
  assert.match(tutor, /educator-chat-test\.js\?v=20261015-teal-timeout-1/);
  assert.match(tutor, /educator-exact-test\.css\?v=20261015-teal-timeout-1/);
  assert.match(parent, /chat-screen-test\.js\?v=20261014-experiment-5/);
  assert.match(parent, /chat-ui-test\.css\?v=20261014-experiment-4/);

  assert.match(parentAssistant, /host=document\.body/);
  assert.doesNotMatch(tutorChat, /tutorSuggestionPlan|detectTutorSuggestion|tutor-assistant-suggestion/);
  assert.doesNotMatch(read('chat-overlay/educator-exact-test.css'), /\.tutor-assistant-suggestion|\.tutor-assistant-close/);

  assert.match(productionTutor,/educator-chat\.js\?v=20261015-teal-timeout-1/);
  assert.match(productionParent,/chat-screen\.js\?v=20261014-assistant-1/);
  assert.match(productionParent,/parents\/smart-bot\.js\?v=20261002-15/);
  assert.match(read('parents/chat-ui-test.css'), /width:min\(360px,calc\(100vw - 24px - env\(safe-area-inset-left\) - env\(safe-area-inset-right\)\)\)/);
  assert.match(educatorLayout, /width:min\(94vmin,860px\)!important/);
  assert.match(educatorLayout, /height:min\(94vmin,860px\)!important/);
  assert.match(educatorLayout, /@media \(min-width: 900px\)/);
  assert.doesNotMatch(productionParent, /chat-screen-test|chat-ui-test/);
  assert.doesNotMatch(productionTutor, /educator-chat-test|educator-exact-test/);
});
