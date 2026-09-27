# Релизы и секреты

## GitHub Secrets

Значения добавляются только в GitHub Secrets. Их нельзя отправлять в чат,
записывать в код, Issues, PR или Actions-логи.

| Secret | Использование |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | ручной релиз Cloudflare Worker |
| `CLOUDFLARE_API_TOKEN` | ограниченный токен только для нужных Worker, D1, KV и маршрута |
| `CLASPRC_JSON` | OAuth-конфигурация clasp для Apps Script |
| `APPS_SCRIPT_ID` | ID конкретного Apps Script-проекта |

## Script Properties

Перед первым выпуском Apps Script в свойствах скрипта должны быть заданы
значения из `apps-script/medsi-bot/script-properties.example.json`.
`MEDSI_SPREADSHEET_ID` и `MEDSI_CHAT_PUSH_SECRET` обязательны для новой
Git-версии. Логин и пароль воспитателей берутся только из Script Properties.

## Что делает каждый workflow

- `verify.yml` — только проверки; не выпускает ничего.
- `deploy-cloudflare.yml` — ручной выпуск одного выбранного Worker. При выборе
  D1-миграций применяет только новые миграции из `services/cloudflare/chat-worker/migrations`.
- `sync-apps-script.yml` — вручную обновляет исходники Apps Script, но не создаёт
  новую публикацию веб-приложения.

Перед любым production workflow требуется GitHub Environment с названием,
указанным в workflow, и обязательным ручным одобрением.
