# MEDSI BOT GitHub Chat Overlay — test development plan

Status: development only. Nothing in this branch is production-deployed.

## Test URLs after explicit release

- `/parents_test/` — parent shell with GitHub chat overlay.
- `/tutors_test/` — educator shell with GitHub chat overlay.
- `/` and `/tutors` must remain unchanged until explicit approval.

## Architecture

```text
Apps Script iframe
  |  authenticated identity + short D1 session via postMessage
  v
GitHub shell overlay
  |  direct chat reads/writes
  v
medsi-chat-worker (existing /lab/... production API)
  v
Cloudflare D1
```

Apps Script remains responsible for parent/tutor authorization and for issuing scoped D1 session tokens. The GitHub shell must never mint or infer a session from a phone number alone.

## Shell protocol

Test iframe URL adds `shellMode=parents_test` or `shellMode=tutors_test`.

Apps Script -> GitHub:

```js
{
  type: 'medsi:chat-overlay',
  action: 'open',
  role: 'parent' | 'educator',
  phone: '...',
  session: { token: '...', expiresAt: 0 },
  parentName: '',
  childName: ''
}
```

GitHub -> Apps Script when overlay closes:

```js
{ type: 'medsi:chat-overlay', action: 'closed' }
```

Only test shell mode may intercept the existing Apps Script chat buttons. Production keeps `showChat()` / `showChats()` unchanged.

## Development order

1. Test shells + overlay lifecycle.
2. Parent thread read-only.
3. Parent text send + read state.
4. Parent reply/reaction/edit/delete.
5. Parent attachments.
6. Tutor chat lists + thread read-only.
7. Tutor text send + read/unread + pin.
8. Tutor reply/reaction/edit/delete.
9. Tutor attachments.
10. iPhone/Android/PWA testing.
11. Only after approval: publish test URLs.
12. Only after stable test period: move overlay into `/` and `/tutors`.
13. Disable old Apps Script chat navigation first; remove old chat UI only in a later cleanup release.

## Safety rules

- Do not rename or remove current `/lab/...` Worker routes.
- Do not change Cloudflare/D1 for the first overlay implementation unless a missing API is proven.
- Do not merge this branch to `main` without explicit approval.
- Never retry a write automatically through a second transport after an ambiguous network failure; that can duplicate messages.
- Keep existing Apps Script chat UI intact as rollback during testing.
