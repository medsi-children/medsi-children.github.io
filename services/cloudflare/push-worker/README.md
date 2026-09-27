# Medsi Push Worker

Маленький Cloudflare Worker для отправки Web Push уведомлений из AppScript.

## Что делает связка

1. GitHub-обертка показывает кнопку `Включить уведомления`.
2. iPhone/браузер выдает подписку на уведомления.
3. AppScript сохраняет подписку в лист `PUSH_SUBSCRIPTIONS`.
4. Когда появляется новое сообщение в чате, AppScript вызывает этот Worker.
5. Worker отправляет системное уведомление на устройство.

## Ручная настройка Cloudflare

1. Зарегистрируйтесь или войдите в Cloudflare: https://dash.cloudflare.com/
2. Откройте `Workers & Pages`.
3. Создавать Worker вручную в панели не обязательно, его создаст Wrangler при деплое.
4. В терминале перейдите в эту папку:

```bash
cd "/Users/ori.space.cat/Documents/Codex/Проекты/Медси Бот/medsi-push-worker"
```

5. Установите зависимости:

```bash
npm install
```

6. Войдите в Cloudflare:

```bash
npx wrangler login
```

Откроется браузер, там нужно разрешить Wrangler доступ к аккаунту.

7. Сгенерируйте VAPID-ключи:

```bash
npm run generate-vapid
```

Сохраните оба значения:

- `Public Key`
- `Private Key`

8. Придумайте длинный секрет для связи AppScript -> Worker, например 40-60 случайных символов.

9. Запишите секреты в Cloudflare:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put MEDSI_PUSH_SECRET
```

Каждая команда попросит вставить соответствующее значение.

10. В `wrangler.toml` замените:

```toml
VAPID_SUBJECT = "mailto:admin@example.com"
```

на вашу почту, например:

```toml
VAPID_SUBJECT = "mailto:you@example.com"
```

11. Задеплойте Worker:

```bash
npm run deploy
```

После деплоя Cloudflare покажет URL вида:

```text
https://medsi-push-worker.<ваш-subdomain>.workers.dev
```

## Что потом вставить в Медси Бот

1. В `medsi-children.github.io/notify-client.js` заменить:

```js
REPLACE_WITH_CLOUDFLARE_VAPID_PUBLIC_KEY
```

на `Public Key` из шага 7.

2. В AppScript Script Properties добавить:

```text
MEDSI_PUSH_WORKER_URL = https://medsi-push-worker.<ваш-subdomain>.workers.dev/send
MEDSI_PUSH_WORKER_SECRET = секрет из шага 8
```

3. После этого можно деплоить:

```bash
medsi-deploy
medsi-github
```

## Можно ли сделать через Codex

Да, если на этой машине есть доступ к терминалу и вы готовы один раз авторизовать Cloudflare в браузере.

Codex может:

- выполнить `npm install`;
- запустить `npx wrangler login`;
- подготовить секреты;
- запустить `npm run deploy`;
- вставить URL и публичный ключ в код;
- после вашей проверки выполнить `medsi-deploy` и `medsi-github`.

Вручную все равно нужно будет подтвердить вход Cloudflare в браузере и безопасно передать/ввести секретные значения.
