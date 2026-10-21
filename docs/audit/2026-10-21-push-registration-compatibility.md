# Проверка push и регистрации — 21.10.2026

## Push-подписки

Текущий `notify-client.js` отправляет регистрацию подписки в Push Worker на
`/subscribe`, а отключение — на `/unsubscribe`. `parents/push-gateway.js` и
`tutors/push-auth.js` переписывают этот запрос на same-origin `/push/*`;
Timeweb передаёт его Worker. Worker проверяет родительскую сессию или сессию
воспитателя и сохраняет подписку в Cloudflare KV `PUSH_SUBSCRIPTIONS`.
Уведомления Apps Script также отправляет Worker через `/notify`.

Пять методов Google Sheet-хранилища и помощник `normalizePushRole_` не входят в
Apps Script HTTP allowlist `getApiMethodMap_`; актуальные файлы интерфейса не
вызывают их через `action: api`. Дополнительная fire-and-forget отправка
`notify-client.js` в старый Apps Script URL имеет форму `{action: save|delete}`;
`doPost` её не маршрутизирует. Старые методы и одноимённый скрытый Google Sheet
поэтому не участвуют в рабочей регистрации/доставке push. Кроме них, старый
подписанный Apps Script payload builder и его вспомогательные функции не имеют
активных вызывающих мест. Все девять деклараций вынесены без изменения тел в
`archive/apps-script-legacy-push-subscriptions/`.
Рабочий Google Sheet `PUSH_SUBSCRIPTIONS` удалён после проверки полной резервной
копии книги, созданной перед предыдущей чисткой листов.

## Попытки регистрации

Действующая регистрация проходит через `services/cloudflare/chat-worker/src/index.js`:
Worker сохраняет профиль и попытку в D1 `parent_registration_attempts`, а также
создаёт outbox-запись. Apps Script проецирует outbox в `REPORTS`, подтверждает
обработку; периодическая сверка повторяет операцию при сбое браузера. Worker
читает эту таблицу для повторной регистрации/статуса, а lifecycle выписки и
переноса номера удаляет относящиеся к профилю попытки. Таблица Cloudflare D1
активна и сохранена.

Одноимённый Google Sheet имеет только историческую схему `ATTEMPT_ID`, `PHONE10`,
`STATUS`, `PARENT_NAME`, `CHILD_NAME`, `CREATED_AT`, `UPDATED_AT`. Ни один текущий
файл Apps Script, Worker или интерфейса не читает и не создаёт этот лист. Он
удалён из рабочей книги; содержимое остаётся в полной резервной копии.

## Однократный импорт старых заявок на доступ

`PARENT_ACCESS_REQUESTS` отличается от таблицы попыток регистрации. Активные
`requestParentReauthorization`, `getParentReauthorizationStatus` и плановая
D1-сверка вызывают `ensureLegacyParentAccessRequestsImported_`. Функция переносит
ещё действующие старые заявки в D1 `parent_access_requests` и ставит Script
Property `PARENT_ACCESS_D1_IMPORTED_AT`. Значение свойства в этой проверке не
читалось, поэтому Google Sheet сохранён. Удалять его можно только после
подтверждения завершённого импорта и сохранённой резервной копии.

## Проверка результата

Из рабочей книги удалены только два скрытых Google Sheets-листа: старый
`PUSH_SUBSCRIPTIONS` и неиспользуемый `PARENT_REGISTRATION_ATTEMPTS`. Лист
`PARENT_ACCESS_REQUESTS`, D1 `parent_registration_attempts`, D1
`parent_access_requests` и Cloudflare KV `PUSH_SUBSCRIPTIONS` сохранены.
После удаления повторно прочитаны метаданные рабочей книги: осталось 10 листов;
`PARENT_ACCESS_REQUESTS`, `REPORTS`, `NAME_VARIANTS` и остальные нужные листы
сохранили свои sheetId и границы. Полное тестирование и проверка опубликованного
bundle выполняются перед завершением этой пачки.
