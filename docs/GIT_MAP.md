# Карта веток и точек отката

## Две рабочие ветки

- `main` — аварийная стабильная версия на прежнем Apps Script. Это не ветка для
  разработки и не источник Timeweb-сайта.
- `timeweb-next` — текущая версия сайта на Timeweb и ветка автодеплоя.

Название `timeweb-next` пока сохранено как техническая привязка Timeweb. Его
переименование возможно только вместе с изменением настройки автодеплоя.

## Исторические теги

- `emergency-appscript-rollback` — сохранённая аварийная Apps Script-версия.
- `before-timeweb-migration` — состояние до переноса сайта на Timeweb.
- `legacy-overlay-prototype` — ранний прототип чатового overlay.
- `legacy-cloudflare-ui` — ранняя Cloudflare UI-версия.
- `legacy-chat-list-experiment` — независимый эксперимент списка чатов.
- `legacy-github-frontend` — ранняя независимая GitHub frontend-версия.
- `before-new-chat-ui` — состояние до нового интерфейса чатов.

Технические ветки вида `pre-*` создавались только как краткие checkpoint’ы.
После появления тегов они удалены: их коммиты остаются в истории `timeweb-next`.
