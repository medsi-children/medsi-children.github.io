# Релизы и секреты

## GitHub Secrets

Значения добавляются только в GitHub Secrets. Их нельзя отправлять в чат,
записывать в код, Issues, PR или Actions-логи.

| Secret | Использование |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | repository secret для ручного workflow применения D1-миграций |
| `CLOUDFLARE_API_TOKEN` | environment secret в `cloudflare-production` для ручного workflow применения D1-миграций |

## Script Properties

Настройки и Script Properties активного Apps Script проверяются непосредственно
в Google Apps Script. Примеров его конфигурации в этом репозитории нет; секреты,
ID таблиц и учётные данные нельзя записывать в GitHub.

## Что делает каждый workflow

- `verify.yml` — только проверки; не выпускает ничего.
- `deploy-cloudflare.yml` — единственный оставшийся workflow для production D1-миграций. Он запускается вручную, требует явного подтверждения и использует защищённое окружение `cloudflare-production` с обязательным reviewer.
- Публикаций и копий Apps Script и Worker-кода в GitHub нет. Их нужно редактировать и публиковать непосредственно в соответствующей платформе.

Секреты Apps Script и токен окружения `cloudflare-auto`, если они ранее были
созданы, не используются оставшимися GitHub Actions. Секреты `cloudflare-production`
нужны для ручных D1-миграций.

На момент настройки для `timeweb-next` не обнаружены branch protection rules или
repository rulesets: API вернул 404/пустой список. Автоматические workflow не
меняют эти правила и не включают auto-merge. Если нужна технически enforced
обязательная проверка и человеческий review, владелец должен настроить их в
Settings → Branches; CI `verify` сейчас запускается на PR, но не является
обязательным правилом merge.
