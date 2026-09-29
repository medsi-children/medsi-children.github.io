# Релизы и секреты

## GitHub Secrets

Значения добавляются только в GitHub Secrets. Их нельзя отправлять в чат,
записывать в код, Issues, PR или Actions-логи.

| Secret | Использование |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | repository secret для автоматического выпуска Worker и ручного Cloudflare workflow |
| `CLOUDFLARE_API_TOKEN` | environment secret в `cloudflare-production` для ручного workflow; такой же ограниченный токен нужно добавить в `cloudflare-auto` для автоматического выпуска Worker |
| `CLASPRC_JSON` | repository secret с OAuth-конфигурацией clasp для Apps Script |
| `APPS_SCRIPT_ID` | repository secret с ID конкретного Apps Script-проекта |
| `APPS_SCRIPT_DEPLOYMENT_ID` | environment secret `apps-script-auto`; ID существующего веб deployment, который должен обновляться с сохранением URL |

## Script Properties

Перед первым выпуском Apps Script в свойствах скрипта должны быть заданы
значения из `apps-script/medsi-bot/script-properties.example.json`.
`MEDSI_SPREADSHEET_ID` и `MEDSI_CHAT_PUSH_SECRET` обязательны для новой
Git-версии. Логин и пароль воспитателей берутся только из Script Properties.

## Что делает каждый workflow

- `verify.yml` — только проверки; не выпускает ничего.
- `release-cloudflare-workers.yml` — после успешных проверок и merge PR в
  `timeweb-next` повторяет `npm run verify`, затем автоматически выпускает только
  затронутый Worker. Если PR содержит изменение D1 migrations, выпуск
  `chat-worker` пропускается.
- `deploy-cloudflare.yml` — ручной workflow в `cloudflare-production`; он сохраняет
  protected reviewer gate и остаётся единственным workflow для применения новых
  D1 migrations из `services/cloudflare/chat-worker/migrations`.
- `release-apps-script.yml` — после успешных проверок и merge PR с изменениями
  `apps-script/medsi-bot/` делает `clasp push`, затем обновляет существующий
  deployment через `clasp create-deployment --deploymentId ...`. В `@google/clasp`
  `3.3.0` эта команда принимает deployment ID для redeploy и сохраняет URL.
- `sync-apps-script.yml` — ручная синхронизация исходников без выпуска веб-приложения.

`cloudflare-auto` и `apps-script-auto` не требуют ручного reviewer и ограничены
веткой `timeweb-next`. `cloudflare-production` и `apps-script-production`
сохраняют существующее требование ручного одобрения для соответствующих ручных
workflow.

Перед первым автоматическим Cloudflare выпуском добавьте `CLOUDFLARE_API_TOKEN`
в Environment `cloudflare-auto`. Существующий токен в `cloudflare-production`
невозможно скопировать через GitHub API: секреты можно записывать, но нельзя
читать обратно.

Перед первым автоматическим Apps Script выпуском добавьте
`APPS_SCRIPT_DEPLOYMENT_ID` как secret Environment `apps-script-auto`. Это ID
существующего веб deployment, а не Script ID. Не передавайте его в Issues, PR,
код или логи. `CLASPRC_JSON` и `APPS_SCRIPT_ID` уже существуют как repository
secrets и остаются там.

На момент настройки для `timeweb-next` не обнаружены branch protection rules или
repository rulesets: API вернул 404/пустой список. Автоматические workflow не
меняют эти правила и не включают auto-merge. Если нужна технически enforced
обязательная проверка и человеческий review, владелец должен настроить их в
Settings → Branches; CI `verify` сейчас запускается на PR, но не является
обязательным правилом merge.
