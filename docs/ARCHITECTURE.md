# Медси Бот — актуальная архитектура интерфейса

Этот файл описывает живую production-структуру `timeweb-next` и план консолидации UI. Его цель — не допустить ситуации, когда новый интерфейс собирается из нескольких конфликтующих слоёв и старый layout кратко появляется до поздних исправлений.

## Принцип

Один визуальный или поведенческий элемент должен иметь одного владельца.

Нормально:
- transport отдельно;
- live refresh отдельно;
- scroll/bottom lock отдельно;
- reactions отдельно;
- gestures отдельно;
- renderer родительского чата отдельно;
- renderer воспитательского чата отдельно.

Ненормально:
- базовый старый renderer создаёт один layout;
- `polish` меняет его;
- `polish-v2` меняет ещё раз;
- `experiment` переставляет DOM;
- поздний MutationObserver исправляет подписи и размеры.

## Production entry points

- `index.html` — родительская панель.
- `tutors.html` — панель воспитателей.
- `psychology.html` — психологическая панель.
- `server.js` — Timeweb gateway/server.

## Родительская панель

Основная логика:
- `parents/full-web.js` — навигация, авторизация, отчёты, запуск чата.
- `parents/chat-screen.js` — renderer и логика родительского чата.
- `parents/prewarm.js` — прогрев данных чата.
- `parents/psychology-format.js` — форматирование психологических отчётов.

Основные стили:
- `parents/full-web.css` — базовый layout панели.
- `parents/chat-screen.css` — базовый layout чата.
- `parents/dashboard-ui.css` — статический layout главной панели и отчётов.
- `parents/chat-ui.css` — статический layout родительского чата.

## Панель воспитателей

Основная логика:
- `tutors-app/full-web.js` — основная панель, отчёты, телефоны.
- `chat-overlay/educator-chat.js` — renderer чатов воспитателей.
- `chat-overlay/educator-new-chat.js` — новый чат.
- `tutors-app/chat-prewarm.js` — прогрев.
- `tutors-app/live-chat-refresh.js` — live refresh.

Основные стили:
- `tutors-app/full-web.css` — базовый layout панели.
- `chat-overlay/educator-exact.css` — базовый layout чатов.
- `tutors-app/dashboard-ui.css` — статический layout главной панели.
- `tutors-app/chat-ui.css` — статический layout чата воспитателя.
- `tutors-app/report-ui.css` — статичные цвета формы отчёта и плашки дат.

Поддерживающая логика:
- `tutors-app/chat-opening.js` — delayed spinner открытия чата.
- `tutors-app/chat-context-menu.js` — позиционирование меню сообщения.
- `tutors-app/page-scroll.js` — безопасный initial/page-show scroll reset.
- `tutors-app/tutor-push-panel.js` — lifecycle push-панели.

## Общие самостоятельные модули, которые можно оставлять отдельными

- `chat-overlay/transport.js` — транспорт чатов.
- `chat-overlay/bottom-lock.js` — поведение прокрутки/нижней позиции.
- `chat-overlay/reaction-icons.js` — визуал реакций.
- `chat-overlay/menu-twemoji.js` — Twemoji только для карточек меню.
- `chat-overlay/message-enhancements.js` — метаданные сообщения: время, receipts, date separators, reply UI. После стабилизации нужно проверить, какие части можно перенести непосредственно в renderers.
- `chat-overlay/media-ui.css` и `upload-ux.js` — placeholder и готовность фото/видео.
- `chat-overlay/chat-motion-ui.css` и `chat-motion.js` — анимации появления экранов и сообщений.
- `chat-overlay/chat-surface-ui.css` — общий статичный фон чатов.
- `chat-overlay/gesture-navigation.js` — фиксированная иерархия свайпов.
- `chat-overlay/video-link.js` / `video-link-preview.js` — видео/ссылки.

## Временные / накопившиеся UI-слои, которые нужно поглотить

Приоритет консолидации:

1. Composer
   - production-владельцы: `chat-overlay/composer-ui.css` и `chat-overlay/composer-ui.js`;
   - прежний `composer-experiment.js` удалён после ручной проверки.

2. Текст и время сообщений
   - renderer родителя `parents/chat-screen.js` сразу выводит только время;
   - placeholder’ы задаются в `index.html` и `educator-chat.js`;
   - прежний поздний `chat-copy-polish.js` удалён после ручной проверки.

3. Список чатов воспитателей
   - production-владельцы: `chat-overlay/chat-list-ui.css` и `chat-overlay/chat-list-ui.js`;
   - renderer `educator-chat.js` явно инициализирует этот модуль после создания DOM;
   - прежние `chat-list-experiment.js` и `chat-list-cascade.js` удалены после ручной проверки.

4. Другие исторические fix-файлы
   - не удалять по названию;
   - сначала проверить, какие функции реально используются production;
   - затем распределить их по функциональным владельцам.

## Legacy / rollback

- `backups/` не участвует в production, если явно не подключён.
- `appscript_test/` содержит исторические/аварийные веб-страницы Apps Script и не должен использоваться как источник production UI.
- Старые Apps Script страницы имеет смысл сохранить как аварийный rollback, но позднее перенести в явно названный legacy-раздел.

## Безопасный порядок консолидации

Для каждого модуля:

1. Сверить актуальный HEAD `timeweb-next`.
2. Создать checkpoint-branch.
3. Определить текущего базового владельца DOM/стилей.
4. Перенести только один законченный кусок поведения.
5. Отключить старый поздний слой для этого куска.
6. Проверить родителей и воспитателей на телефоне.
7. Только после проверки удалить ставший мёртвым код.

Никаких массовых удалений и переписывания всего UI одним коммитом.

## Целевое состояние

В идеале новый интерфейс должен существовать сразу в базовом DOM/CSS и не зависеть от того, успел ли поздний скрипт выполнить MutationObserver, переставить элемент или поменять текст. Отдельными остаются только реально самостоятельные функциональные модули.
