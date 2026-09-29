# Релизы и секреты

## GitHub Secrets

Значения добавляются только в GitHub Secrets. Их нельзя отправлять в чат,
записывать в код, Issues, PR или Actions-логи.

| Secret | Использование |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | repository secret для ручного workflow применения D1-миграций |
| `CLOUDFLARE_API_TOKEN` | environment secret в `cloudflare-production` для ручного workflow применения D1-миграций |

## Script Properties

В свойствах активного Apps Script должны быть заданы
значения из `apps-script/medsi-bot/script-properties.example.json`.
`MEDSI_SPREADSHEET_ID` и `MEDSI_CHAT_PUSH_SECRET` обязательны для активного
серверного проекта. Логин и пароль воспитателей берутся только из Script
Properties.

## Что делает каждый workflow

- `verify.yml` — только проверки; не выпускает ничего.
- `deploy-cloudflare.yml` — единственный оставшийся workflow для production D1-миграций. Он запускается вручную, требует явного подтверждения и использует защищённое окружение `cloudflare-production` с обязательным reviewer.
- Публикаций Apps Script и Worker-кода из GitHub Actions больше нет. Их нужно редактировать и публиковать напрямую в соответствующей платформе. При необходимости обновляй GitHub-копию отдельно после сверки с опубликованным кодом.

Секреты Apps Script и токен окружения `cloudflare-auto`, если они ранее были
созданы, больше не используются этими GitHub Actions. Они могут быть удалены
владельцем отдельно в настройках GitHub. Секреты `cloudflare-production`
сохранены для ручных D1-миграций.

На момент настройки для `timeweb-next` не обнаружены branch protection rules или
repository rulesets: API вернул 404/пустой список. Автоматические workflow не
меняют эти правила и не включают auto-merge. Если нужна технически enforced
обязательная проверка и человеческий review, владелец должен настроить их в
Settings → Branches; CI `verify` сейчас запускается на PR, но не является
обязательным правилом merge.
