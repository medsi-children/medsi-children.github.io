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
в Google Apps Script. В `apps-script/medsi-bot/script-properties.example.json`
есть только названия требуемых настроек. Секреты, ID таблиц и учётные данные
нельзя записывать в GitHub.

## Что делает каждый workflow

- `verify.yml` — только проверки; не выпускает ничего.
- `release-apps-script.yml` — после прямого изменения Apps Script в
  `timeweb-next` и успешной проверки обновляет его существующее веб-приложение.
- `release-cloudflare-workers.yml` — после прямого изменения Worker в
  `timeweb-next` и успешной проверки выпускает только изменённый Worker.
- `deploy-cloudflare.yml` — единственный оставшийся workflow для production D1-миграций. Он запускается вручную, требует явного подтверждения и использует защищённое окружение `cloudflare-production` с обязательным reviewer.

Для автоматической публикации Apps Script нужны repository secrets
`APPS_SCRIPT_ID`, `CLASPRC_JSON` и environment secret
`APPS_SCRIPT_DEPLOYMENT_ID` в `apps-script-auto`. Для Workers нужны repository
secret `CLOUDFLARE_ACCOUNT_ID` и environment secret `CLOUDFLARE_API_TOKEN` в
`cloudflare-auto`. Секреты `cloudflare-production` нужны только для ручных
D1-миграций.

На момент настройки для `timeweb-next` не обнаружены branch protection rules или
repository rulesets: API вернул 404/пустой список. Автоматические workflow не
меняют эти правила и не включают auto-merge. Если нужна технически enforced
обязательная проверка и человеческий review, владелец должен настроить их в
Settings → Branches; CI `verify` сейчас запускается на PR, но не является
обязательным правилом merge.
