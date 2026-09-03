# Apps Script patch for GitHub chat overlay test mode

This patch only intercepts the chat buttons when the Apps Script iframe URL contains:

- `shellMode=parents_test`
- `shellMode=tutors_test`

Production behavior remains unchanged.

## 1. `children.html`

Add this helper near the existing `postParentSessionMessage` / shell messaging helpers:

```js
function postParentChatOverlayMessage(payload){
  const message = Object.assign({ type:'medsi:chat-overlay' }, payload || {});
  try {
    if (window.parent && window.parent !== window) window.parent.postMessage(message, '*');
  } catch (e) {}
  try {
    if (window.top && window.top !== window && window.top !== window.parent) window.top.postMessage(message, '*');
  } catch (e) {}
}

function openParentChatEntry(){
  google.script.url.getLocation(location => {
    const params = location && location.parameter ? location.parameter : {};
    const shellMode = String(params.shellMode || '');

    if (shellMode !== 'parents_test') {
      showChat();
      return;
    }

    if (!currentPhone) {
      postParentChatOverlayMessage({
        action:'open',
        role:'parent',
        phone:'',
        session:null,
        message:'Не удалось определить телефон родителя.'
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
          action:'open',
          role:'parent',
          phone:currentPhone,
          parentName:regParentName || '',
          childName:regChildName || '',
          session:null,
          message:(error && error.message) || 'Не удалось получить сессию чата.'
        });
      })
      .getD1ChatSession('parent', currentPhone, '');
  });
}
```

Find:

```js
$('btnChat').addEventListener('click', () => showChat());
```

Replace with:

```js
$('btnChat').addEventListener('click', () => openParentChatEntry());
```

Nothing else in the existing parent chat UI is removed.

## 2. `educators.html`

Add this helper near `getTutorSessionToken()` / tutor shell messaging helpers:

```js
function postEducatorChatOverlayMessage(payload){
  const message = Object.assign({ type:'medsi:chat-overlay' }, payload || {});
  try {
    if (window.parent && window.parent !== window) window.parent.postMessage(message, '*');
  } catch (e) {}
  try {
    if (window.top && window.top !== window && window.top !== window.parent) window.top.postMessage(message, '*');
  } catch (e) {}
}

function openEducatorChatsEntry(){
  google.script.url.getLocation(location => {
    const params = location && location.parameter ? location.parameter : {};
    const shellMode = String(params.shellMode || '');

    if (shellMode !== 'tutors_test') {
      activeChatPhone = '';
      showChats();
      return;
    }

    const tutorToken = getTutorSessionToken();
    if (!tutorToken) {
      postEducatorChatOverlayMessage({
        action:'open',
        role:'educator',
        session:null,
        message:'Сессия воспитателя не найдена. Войдите заново.'
      });
      return;
    }

    google.script.run
      .withSuccessHandler(session => {
        postEducatorChatOverlayMessage({
          action:'open',
          role:'educator',
          session:session || null,
          message:session && session.ok ? '' : 'Не удалось получить сессию чата.'
        });
      })
      .withFailureHandler(error => {
        postEducatorChatOverlayMessage({
          action:'open',
          role:'educator',
          session:null,
          message:(error && error.message) || 'Не удалось получить сессию чата.'
        });
      })
      .getD1ChatSession('educator', '', tutorToken);
  });
}
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

Nothing else in the existing educator chat UI is removed.

## Result

Normal production shell:

```text
/ -> Apps Script old chat UI
/tutors -> Apps Script old chat UI
```

Test shell:

```text
/parents_test/ -> Apps Script auth/menu -> GitHub overlay -> Worker -> D1
/tutors_test/ -> Apps Script auth/menu -> GitHub overlay -> Worker -> D1
```

No Cloudflare change is required for this handoff.
