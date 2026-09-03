# Apps Script patch for GitHub chat overlay test mode

This patch only intercepts chat when the Apps Script iframe is opened with `shellMode=parents_test` or `shellMode=tutors_test`. Production behavior stays unchanged.

The test shell sends a `medsi:chat-overlay / hello` handshake. Apps Script only returns D1 sessions to the official `медси-бот.рф` parent frame.

## Shared origin check

Use this helper in both `children.html` and `educators.html`:

```js
function isTrustedMedsiShellEvent(event){
  try {
    if (!event || (event.source !== window.parent && event.source !== window.top)) return false;
    const expectedHost = new URL('https://медси-бот.рф').hostname;
    return new URL(String(event.origin || '')).hostname === expectedHost;
  } catch (e) {
    return false;
  }
}
```

## 1. `children.html`

Add near the existing parent shell messaging helpers:

```js
let parentOverlayShellTrusted = false;

function postParentChatOverlayMessage(payload){
  if (!parentOverlayShellTrusted) return;
  const message = Object.assign({ type:'medsi:chat-overlay' }, payload || {});
  try {
    if (window.parent && window.parent !== window) window.parent.postMessage(message, '*');
  } catch (e) {}
}

function issueParentOverlaySession(){
  if (!parentOverlayShellTrusted || !currentPhone) {
    postParentChatOverlayMessage({
      action:'open', role:'parent', phone:currentPhone || '', session:null,
      message:'Не удалось подтвердить тестовую оболочку или телефон родителя.'
    });
    return;
  }

  google.script.run
    .withSuccessHandler(session => {
      postParentChatOverlayMessage({
        action:'open',
        role:'parent',
        phone:currentPhone,
        parentName:regParentName || '',
        childName:regChildName || '',
        session:session || null,
        message:session && session.ok ? '' : 'Не удалось получить сессию чата.'
      });
    })
    .withFailureHandler(error => {
      postParentChatOverlayMessage({
        action:'open', role:'parent', phone:currentPhone,
        parentName:regParentName || '', childName:regChildName || '', session:null,
        message:(error && error.message) || 'Не удалось получить сессию чата.'
      });
    })
    .getD1ChatSession('parent', currentPhone, '');
}

function refreshParentOverlaySession(){
  if (!parentOverlayShellTrusted || !currentPhone) return;
  google.script.run
    .withSuccessHandler(session => postParentChatOverlayMessage({
      action:'session', role:'parent', phone:currentPhone,
      session:session || null,
      message:session && session.ok ? '' : 'Не удалось обновить сессию чата.'
    }))
    .withFailureHandler(error => postParentChatOverlayMessage({
      action:'session', role:'parent', phone:currentPhone, session:null,
      message:(error && error.message) || 'Не удалось обновить сессию чата.'
    }))
    .getD1ChatSession('parent', currentPhone, '');
}

function openParentChatEntry(){
  google.script.url.getLocation(location => {
    const params = location && location.parameter ? location.parameter : {};
    if (String(params.shellMode || '') !== 'parents_test') {
      showChat();
      return;
    }
    issueParentOverlaySession();
  });
}

window.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type !== 'medsi:chat-overlay') return;
  if (!isTrustedMedsiShellEvent(event)) return;

  if (data.action === 'hello') {
    parentOverlayShellTrusted = true;
    return;
  }

  if (!parentOverlayShellTrusted) return;
  if (data.action === 'refresh-session') refreshParentOverlaySession();
});
```

Find:

```js
$('btnChat').addEventListener('click', () => showChat());
```

Replace with:

```js
$('btnChat').addEventListener('click', () => openParentChatEntry());
```

## 2. `educators.html`

Add near `getTutorSessionToken()` / tutor shell helpers:

```js
let educatorOverlayShellTrusted = false;

function postEducatorChatOverlayMessage(payload){
  if (!educatorOverlayShellTrusted) return;
  const message = Object.assign({ type:'medsi:chat-overlay' }, payload || {});
  try {
    if (window.parent && window.parent !== window) window.parent.postMessage(message, '*');
  } catch (e) {}
}

function issueEducatorOverlaySession(action){
  const tutorToken = getTutorSessionToken();
  if (!educatorOverlayShellTrusted || !tutorToken) {
    postEducatorChatOverlayMessage({
      action:action || 'open', role:'educator', session:null,
      message:'Сессия воспитателя не найдена или тестовая оболочка не подтверждена.'
    });
    return;
  }

  google.script.run
    .withSuccessHandler(session => postEducatorChatOverlayMessage({
      action:action || 'open', role:'educator', session:session || null,
      message:session && session.ok ? '' : 'Не удалось получить сессию чата.'
    }))
    .withFailureHandler(error => postEducatorChatOverlayMessage({
      action:action || 'open', role:'educator', session:null,
      message:(error && error.message) || 'Не удалось получить сессию чата.'
    }))
    .getD1ChatSession('educator', '', tutorToken);
}

function openEducatorChatsEntry(){
  google.script.url.getLocation(location => {
    const params = location && location.parameter ? location.parameter : {};
    if (String(params.shellMode || '') !== 'tutors_test') {
      activeChatPhone = '';
      showChats();
      return;
    }
    issueEducatorOverlaySession('open');
  });
}

window.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type !== 'medsi:chat-overlay') return;
  if (!isTrustedMedsiShellEvent(event)) return;

  if (data.action === 'hello') {
    educatorOverlayShellTrusted = true;
    return;
  }

  if (!educatorOverlayShellTrusted) return;
  if (data.action === 'refresh-session') issueEducatorOverlaySession('session');
});
```

Find:

```js
$('btnParentChats').addEventListener('click', () => {
  activeChatPhone = '';
  showChats();
});
```

Replace with:

```js
$('btnParentChats').addEventListener('click', () => openEducatorChatsEntry());
```

## Result

Production remains:

```text
/ -> old Apps Script chat UI
/tutors -> old Apps Script chat UI
```

Test mode becomes:

```text
/parents_test/ -> Apps Script auth/menu -> GitHub overlay -> existing Worker -> D1
/tutors_test/ -> Apps Script auth/menu -> GitHub overlay -> existing Worker -> D1
```

D1 sessions renew automatically while the overlay stays open. No Cloudflare change is required.
