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

GitHub содержит исходники сайта Timeweb и историю D1-миграций. Исходники
Apps Script хранятся в Google Apps Script, а код Workers — в Cloudflare.
Репозиторий намеренно не содержит их копий: изменения в сервисах не отражаются
в GitHub автоматически, и файлы репозитория не являются источником кода для
этих сервисов.

Не печатай секреты, токены, Script ID, deployment ID, данные таблиц или
персональные данные в логи, коммиты и отчёты.

## Публикация

1. Push в `timeweb-next` запускает Timeweb webhook и штатную GitHub Pages
   публикацию сайта. Проверки исходников запускаются через `verify.yml`.
2. Apps Script редактируется и публикуется непосредственно в Google или через
   авторизованный локальный `clasp`. Копии его кода в GitHub нет.
3. Cloudflare Workers редактируются и публикуются непосредственно через
   Cloudflare Dashboard или Wrangler. Копии их кода в GitHub нет.
4. D1 migrations остаются отдельной ручной операцией через `deploy-cloudflare.yml`
   в защищённом окружении `cloudflare-production`; для запуска нужны явное
   подтверждение и reviewer.

GitHub Actions не синхронизируют и не публикуют Apps Script или Worker-код.
Cloudflare secrets, необходимые для ручных D1-миграций, нужно сохранить.
