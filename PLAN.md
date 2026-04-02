# План развития: TMA + многопользовательский сервис

## Обзор

Развитие идёт в два больших этапа:

```
Этап 1 → MVP для одного владельца
         Покупатели бронируют через Telegram Mini App,
         владельцу приходит уведомление в Telegram кто забронировал.

Этап 2 → Многопользовательский сервис
         Каждый регистрирует свой магазин, управляет товарами из TMA,
         получает уведомления на свой Telegram-аккаунт.
```

---

## Этап 1 — MVP: TMA для покупателей + уведомления владельцу

Цель: минимальные изменения, максимальная ценность. Покупатели открывают магазин
прямо в Telegram и бронируют. Владелец получает сообщение в бот с деталями брони.

### 1.1 Настройка бота (BotFather)

1. `/newbot` — создать бота
2. `/newapp` — привязать URL магазина как Web App:
   `https://yourdomain.com/shop/<shopId>`
3. Получить `BOT_TOKEN` — нужен для отправки сообщений и верификации `initData`
4. Узнать свой `OWNER_CHAT_ID` — можно через `@userinfobot` или любой эхо-бот в env файле это `TELEGRAM_CHAT_ID`

Добавить в `.env`:
```
BOT_TOKEN=...
OWNER_CHAT_ID=...   # ваш личный Telegram chat_id
```

### 1.2 Исправить Security Headers (КРИТИЧНО)

В `src/middleware.ts` сейчас стоят заголовки, которые **ломают TMA**:

```
X-Frame-Options: DENY          ← Telegram открывает TMA в WebView, это заблокирует
frame-ancestors 'none'          ← то же самое в CSP
script-src 'self' ...           ← нужно добавить telegram.org для SDK
```

Что изменить — только для роутов `/shop/*`:
- `X-Frame-Options` → убрать
- `frame-ancestors 'none'` → `frame-ancestors https://web.telegram.org`
- `script-src` → добавить `https://telegram.org`
- `connect-src` → добавить `https://api.telegram.org`

Для `/admin` оставить строгие заголовки без изменений.

### 1.3 Подключить Telegram SDK

В `src/layouts/Layout.astro` добавить в `<head>`:

```html
<script src="https://telegram.org/js/telegram-web-app.js"></script>
```

После этого в клиентских скриптах доступен `window.Telegram.WebApp`.

### 1.4 Определение контекста TMA

Создать `src/lib/tma.ts`:

```ts
export function isTMA(): boolean {
  return typeof window !== 'undefined' &&
    !!window.Telegram?.WebApp?.initData;
}
```

Использовать в компонентах:
- Скрыть `<Header>` внутри TMA (есть нативная кнопка «назад»)
- Адаптировать цвета: `--tg-theme-bg-color`, `--tg-theme-text-color`, `--tg-theme-button-color`

### 1.5 Нативные кнопки Telegram (UX)

```js
const tg = window.Telegram.WebApp;
tg.MainButton.setText('Забронировать');
tg.MainButton.show();
tg.MainButton.onClick(() => { /* отправить форму брони */ });
```

`BackButton` — автоматически заменяет кнопку «назад» браузера.

### 1.6 Уведомление владельцу при бронировании

При создании брони на сервере (`POST /api/bookings`):

```ts
// Получить имя покупателя из initData (если пришёл из TMA)
// или из формы
const text = `Новая бронь в «${shop.name}»\n` +
             `Кто: ${buyerName} (@${telegramUsername})\n` +
             `Что: ${productName}\n` +
             `Дата: ${date}`;

await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: OWNER_CHAT_ID, text })
});
```

`OWNER_CHAT_ID` берётся из env — хардкод на одного владельца, всё просто.

### 1.7 Верификация покупателя через initData (опционально, но полезно)

Если покупатель открыл магазин через TMA, `initData` содержит его Telegram-профиль.
Верифицировать на сервере и подставлять имя/username автоматически — покупателю не нужно вводить контакты вручную.

API endpoint `POST /api/auth/telegram-init`:
1. Принять `initData` от клиента
2. Верифицировать HMAC-SHA256 через `BOT_TOKEN`
3. Вернуть `{ id, first_name, username }` — использовать при создании брони

### 1.8 Порядок реализации Этапа 1

```
[ ] Создать бота, получить BOT_TOKEN и OWNER_CHAT_ID, добавить в .env
[x] Исправить security headers в middleware (раздельно /shop/* и /admin/*)
[x] Добавить SDK в Layout.astro
[x] Реализовать isTMA(), адаптировать Header/Layout и цветовую тему
[x] Добавить MainButton / BackButton на странице магазина/брони
[x] При создании брони — отправлять sendMessage на OWNER_CHAT_ID
[ ] (опц.) Верификация initData → автозаполнение контактов покупателя
```

---

## Этап 2 — Многопользовательский сервис

Цель: любой человек регистрирует магазин, управляет товарами из Telegram,
получает уведомления о бронированиях на свой аккаунт.

Этап делится на три фазы.

---

### Фаза 2.1 — Система пользователей

#### Схема базы данных

```sql
-- Пользователи
CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT UNIQUE,
  display_name TEXT,
  telegram_id  TEXT UNIQUE,          -- для входа через TMA
  role         TEXT NOT NULL DEFAULT 'owner',  -- 'owner' | 'admin'
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Сессии (заменяет in-memory Set)
CREATE TABLE user_sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Привязка магазина к владельцу
ALTER TABLE shops ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Настройки уведомлений per-магазин
ALTER TABLE shops ADD COLUMN notify_email    TEXT;   -- NULL → берётся email из users
ALTER TABLE shops ADD COLUMN notify_channels TEXT NOT NULL DEFAULT '["telegram"]';
-- JSON-массив: '["telegram"]' | '["email"]' | '["telegram","email"]'
```

#### Обновить `auth.ts`

- Перенести сессии из памяти (`Set<string>`) в таблицу `user_sessions`
- Добавить `getUserFromRequest(req)` → `User | null`
- Разграничить роли: `admin` видит всё, `owner` — только свои магазины

#### Обновить middleware

```
/admin/*     → role = 'admin'
/dashboard/* → любой авторизованный
/tma/owner/* → любой авторизованный (сессия через Telegram initData)
/auth/*      → публично
```

---

### Фаза 2.2 — Passkey-аутентификация (WebAuthn) для веб

Веб-дашборд как запасной канал — для тех, кто предпочитает браузер.

#### Зависимости

```bash
npm install @simplewebauthn/server @simplewebauthn/browser
```

#### Схема БД

```sql
CREATE TABLE passkey_credentials (
  id          TEXT PRIMARY KEY,   -- base64url credentialID
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key  BLOB NOT NULL,
  counter     INTEGER NOT NULL DEFAULT 0,
  device_name TEXT,               -- «MacBook Touch ID», «iPhone»
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### Флоу регистрации

```
1. POST /api/auth/passkey/register/start
   → сервер генерирует challenge, сохраняет в сессии
   → возвращает PublicKeyCredentialCreationOptions

2. Браузер: navigator.credentials.create(options)
   → пользователь подтверждает биометрией / Touch ID / PIN

3. POST /api/auth/passkey/register/finish
   → сервер верифицирует через @simplewebauthn/server
   → создаёт passkey_credentials + user_sessions, устанавливает cookie
```

#### Флоу входа

```
1. POST /api/auth/passkey/login/start
   → ввод email → сервер ищет credentials, генерирует challenge

2. Браузер: navigator.credentials.get(options)

3. POST /api/auth/passkey/login/finish
   → верификация assertion + проверка counter (защита от replay)
   → создаёт сессию, устанавливает cookie
```

#### API endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/auth/passkey/register/start` | Начать регистрацию |
| POST | `/api/auth/passkey/register/finish` | Завершить, сохранить credential |
| POST | `/api/auth/passkey/login/start` | Начать вход |
| POST | `/api/auth/passkey/login/finish` | Завершить, создать сессию |
| POST | `/api/auth/logout` | Удалить сессию |

#### Требования к окружению

- Работает только на `https://` или `localhost`
- `rpID` = домен сайта (например `homelyst.com`)
- `rpName` = название сервиса

---

### Фаза 2.3 — Owner TMA и веб-дашборд

#### TMA-страницы для владельца

Вход: при открытии `/tma/owner` — верификация `initData`, поиск/создание пользователя по `telegram_id`.

| Путь | Описание |
|------|----------|
| `/tma/owner` | Список магазинов + кнопка «Создать магазин» |
| `/tma/owner/new` | Форма создания магазина |
| `/tma/owner/[shopId]` | Список товаров + кнопка «Добавить товар» |
| `/tma/owner/[shopId]/products/new` | Форма добавления товара (название, цена, фото) |
| `/tma/owner/[shopId]/products/[id]` | Редактирование / удаление товара |

Команда `/myshops` в боте открывает TMA:
```
BotFather → /setcommands → myshops - Управление моими магазинами
```

#### Веб-страницы (запасной канал)

| Путь | Описание |
|------|----------|
| `/register` | Регистрация: email + создание passkey |
| `/login` | Вход через passkey |
| `/dashboard` | Список своих магазинов |
| `/dashboard/[shopId]` | Управление магазином (товары, изображения) |
| `/dashboard/[shopId]/notifications` | Настройки уведомлений |

#### Настройки уведомлений per-магазин

Страница `/dashboard/[shopId]/notifications`:
- Email для уведомлений (по умолчанию — email аккаунта)
- Чекбоксы каналов: Telegram, Email (SMS — по мере готовности)

API:
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/shops/[shopId]/notifications` | Текущие настройки |
| PUT | `/api/shops/[shopId]/notifications` | Обновить настройки |

При создании брони сервер читает `notify_channels` магазина:
- `telegram` → `sendMessage` на `users.telegram_id` владельца
- `email` → письмо на `notify_email` (или `users.email`)

#### Обновить API магазинов

Все endpoint'ы в `/api/shops/*` и `/api/shops/[shopId]/products/*`:
- Убрать `ADMIN_PASSWORD`
- Заменить на `getUserFromRequest` + `shop.owner_id === user.id`

#### (Опционально) Модерация новых магазинов

```sql
ALTER TABLE shops ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
-- 'pending' | 'active' | 'suspended'
```

- Новые магазины создаются со статусом `pending`
- Публичные страницы показывают только `active`
- Admin одобряет/отклоняет из `/admin`

---

## Порядок реализации

**Этап 1 — MVP (сделать первым):**
```
[ ] Бот + BOT_TOKEN + OWNER_CHAT_ID в .env
[x] Security headers: раздельная политика /shop/* vs /admin/*
[x] Telegram SDK в Layout.astro
[x] isTMA(), адаптация Header/Layout, цветовая тема
[x] MainButton / BackButton на странице магазина
[x] sendMessage владельцу при бронировании
[ ] (опц.) Верификация initData покупателя → автозаполнение контактов
```

**Этап 2 — Мультипользователь:**
```
[ ] Фаза 2.1: Таблицы users, user_sessions; колонки owner_id, telegram_id; обновить auth.ts
[ ] Фаза 2.2: @simplewebauthn; 4 passkey endpoint'а; страницы /register и /login
[ ] Фаза 2.3: TMA-страницы /tma/owner/*; команда /myshops в боте
[ ] Фаза 2.3: Веб-дашборд /dashboard/*; обновить API магазинов
[ ] Фаза 2.3: Настройки уведомлений per-магазин; уведомления на telegram_id владельца
[ ] (опц.) Модерация: shops.status; обновить admin-панель
```

---

## Риски и митигация

| Риск | Митигация |
|------|-----------|
| Security headers ломают TMA | Раздельная политика: /shop/*, /tma/* — мягкие; /admin/* — строгие |
| WebAuthn требует HTTPS | SSL до деплоя; на localhost работает без него |
| Миграция существующих магазинов | `owner_id = NULL` → видны только admin'у |
| Браузеры без passkey | Fallback: magic link на email |
| Загрузка фото в TMA | `<input type="file">` работает в Telegram WebView |
| Глубокие ссылки на магазин | `t.me/botname/appname?startapp=shopId` |
