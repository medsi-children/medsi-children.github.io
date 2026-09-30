# Облачный контур Медси Бота

## Назначение компонентов

| Компонент | Где работает | За что отвечает |
| --- | --- | --- |
| Веб-интерфейс и gateway | Timeweb | Панели родителей, воспитателей и психологов; статические файлы, проксирование и S3-медиа |
| `medsi-chat-worker` | Cloudflare Worker + D1 + KV | Чаты, вложения, сессии D1, снапшоты и фоновые задачи |
| `medsi-chat-gateway` | Cloudflare Worker | Узкий service-binding прокси к основному чат-Worker |
| `medsi-push-worker` | Cloudflare Worker + KV | Web Push-подписки и уведомления |
| Apps Script и Google Sheets | Google | Распределение отчётов, таблица, авторизация и фоновая синхронизация с Cloudflare |

## Где находятся исходники

GitHub содержит исходники сайта Timeweb, Apps Script и Cloudflare Workers и
является их единственным источником. Apps Script находится в
`apps-script/medsi-bot/`, Workers — в `services/cloudflare/`. Изменения в
Google Apps Script или Cloudflare Dashboard не считаются правкой исходного
кода и должны быть сначала перенесены в GitHub.

Не печатай секреты, токены, Script ID, deployment ID, данные таблиц или
персональные данные в логи, коммиты и отчёты.

## Публикация

1. Push в `timeweb-next` запускает Timeweb webhook и штатную GitHub Pages
   публикацию сайта. Проверки исходников запускаются через `verify.yml`.
2. Изменение `apps-script/medsi-bot/` после `npm run verify` автоматически
   обновляет существующее веб-приложение Apps Script. Его URL сохраняется.
3. Изменение исходников одного Worker после `npm run verify` автоматически
   публикует только этот Worker. Параллельные публикации блокируются.
4. D1 migrations остаются отдельной ручной операцией через `deploy-cloudflare.yml`
   в защищённом окружении `cloudflare-production`; для запуска нужны явное
   подтверждение и reviewer.

GitHub Actions не создают новые Apps Script deployment и не применяют
D1-миграции автоматически. Секреты находятся только в GitHub Environments и
в настройках Cloudflare.
