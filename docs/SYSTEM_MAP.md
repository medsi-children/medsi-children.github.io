# Карта системы «Медси Бот»

**Статус:** текущая production-архитектура, ветка `timeweb-next`.

Это основной вводный документ для нового инженера или агента. Он описывает то,
что работает сейчас, а не ранние планы миграции. Перед любым изменением всё
равно нужно сверять реальный код, текущую ветку и живые конфигурации.

## Коротко

У бота нет «одного сервера», потому что у частей системы разные сильные
стороны:

- **Google Sheets + Apps Script** — регистрация, родители и дети, отчёты,
  бизнес-правила;
- **Timeweb** — сайт, Node/Express gateway, сессии и S3-вложения;
- **Cloudflare** — быстрый чат: D1, Chat Worker и push;
- **GitHub** — исходный код и автодеплой Timeweb.

```text
Родитель / воспитатель
          │ https://медси-бот.рф
          ▼
Timeweb: Node/Express + статический интерфейс
  ├─ Apps Script: вход, регистрация, отчёты, профиль, chat-session
  ├─ /lab/* ───────────────► Cloudflare Chat Worker ─► D1
  ├─ /chat-upload ─────────► Timeweb S3
  └─ /push/* ──────────────► Cloudflare Push Worker ─► Web Push
                                      ▲
                                      └─ Chat Worker вызывает его после записи D1
```

## Что является источником истины

| Данные | Где хранится главный вариант | Кто читает/меняет |
|---|---|---|
| Родители, дети, статус доступа | лист `REPORTS` в Google Sheets | Apps Script |
| Утренние, вечерние и психологические отчёты | Google Sheets | Apps Script, панели Timeweb |
| История чата, реакции, прочтения, закрепления | Cloudflare D1 `medsi-chat-production` | Chat Worker через Timeweb gateway |
| Новые фото и видео чата | private Timeweb S3 | Timeweb выдаёт браузеру через `/media/s3/:key` |
| Push-подписки | Cloudflare KV Push Worker | Push Worker |
| Старый журнал чата | `CHAT_MESSAGES` в Sheets | legacy/rollback и аудит, **не** новый основной чат |

Важно: D1 — источник истины именно для современного чата. Таблица не должна
использоваться как тихий fallback при ошибке D1: иначе воспитатель может увидеть
push, но не найти сообщение в чате.

## Пользовательские маршруты

| URL | Назначение | Файл-вход |
|---|---|---|
| `/` | кабинет родителя | `index.html` → `parents/full-web.js` |
| `/tutors` | панель воспитателей | `tutors.html` → `tutors/full-web.js` |
| `/psychology` | психологические отчёты | `psychology.html` → `psychology/app.js` |
| `/__health` | безопасная проверка Timeweb/S3 | `server.js` |

`/lab/*` — историческое название, но это **живой production API**, а не тестовая
лаборатория. Его нельзя удалять при уборке репозитория.

## Нормальный путь сообщения

### Новое текстовое сообщение

```text
Интерфейс Timeweb
 → chat-overlay/transport.js
 → POST /lab/messages на том же домене
 → Timeweb proxy
 → Cloudflare Chat Worker
 → D1 INSERT
 → best-effort push через внутренний Push Worker
 → ответ браузеру
```

Сначала происходит запись в D1, потом инициируется push. Неудачный push не
отменяет уже сохранённое сообщение.

### Новое вложение

```text
Браузер → POST /chat-upload → проверка chat-session Timeweb
         → Timeweb S3 → fileId вида s3:<key>
         → POST /lab/messages → D1

Просмотр: браузер → /media/s3/<key>[?variant=preview] → S3
```

Для изображений `lib/media-previews.js` создаёт меньший WebP preview. Сначала
отображается preview, затем `chat-overlay/media-preload.js` тихо прогревает
полный файл для открытия по нажатию. В D1 всегда остаётся ссылка на оригинал
`s3:<key>`, а не на preview.

### Обновление открытого чата

Это polling, не WebSocket:

- родительский открытый чат — `parents/chat-screen.js`, раз в 5 секунд;
- список и открытый чат воспитателя — `tutors/live-chat-refresh.js`, раз в 5 секунд;
- при возвращении вкладки на передний план проверка запускается почти сразу;
- если человек читает старые сообщения, прокрутка сохраняется.

## GitHub и Timeweb

Репозиторий: `medsi-children/medsi-children.github.io`.

### Ветки и точки возврата

- `timeweb-next` — рабочая и автодеплой-ветка Timeweb.
- `main` — сохранённая аварийная Apps Script-версия. Не использовать для
  повседневной разработки и не менять без отдельного решения.
- Исторические состояния хранятся преимущественно тегами. Их смысл описан в
  `docs/GIT_MAP.md`.

Каждый commit в `timeweb-next` может запустить полный Docker build Timeweb,
включая изменения документации. Поэтому перед push нужно проверять состояние
Timeweb App Platform и не отправлять несколько мелких коммитов подряд во время
инцидента у провайдера.

### Timeweb gateway: `server.js`

`server.js` — единственный HTTP-вход Timeweb. Он:

- раздаёт три HTML-страницы и явно разрешённые статические папки;
- не публикует `docs/`, `archive/`, server-code и рабочие backup-файлы;
- проксирует `/lab/*` в Cloudflare Chat Worker;
- проксирует `/push/*` в Push Worker;
- принимает `/chat-upload`, проверяет chat-session и пишет вложения в S3;
- раздаёт S3 через `/media/s3/:key`, включая HTTP Range для видео;
- содержит закрытые служебные endpoints миграции и S3-purge;
- даёт health endpoint. `/__diag/network` — диагностика, не пользовательский API.

`lib/database.js` остался совместимостным слоем. В рабочей схеме PostgreSQL не
используется: режим — Cloudflare proxy.

### Активные frontend-модули

#### Родители

| Файл | Зона ответственности |
|---|---|
| `parents/full-web.js` / `.css` | вход, навигация, отчёты, запуск чата |
| `parents/chat-screen.js` / `.css` | DOM и поведение современного родительского чата |
| `parents/prewarm.js` | ранняя загрузка данных чата |
| `parents/push-gateway.js` | подключение родительских уведомлений |
| `parents/psychology-format.js` / `.css` | деление психологического отчёта на понятные блоки |
| `parents/dashboard-ui.css`, `chat-ui.css` | статический дизайн панели и чата |

#### Воспитатели

| Файл | Зона ответственности |
|---|---|
| `tutors/full-web.js` / `.css` | вход, меню, отчёты и телефоны родителей |
| `chat-overlay/educator-chat.js` | DOM и действия чата воспитателя |
| `chat-overlay/educator-new-chat.js` | запуск нового чата |
| `tutors/live-chat-refresh.js` | тихое фоновое обновление списка и треда |
| `tutors/chat-prewarm.js` | предварительная загрузка чатов |
| `tutors/chat-opening.js` | короткий spinner при открытии |
| `tutors/chat-context-menu.js` | меню действия с сообщением |
| `tutors/phone-cards-ui.*` | карточки телефонов и кнопки звонка/удаления |
| `tutors/report-ui.*` | цвета и layout форм отчётов |
| `tutors/push-auth.js`, `tutor-push-panel.js` | авторизация и интерфейс push |
| `tutors/page-scroll.js`, `layout-stability.*` | стабильность страницы при загрузке |

#### Общий чат

| Файл | Зона ответственности |
|---|---|
| `chat-overlay/transport.js` | единственный browser transport к Timeweb `/lab/*`, upload и S3 URL |
| `chat-overlay/session-client.js` | работа с краткоживущими chat sessions |
| `chat-overlay/bottom-lock.js` | удержание нижней границы при поздней загрузке медиа; менять крайне осторожно |
| `chat-overlay/composer-ui.*` | composer, SVG-кнопки, auto-grow, быстрые ответы |
| `chat-overlay/chat-list-ui.*` | единый список чатов воспитателя, поиск, каскад появления |
| `chat-overlay/message-enhancements.js` | reply UI, реакции, receipts и date separators |
| `chat-overlay/media-ui.css`, `upload-ux.js` | placeholder/shimmer и готовность медиа |
| `chat-overlay/media-preload.js` | предзагрузка полных изображений после preview |
| `chat-overlay/reaction-icons.js` | Twemoji только для реакций |
| `chat-overlay/menu-twemoji.js` | Twemoji только на карточках меню |
| `chat-overlay/gesture-navigation.js` | лёгкий свайп от левого края для архитектурного «назад» |
| `chat-overlay/chat-motion.js`, `chat-motion-ui.css` | небольшие анимации экранов/сообщений |
| `chat-overlay/chat-surface-ui.css` | общий градиентный фон чата |
| `chat-overlay/video-link.*` | отображение видео и ссылок |
| `chat-overlay/overlay-core.js`, `overlay.css` | базовый overlay-контейнер |

Принцип: один элемент — один владелец. Не возвращать цепочки `polish →
polish-v2 → experiment → MutationObserver`. Исторические эксперименты уже
убраны или лежат в `archive/`; актуальный UI описан в `docs/ARCHITECTURE.md`.

## Google Sheets и Apps Script

Apps Script — действующий серверный компонент для операций с Google Sheets,
доступом и данными отчётов. Его исходники, manifest и настройки не хранятся в
этом GitHub-репозитории. Перед изменениями сверяй и редактируй живой проект
непосредственно в Google Apps Script; не восстанавливай старые файлы из архива.

## Cloudflare

Cloudflare Workers — действующие компоненты чата и уведомлений. Их исходники и
конфигурация публикации удалены из GitHub; сверяй и меняй их непосредственно в
Cloudflare. В GitHub оставлены только SQL-файлы миграций D1 и минимальная
конфигурация, требуемые отдельным защищённым ручным workflow миграций.

Не публиковать секреты, идентификаторы Apps Script или данные таблицы в GitHub,
документы либо чат.

## Резервные копии и архивы

### В GitHub-репозитории: `archive/`

Это versioned архив, который Timeweb не раздаёт браузеру.

- `archive/github-ui-before-timeweb-2026-09-04/` — прежняя GitHub/Apps Script
  production оболочка;
- `archive/appscript-recovery-tools/` — recovery-инструменты Apps Script;
- `archive/ui-prototypes-before-production-2026-09/` — старые UI-прототипы;
- `archive/retired-production-assets-2026-09-07/` — снятые с активного пути
  assets, включая старый фон.

### Локально: `ARCHIVE/`

- `release-snapshots-2026-09/` — крупный снимок стабильной Sheets-era версии;
- `audit-snapshots-2026-09/` — узкие снимки перед миграцией/чисткой;
- `appscript-local-before-pull-2026-09-07/` — Apps Script до получения
  актуального проекта;
- `appscript-before-legacy-d1-bridge-2026-09-07/` — Apps Script перед
  compatibility bridge для старого текстового sender;
- `local-artifacts-2026-09-07/` — локальные служебные артефакты.

### Данные Cloudflare и S3

- SQL backup D1 хранится локально рядом с Chat Worker в `backups/`;
- исходные Drive/KV-вложения не удалять, пока их перенос в S3 не подтверждён;
- S3 purge выполняется через отдельную защищённую очередь Apps Script, чтобы
  удаление D1 не оставляло сиротские файлы.

## Безопасная работа нового агента

1. Проверить `git status`, текущий HEAD и ветку `timeweb-next`.
2. Не менять `main`, не применять `reset --hard`, `git clean` или force push.
3. Перед функциональным изменением создать понятный checkpoint/tag и проверить
   diff.
4. Не менять D1 schema, Worker contracts, S3 или Apps Script «заодно» при
   косметической UI-задаче.
5. Не удалять `/lab/*`, `bottom-lock.js`, `live-chat-refresh.js`, transport,
   prewarm-модули без проверки реального production пути.
6. Перед миграцией сначала dry-run/audit; импорт — только идемпотентный.
7. Не заявлять о готовности UI без ручной проверки владельцем на реальном
   устройстве.

## Быстрый старт для следующего агента

```text
Рабочий GitHub checkout:
  GITHUB/medsi-children.github.io

Исходники Apps Script и Cloudflare Workers проверяются непосредственно
в соответствующих сервисах; копий этих исходников в репозитории нет.

Продакшен:
  https://медси-бот.рф/
```

Сначала прочитать этот файл, затем `docs/ARCHITECTURE.md` (UI) и
`docs/GIT_MAP.md` (ветки/rollback).
