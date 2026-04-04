# План развития: многопользовательский сервис

Этап 1 (TMA + уведомления владельцу) — **выполнен**.

---

## Этап 2 — Многопользовательский сервис

Цель: любой человек регистрирует магазин, управляет товарами из Telegram или браузера,
получает уведомления о бронированиях на свой аккаунт.

---

### Фаза 2.0 — Security hardening (до начала multi-user)

Фиксы текущих проблем безопасности, которые станут критичными при появлении нескольких пользователей.

#### 2.0.1 Cookie security

```diff
- admin_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400
+ admin_token=${token}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=86400
```

- Добавить флаг `Secure` (cookie только по HTTPS; на localhost браузер игнорирует флаг).
- `SameSite=Lax` оставить — `Strict` ломает переходы из Telegram deep links.

#### 2.0.2 CSRF-защита

Для всех мутирующих запросов (POST/PUT/DELETE) из форм и fetch:

- Генерировать `csrf_token` при создании сессии, хранить в `user_sessions`.
- Передавать токен в HTML через `<meta name="csrf-token">`.
- Клиент шлёт его в заголовке `X-CSRF-Token`.
- Сервер проверяет совпадение **до** обработки запроса.

**TMA-сессии тоже нуждаются в CSRF.**
InitData сам по себе одноразовый, но после валидации initData создаётся сессия в cookie (фаза 2.1, TTL 1 час).
С этого момента cookie-сессия уязвима к CSRF.
Варианты:
- a) TMA-запросы используют `Authorization: Bearer <token>` вместо cookie → CSRF невозможен.
- b) CSRF-токен и для TMA-сессий наравне с веб-сессиями.

Рекомендация: вариант (a) — проще и надёжнее.

#### 2.0.3 Redirect validation

Заменить строковые проверки на `URL` constructor:

```typescript
function safeRedirect(raw: string, fallback = '/admin'): string {
  try {
    const url = new URL(raw, 'http://localhost');
    return url.origin === 'http://localhost' ? url.pathname : fallback;
  } catch {
    return fallback;
  }
}
```

#### 2.0.4 Rate limiter — доверять только proxy IP

```typescript
// Только если запрос от доверенного reverse proxy
function getClientIp(request: Request): string {
  const real = request.headers.get('x-real-ip');
  if (real) return real; // nginx/caddy проставляет реальный IP
  return 'unknown';
}
```

- Убрать fallback `return true` для `ip === 'unknown'` — вместо этого возвращать `false` (блокировать).
- `x-forwarded-for` не использовать — легко подделать.
- **Dev-mode:** на localhost `x-real-ip` отсутствует → все запросы `unknown` → заблокированы.
  Добавить переменную `TRUST_LOCAL=true` (только в dev): если нет proxy-заголовков и `TRUST_LOCAL`, использовать `127.0.0.1`.

#### 2.0.5 Input validation middleware

Добавить общий валидатор для URL-параметров:

```typescript
// shopId: только [a-z0-9-], 1-50 символов
// productId: только цифры
function validateParams(params: Record<string, string>): boolean;
```

Применять **до** обращения к БД во всех endpoint'ах.

**Зарезервированные slug'и магазинов:**
При создании магазина slug не должен совпадать с маршрутами приложения.
Список запрещённых: `admin`, `api`, `tma`, `dashboard`, `login`, `register`, `auth`, `shop`, `public`, `assets`, `favicon.ico`.
Проверять при `POST /api/shops` — возвращать 400 с понятным сообщением.
Хранить список в константе `RESERVED_SLUGS` для централизованного обновления.

#### 2.0.6 File upload: валидация ДО записи — ✅ уже исправлено

~~Текущий порядок: `writeFile → checkMagicBytes`.~~

В `src/pages/api/shops/[shopId]/products/index.ts` порядок уже правильный:
`arrayBuffer → isValidImageMagicBytes → writeFile`. Пункт закрыт.

#### 2.0.7 CSP nonce вместо `unsafe-inline`

- Генерировать `nonce` per-request в middleware.
- Передавать в Layout.astro, прописывать в `<script nonce="...">`.
- CSP: `script-src 'self' 'nonce-{value}'` вместо `'unsafe-inline'`.

#### 2.0.8 Rate limiter — очистка памяти

`rateLimit.ts` хранит записи в `Map` бессрочно (удаляет только при повторном запросе с того же ключа).
При длительной работе — утечка памяти.

Добавить периодический sweep:

```typescript
setInterval(() => {
  const now = Date.now();
  for (const [, store] of stores) {
    for (const [key, record] of store) {
      if (record.resetAt < now) store.delete(key);
    }
  }
}, 60_000); // каждую минуту
```

#### 2.0.9 Очистка файлов при удалении товара/магазина

`deleteProduct()` и `deleteShop()` удаляют записи из БД (CASCADE), но файлы
в `/uploads/shopId/productId/` остаются на диске → неограниченный рост хранилища.

- При удалении товара: `rm -rf /uploads/{shopId}/{productId}/`.
- При удалении магазина: `rm -rf /uploads/{shopId}/`.
- Выполнять **после** успешного DELETE в БД (если удаление файлов упадёт — не критично,
  данные в БД уже консистентны; orphan-файлы можно подчистить позже).
- Для безопасности: проверять resolved path перед `rm` (как в uploads endpoint).

#### 2.0.10 Лимиты на сущности (anti-abuse)

Без лимитов злоумышленник может создать тысячи магазинов или товаров:

| Сущность | Лимит | Действие |
|----------|-------|----------|
| Магазины на пользователя | 10 | 400 при превышении |
| Товары на магазин | 200 | 400 при превышении |
| Общий размер запроса | 100 MB | 413 Payload Too Large |

Проверять при `POST /api/shops` и `POST /api/shops/[shopId]/products`.
Общий размер запроса — на уровне middleware или reverse proxy (nginx `client_max_body_size`).

#### 2.0.11 Health-check endpoint

`GET /api/health` — возвращает `{ status: 'ok', timestamp }`.
Проверяет доступность SQLite (`SELECT 1`). Нужен для Docker healthcheck и мониторинга.

```yaml
# compose.yml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:4321/api/health"]
  interval: 30s
  timeout: 5s
  retries: 3
```

#### 2.0.12 Graceful shutdown

Docker отправляет `SIGTERM` при остановке. Без обработки — обрыв pending-запросов
и возможная потеря данных WAL.

```typescript
process.on('SIGTERM', () => {
  db.close();        // корректно закрыть SQLite (flush WAL)
  process.exit(0);
});
```

#### 2.0.13 Периодическая экспирация бронирований

Авто-экспирация 24ч работает лениво — только при вызове `getProducts()` или `reserveProduct()`.
Если никто не заходит в магазин — бронь висит в статусе `reserved` бесконечно.

Добавить `setInterval` sweep (каждые 5 мин):
```typescript
setInterval(() => {
  db.run(`
    UPDATE products SET status = 'available', reserved_by = NULL, reserved_at = NULL
    WHERE status = 'reserved' AND confirmed = 0
      AND reserved_at < unixepoch() - 86400
  `);
}, 5 * 60_000);
```

Это гарантирует своевременное освобождение товаров и корректность данных для уведомлений.

#### 2.0.14 Аудит-лог (минимальный)

Логировать в stdout (Docker собирает):
- Неудачные попытки входа (IP, timestamp)
- Создание/удаление магазинов и товаров (user_id, action, target)
- Подозрительные события (невалидный initData, path traversal attempt)

Формат: JSON, одна строка на событие — удобно парсить.

#### 2.0.15 Периодическая очистка expired-сессий

`cleanExpiredSessions()` вызывается только при `createToken()` (т.е. при каждом логине).
Если логинов мало — expired-записи копятся в таблице `sessions`.

Добавить `setInterval` sweep (каждые 30 мин):
```typescript
setInterval(() => {
  cleanExpiredSessions();
}, 30 * 60_000);
```

Или совместить с rate-limiter sweep (2.0.8).

#### 2.0.16 Привязка сессии к IP

Сейчас украденный токен работает с любого устройства до истечения TTL.
Привязка к IP клиента снизит риск session hijacking:

- Добавить колонку `ip TEXT` в таблицу `sessions`.
- При создании сессии записывать IP.
- При проверке (`hasSession`) сравнивать текущий IP с сохранённым.
- Учесть: пользователи за NAT/VPN могут менять IP — рассмотреть мягкий режим
  (предупреждение вместо инвалидации) или привязку к `User-Agent` как fallback.

---

### Фаза 2.1 — Система пользователей

#### Система миграций БД

Текущая схема создаётся через `CREATE TABLE IF NOT EXISTS` в `db.ts`.
Для production с данными нужна система миграций:

```
src/lib/migrations/
  001_initial.sql          — текущая схема (для фиксации baseline)
  002_users_sessions.sql   — таблицы users, user_sessions
  003_shop_owner.sql       — owner_id, notify_*, status
  004_magic_links.sql      — magic_links
```

Таблица `_migrations` отслеживает применённые файлы:

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  id         INTEGER PRIMARY KEY,
  filename   TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

При старте приложения — прогнать непримменённые миграции в транзакции.
При ошибке — rollback + не запускать сервер.

**Ограничение SQLite:** некоторые DDL-операции (ALTER TABLE) могут авто-коммитить
и не откатываются в транзакции. Стратегия:
- Перед запуском миграций — копировать файл БД (`cp db.sqlite db.sqlite.bak`).
- При ошибке — восстановить из бекапа.
- Каждая миграция запускается как отдельная транзакция (не все в одной).

#### Схема: users

```sql
CREATE TABLE users (
  id           TEXT PRIMARY KEY,        -- nanoid или uuid
  email        TEXT UNIQUE,             -- NULL если вошёл только через TMA
  display_name TEXT,
  telegram_id  TEXT UNIQUE,             -- NULL если вошёл только через magic link
  role         TEXT NOT NULL DEFAULT 'owner',  -- 'owner' | 'admin'
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Важно:** у пользователя может быть **только email**, **только telegram_id**, или **оба**.
Минимум одно из двух обязательно при создании.

**Нормализация email:** всегда хранить в нижнем регистре (`LOWER(email)`).
`User@Gmail.com` и `user@gmail.com` — один и тот же аккаунт.
Применять `LOWER()` при INSERT и при поиске.

#### Схема: user_sessions

```sql
CREATE TABLE user_sessions (
  token_hash  TEXT PRIMARY KEY,         -- SHA-256 от токена
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token  TEXT NOT NULL,            -- для CSRF-защиты (см. 2.0.2)
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);
```

- Токен: 32 байта crypto random → hex (64 символа).
- В БД хранится **SHA-256 хеш** токена (не сам токен).
- В cookie — сам токен.
- TTL: 7 дней; продление при активности (sliding window).
- Очистка expired: при каждом `getUserFromRequest` удалять просроченные для данного user.
- «Выйти со всех устройств»: `DELETE FROM user_sessions WHERE user_id = ?`.
- **Max concurrent sessions:** ≤ 10 на пользователя. При создании 11-й → удалить самую старую.
  Предотвращает абьюз и ограничивает поверхность атаки при утечке токенов.

#### Привязка магазинов к владельцу

```sql
ALTER TABLE shops ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE shops ADD COLUMN notify_email    TEXT;
ALTER TABLE shops ADD COLUMN notify_channels TEXT NOT NULL DEFAULT '["telegram"]';
ALTER TABLE shops ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
-- 'pending' | 'active' | 'suspended'
```

Миграция существующих данных:
- Существующие магазины → `owner_id = NULL`, `status = 'active'`.
- Магазины с `owner_id = NULL` видны только admin'у (legacy).
- Admin может назначить владельца через `/admin`.

#### Bootstrap первого admin'а

После удаления `ADMIN_PASSWORD` нужен механизм создания первого пользователя с `role = 'admin'`.

Варианты:
- **(рекомендуемый)** Env var `SEED_ADMIN_TELEGRAM_ID` / `SEED_ADMIN_EMAIL` — при старте, если таблица `users` пуста, создать admin'а. Переменная нужна **только** для первого запуска.
- CLI-команда: `bun run seed-admin --email admin@example.com`.
- Первый зарегистрированный пользователь автоматически становится admin'ом (опасно в production).

Реализовать в миграции или в `db.ts` init-блоке.

#### Обновить `auth.ts`

- Убрать `ADMIN_PASSWORD` и in-memory `Set<string>`.
- `createSession(userId)` → генерирует токен, хеширует, пишет в `user_sessions`, возвращает raw token.
- `getUserFromRequest(req)` → читает cookie → хеширует → ищет в `user_sessions` → проверяет `expires_at` → возвращает `User | null`.
- `requireUser(req)` → как `getUserFromRequest`, но кидает 401.
- `requireOwner(req, shopId)` → `requireUser` + проверка `shop.owner_id === user.id` (или `user.role === 'admin'`).
- `destroySession(tokenHash)` → удалить одну сессию.
- `destroyAllSessions(userId)` → удалить все сессии пользователя.

#### Обновить middleware

```
/admin/*           → requireUser + role === 'admin'
/dashboard/*       → requireUser (любой авторизованный)
/tma/owner/*       → авторизация через initData (см. 2.1 TMA auth)
/api/shops/* (mut) → requireOwner(req, shopId) или admin
/api/auth/*        → публично
/shop/*            → публично
/                  → публично
```

Для API-ответов middleware возвращает `401 JSON` (не редирект).
Для HTML-страниц — редирект на `/login?redirect=...`.

#### Авторизация через TMA (initData)

При запросе к `/tma/owner/*`:

1. Клиент шлёт `initData` строку в заголовке `X-Telegram-Init-Data`.
2. Сервер валидирует HMAC-SHA256:
   ```
   secret = HMAC-SHA256("WebAppData", BOT_TOKEN)
   hash   = HMAC-SHA256(secret, data_check_string)
   ```
3. Проверяет `auth_date` — не старше 300 секунд.
4. Извлекает `user.id` → ищет/создаёт запись в `users` по `telegram_id`.
   **Race condition:** два параллельных запроса с одним `telegram_id` могут попытаться
   создать двух пользователей. Использовать `INSERT ... ON CONFLICT(telegram_id) DO NOTHING`
   + повторный SELECT. UNIQUE constraint на `telegram_id` гарантирует атомарность.
5. Создаёт короткоживущую сессию (1 час) — чтобы не валидировать initData на каждый запрос.

**Защита от replay initData:**
В пределах 300-секундного окна initData можно переиспользовать.
Хранить использованные `hash` значения в in-memory `Set` с TTL 5 мин
(или в таблице `used_init_data_hashes`). При повторном использовании → 401.
Очистка: `setInterval` каждые 60 сек удаляет записи старше 5 мин.

**Обновление TMA-сессии:**
Когда сессия истекает (1 час), TMA не может показать login-страницу.
Клиент должен перехватывать 401 и автоматически переотправлять `initData`
для silent refresh. Флоу:
```
fetch(...) → 401 → POST /tma/auth/refresh (initData) → новая сессия → retry original request
```

Если `initData` невалиден или отсутствует → 401.

---

### Фаза 2.2 — Magic link (вход через email для веб-дашборда)

Telegram — primary платформа. Для веб-доступа — magic link (одноразовая ссылка на email).
Passkey (WebAuthn) — отдельный этап на будущее, см. [PLAN_PASSKEY.md](PLAN_PASSKEY.md).

#### Схема БД

```sql
CREATE TABLE magic_links (
  token_hash TEXT PRIMARY KEY,    -- SHA-256 хеш токена
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,       -- 15 минут
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### Флоу

```
1. Пользователь открывает /login → вводит email
2. POST /api/auth/magic-link
   Body: { email }
   → Нормализовать email (lowercase, trim)
   → Найти user по email
   → Если не найден → всё равно 200 OK (не раскрывать наличие аккаунта)
   → Инвалидировать старые magic links этого user:
     DELETE FROM magic_links WHERE user_id = ?
   → Сгенерировать токен (32 байта), SHA-256 хеш в magic_links
   → TTL: 15 минут, одноразовый
   → Отправить email АСИНХРОННО (fire-and-forget) — чтобы время ответа
     не зависело от наличия аккаунта (защита от timing-атаки)
   → Ответ: 200 OK (одинаково быстро в обоих случаях)

3. GET /auth/verify?token=...
   → Хешировать токен → найти в magic_links
   → Проверить expires_at
   → Удалить запись (одноразовый)
   → Создать user_session, установить cookie
   → Редирект на /dashboard
```

**Защита токена от утечки:**
- `GET /auth/verify` — токен попадает в серверные логи, историю браузера, заголовок `Referer`.
- Добавить `Referrer-Policy: no-referrer` на страницу верификации.
- После верификации — redirect (уже есть), токен остаётся только в истории.
- Альтернатива: промежуточная страница с auto-submit POST-формой (токен не в URL).

Требует SMTP (см. фазу 2.4).

#### Регистрация через веб

```
1. Пользователь открывает /register → вводит email + display_name
2. POST /api/auth/register
   Body: { email, display_name }
   → Проверить: email уникален
   → Создать user (email, display_name, без telegram_id)
   → Отправить magic link для подтверждения
   → Редирект на "Проверьте почту"

3. GET /auth/verify?token=...
   → Создать сессию → /dashboard
```

Rate limit: 3 magic-link запроса за 15 мин на email, 5 на IP.

**Защита от email enumeration при регистрации:**
`POST /api/auth/register` не должен раскрывать, занят ли email.
Если email уже существует — **не** возвращать ошибку «email занят».
Вместо этого: отправить на этот email письмо «кто-то пытался зарегистрироваться
с вашим email; если это вы — войдите через magic link».
Ответ клиенту всегда одинаковый: 200 OK «Проверьте почту».
Время ответа тоже одинаковое (async отправка, как для magic link).

#### Безопасность

- Не раскрывать существование email (всегда 200 OK).
- Одноразовый — удалять после использования.
- TTL 15 минут.
- Очистка: `DELETE FROM magic_links WHERE expires_at < datetime('now')` при каждом запросе.

#### API endpoints

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| POST | `/api/auth/register` | нет | Регистрация (email + display_name) |
| POST | `/api/auth/magic-link` | нет | Отправить magic link |
| GET | `/auth/verify` | нет | Верифицировать токен, создать сессию |
| POST | `/api/auth/logout` | user | Удалить текущую сессию |
| POST | `/api/auth/logout-all` | user | Удалить все сессии |

#### Веб-страницы

| Путь | Описание |
|------|----------|
| `/register` | Форма: email + display_name → magic link |
| `/login` | Форма: email → magic link |

---

### Фаза 2.3 — Owner TMA, веб-дашборд, обновлённые API

#### Linking аккаунтов: Telegram ↔ Email

Сценарий: пользователь зарегался через magic link (есть email, нет telegram_id),
потом открывает TMA — или наоборот.

**Привязка Telegram к существующему аккаунту:**

```
1. Пользователь открывает /tma/owner
2. Сервер валидирует initData → telegram_id
3. Ищет users WHERE telegram_id = ?
4. Если не найден:
   a. Проверяет, есть ли активная web-сессия (cookie)
   b. Если да → привязывает telegram_id к существующему user
   c. Если нет → создаёт нового user (только telegram_id, без email)
```

**Привязка email к TMA-аккаунту (из веб-дашборда):**

```
1. Пользователь залогинен через TMA (есть telegram_id, нет email)
2. Открывает /dashboard/settings → вводит email
3. POST /api/user/link-email → отправляет verification email
4. Переход по ссылке → email привязывается к аккаунту
5. Теперь может входить и через magic link, и через TMA
```

Конфликт: если email уже занят другим аккаунтом → **отказать** с понятной ошибкой:
«Этот email уже привязан к другому аккаунту. Войдите через email и привяжите Telegram там.»

**Race condition при linking:**
Два одновременных запроса с разными web-сессиями могут привязать один `telegram_id`
к разным аккаунтам. UNIQUE constraint на `telegram_id` гарантирует атомарность —
но нужна обработка `ON CONFLICT`: при ошибке уникальности → 409 с понятным сообщением
(аналогично race condition при создании TMA-пользователя в 2.1).

Merge аккаунтов — слишком сложная операция (перенос магазинов, сессий, уведомлений).
Не реализовывать в первой итерации. При необходимости — ручной merge через admin-панель.

#### Отвязка аккаунтов

Пользователь может захотеть отсоединить Telegram или email от аккаунта.

- `DELETE /api/user/unlink-telegram` — убирает `telegram_id = NULL`.
- `DELETE /api/user/unlink-email` — убирает `email = NULL`.
- **Ограничение:** нельзя убрать последний способ входа. Проверять:
  если после отвязки не останется ни email, ни telegram_id → 400 ошибка.

#### TMA-страницы для владельца

Вход: при открытии `/tma/owner` — валидация `initData` (HMAC-SHA256), поиск/создание пользователя по `telegram_id`.

| Путь | Описание |
|------|----------|
| `/tma/owner` | Список магазинов + кнопка «Создать магазин» |
| `/tma/owner/new` | Форма создания магазина |
| `/tma/owner/[shopId]` | Товары + входящие бронирования |
| `/tma/owner/[shopId]/products/new` | Добавление товара (название, цена, описание, фото) |
| `/tma/owner/[shopId]/products/[id]` | Редактирование / удаление товара |
| `/tma/owner/[shopId]/bookings` | Список бронирований (pending/confirmed) |
| `/tma/owner/[shopId]/settings` | Настройки уведомлений |

Команда `/myshops` в боте открывает TMA:
```
BotFather → /setcommands → myshops - Управление моими магазинами
```

Deep link на магазин: `t.me/botname/appname?startapp=shopId`
→ TMA открывается → парсит `startapp` → определяет роль:

```
1. Валидировать initData → telegram_id
2. Найти user по telegram_id
3. Если user — owner этого магазина → /tma/owner/[shopId]
4. Иначе → /shop/[shopId] (buyer view)
```

Роутинг на клиенте (JS), чтобы не блокировать загрузку. Если initData невалиден → buyer view.

**Обработка несуществующего shopId в deep link:**
Если `startapp=nonexistent` → магазин не найден → показать ошибку «Магазин не найден»
с кнопкой «Перейти на главную» (или закрыть TMA). Не молча падать.

#### CSP для TMA-маршрутов

Middleware: для `/tma/*` применять relaxed CSP (как для `/shop/*`):
- Разрешить `https://telegram.org` в script-src
- Разрешить `https://api.telegram.org` в connect-src
- Разрешить framing из Telegram

#### Веб-страницы (запасной канал)

| Путь | Описание |
|------|----------|
| `/register` | Регистрация: email + display name → magic link |
| `/login` | Вход: email → magic link |
| `/dashboard` | Список своих магазинов + кнопка «Создать» |
| `/dashboard/[shopId]` | Управление: товары, бронирования |
| `/dashboard/[shopId]/products/new` | Добавление товара |
| `/dashboard/[shopId]/products/[id]` | Редактирование товара |
| `/dashboard/[shopId]/bookings` | Управление бронированиями |
| `/dashboard/[shopId]/settings` | Уведомления, название магазина |
| `/dashboard/settings` | Профиль: email, привязка Telegram |

#### Обновить API магазинов

Все endpoint'ы в `/api/shops/*` и `/api/shops/[shopId]/products/*`:
- Убрать `ADMIN_PASSWORD`.
- Авторизация: `requireOwner(req, shopId)` — проверяет `shop.owner_id === user.id` или `user.role === 'admin'`.

**Новые/изменённые API:**

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| POST | `/api/shops` | user | Создать магазин (owner_id = current user) |
| PUT | `/api/shops/[shopId]` | owner | Редактировать магазин (название) |
| DELETE | `/api/shops/[shopId]` | owner | Удалить магазин |
| POST | `/api/shops/[shopId]/products` | owner | Создать товар с фото |
| PUT | `/api/shops/[shopId]/products/[id]` | owner | Редактировать товар |
| DELETE | `/api/shops/[shopId]/products/[id]` | owner | Удалить товар |
| POST | `/api/shops/[shopId]/products/[id]/reserve` | public | Забронировать |
| POST | `/api/shops/[shopId]/products/[id]/confirm` | owner | Подтвердить бронь |
| POST | `/api/shops/[shopId]/products/[id]/release` | owner | Отклонить бронь |
| GET | `/api/shops/[shopId]/bookings` | owner | Список бронирований |
| GET | `/api/shops/[shopId]/settings` | owner | Настройки магазина |
| PUT | `/api/shops/[shopId]/settings` | owner | Обновить настройки |
| GET | `/api/user/profile` | user | Профиль текущего пользователя |
| PUT | `/api/user/profile` | user | Обновить профиль |
| POST | `/api/user/link-email` | user | Привязать email |
| DELETE | `/api/user/account` | user | Удалить аккаунт |

**Product edit (PUT)** — обновить title, price, description, size.

Детали:
- **Partial update:** принимать только переданные поля (остальные не трогать).
  `COALESCE(?, existing_value)` в SQL или явная проверка на `undefined` в коде.
- **Можно ли обнулить цену?** Да — `price: 0` явно разрешён (бесплатная раздача).
- **Редактирование забронированного/проданного товара:** разрешить менять description/size,
  но **запретить** менять title/price для `reserved`/`sold` (покупатель видел другую карточку).
- **Cache invalidation:** при изменении изображений товара кэш `/api/uploads/...`
  не инвалидируется (заголовок `Cache-Control: immutable`). Решение: использовать
  новые имена файлов при re-upload (или добавить query-param `?v=timestamp` в URL фото).

Фото: отдельные endpoint'ы для добавления/удаления отдельных изображений:

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| POST | `/api/shops/[shopId]/products/[id]/images` | owner | Добавить фото |
| DELETE | `/api/shops/[shopId]/products/[id]/images/[imageId]` | owner | Удалить фото |
| PUT | `/api/shops/[shopId]/products/[id]/images/order` | owner | Изменить порядок |

#### Управление бронированиями для владельца

Страницы `/tma/owner/[shopId]/bookings` и `/dashboard/[shopId]/bookings`:
- Список товаров со статусом `reserved` (pending confirmation).
- Для каждого: кто забронировал, когда, сколько до auto-expire (24ч).
- Кнопки: «Подтвердить» / «Отклонить».
- Фильтр: pending / confirmed / expired.

#### Пагинация

Все списочные endpoint'ы и страницы должны поддерживать пагинацию:

- `GET /api/shops?page=1&limit=20` — список магазинов на главной
- `GET /api/shops/[shopId]/products?page=1&limit=20` — товары магазина
- `GET /api/shops/[shopId]/bookings?page=1&limit=20` — бронирования

Default: `limit=20`, max: `100`. Ответ включает `{ items, total, page, pages }`.
На фронте: кнопки «Назад / Далее» или infinite scroll.

#### Статус «Продано»

Текущая схема имеет `status = 'sold'`, но нет endpoint'а для перевода.
Добавить:

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| POST | `/api/shops/[shopId]/products/[id]/sold` | owner | Отметить как проданный |

Жизненный цикл статусов:
```
available → reserved (reserved_by, confirmed=0)
reserved  → confirmed (confirmed=1)
confirmed → sold (финальный статус)
reserved  → available (release / auto-expire 24ч)
sold      → (необратимый)
```

**Строгая валидация переходов:**
Каждый endpoint ОБЯЗАН проверять текущий статус перед изменением.
Без проверки `releaseReservation()` может «воскресить» проданный товар.

```typescript
// confirm: только из reserved (unconfirmed)
if (product.status !== 'reserved' || product.confirmed === 1) return 409;

// release: только из reserved (любой confirmed)
if (product.status !== 'reserved') return 409;

// sold: только из reserved + confirmed
if (product.status !== 'reserved' || product.confirmed !== 1) return 409;
```

Использовать `UPDATE ... WHERE status = ? AND confirmed = ?` для атомарной проверки
(аналогично `reserveProduct`).

Проданные товары скрываются из публичного каталога, но остаются в dashboard/статистике.

#### Защита от self-reserve

Владелец не должен иметь возможность забронировать свой же товар через buyer view.
В `POST /api/shops/[shopId]/products/[id]/reserve`:
- Если запрос содержит cookie/auth сессию → проверить `shop.owner_id !== user.id`.
- Если owner → 403 «Нельзя забронировать свой товар».

#### Уникальность slug магазина

При создании магазина: если slug уже занят другим пользователем:
- Ответ: 409 Conflict с сообщением «Этот ID уже занят».
- Предложить альтернативы: `{slug}-2`, `{slug}-{random4}`.
- UX: живая проверка доступности slug (debounced GET `/api/shops/check-slug?id=...`).

#### Настройки уведомлений per-магазин

- Email для уведомлений (по умолчанию — email аккаунта)
- Чекбоксы каналов: Telegram, Email

При создании брони сервер:
1. Читает `shop.owner_id` → `users`
2. Читает `shop.notify_channels` (JSON-массив)
3. По каналам:
   - `telegram` → `sendMessage` на `users.telegram_id` владельца
   - `email` → письмо на `shop.notify_email` (или `users.email`)
4. Если у владельца нет `telegram_id` → пропустить telegram-канал (не падать)

#### Контакт-форма — привязать к магазину + добавить поле сообщения

Текущая контакт-форма принимает **только email** — нет поля для текста сообщения.
Покупатель не может задать вопрос. Добавить поле `message` (обязательное, max 1000 символов).

- `POST /api/shops/[shopId]/contact` — привязана к конкретному магазину.
  Body: `{ email, message }`.
- Уведомление идёт владельцу магазина (по `notify_channels`).
- Глобальный `/api/contact` — оставить для общих вопросов (идёт на `TELEGRAM_CHAT_ID` из env, если задан).
  Тоже добавить поле `message`.

#### Уведомления покупателю о статусе бронирования

Сейчас покупатель бронирует товар и **не получает обратной связи** — не знает,
подтверждена бронь или отклонена. Это ключевой UX-пробел.

**Для TMA-покупателей** (есть `telegram_id`):
- При `confirm` → отправить сообщение покупателю через бота:
  «Ваша бронь на "{title}" подтверждена! Свяжитесь с продавцом...»
- При `release` → «Бронь на "{title}" отменена.»
- Требует хранение `reserved_by_telegram_id` в `products` (или отдельная таблица `reservations`).

**Для анонимных покупателей** (без TMA):
- Минимум: показать статус брони на странице магазина (localStorage хранит productId).
- Опционально: собирать email при бронировании (необязательное поле) → email-уведомление.

**Будущее:** отдельная таблица `reservations` с FK на buyer user_id для полного трекинга.

#### Связь продавец ↔ покупатель

После бронирования продавец видит имя покупателя, но не может с ним связаться
(кроме TMA-пользователей с видимым @username).

Минимальное решение: при бронировании через TMA — в уведомлении продавцу
включать deep link на чат с покупателем (`tg://user?id={telegram_id}`).
Для анонимных покупателей — включать email, если указан при бронировании.

#### (Опционально) Модерация новых магазинов

- Новые магазины создаются со статусом `pending`.
- Публичные страницы (`/`, `/shop/*`) показывают только `active`.
- Owner видит свой магазин всегда (с плашкой статуса).
- Admin одобряет/отклоняет/блокирует из `/admin`.
- При смене статуса → уведомление владельцу.

---

### Фаза 2.4 — Email-уведомления

#### SMTP интеграция

Env vars:
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=...
SMTP_FROM=Homelyst <noreply@example.com>
```

Библиотека: `nodemailer` (работает в Bun).

#### Типы email'ов

| Тип | Когда | Кому |
|-----|-------|------|
| Бронирование | Новая бронь | Owner (если email в notify_channels) |
| Magic link | Запрос входа | User |
| Email verification | Привязка email | User |
| Модерация | Магазин одобрен/отклонён | Owner |

Шаблоны: plain text (не HTML) — проще, безопаснее, не нужен шаблонизатор.

#### DNS-записи для доставляемости

Magic link письма без аутентификации попадут в спам. Минимум:
- **SPF** — `TXT` запись разрешающая SMTP-серверу отправлять от имени домена.
- **DKIM** — подпись писем (настраивается на SMTP-провайдере).
- **DMARC** — политика обработки неаутентифицированных писем.

Документировать требования к DNS в README или `.env.example`.

#### Очередь retry для уведомлений

Если Telegram API или SMTP недоступны в момент бронирования — уведомление потеряно.
Добавить простую очередь:

```sql
CREATE TABLE notification_queue (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  type      TEXT NOT NULL,   -- 'telegram' | 'email'
  payload   TEXT NOT NULL,   -- JSON с данными для отправки
  status    TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
  attempts  INTEGER DEFAULT 0,
  next_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Воркер (setInterval, 30 сек): выбирает `pending` с `next_at <= now`, отправляет,
при ошибке — `attempts++`, `next_at = now + backoff` (1 мин, 5 мин, 15 мин).
После 3 попыток — `status = 'failed'`. Admin видит failed уведомления в панели.

**Magic link и retry TTL:**
Magic link живёт 15 минут. Retry с backoff 1→5→15 мин может съесть весь TTL.
Для magic link писем использовать **ускоренный** backoff (30 сек, 1 мин, 2 мин)
и пометить тип `priority: 'high'` в очереди. Если все 3 попытки провалились
в пределах TTL — залогировать, но не создавать новый magic link автоматически.

---

### Фаза 2.5 — Удаление аккаунта

`DELETE /api/user/account`:

1. Требует подтверждение (ввод email или Telegram confirmation).
2. Удаляет все сессии пользователя.
3. Магазины: `owner_id = NULL` (магазины остаются, но без владельца → видны только admin'у).
4. Удаляет запись из `users` (сессии и magic_links — CASCADE delete).

Изображения и товары НЕ удаляются автоматически (admin разбирается вручную).

**Анонимизация персональных данных:**
- `reserved_by` содержит имена реальных людей. При удалении аккаунта:
  `UPDATE products SET reserved_by = '[удалён]' WHERE reserved_by IN (...)` — если привязка по имени.
- В будущем: заменить `reserved_by` (текст) на `reserved_by_user_id` (FK) для точной привязки.

**Повторная регистрация:**
- После удаления аккаунта пользователь может зарегистрироваться повторно с тем же email/telegram_id.
- UNIQUE constraint освобождается при DELETE → новый INSERT пройдёт.
- Старые магазины (owner_id = NULL) **не** привязываются к новому аккаунту автоматически.

---

### Фаза 2.6 (будущее) — Поиск и фильтрация

Для мультишоп маркетплейса критично — но можно отложить на после MVP.

- Поиск товаров по названию (FTS5 в SQLite).
- Фильтр по цене (от/до), размеру, статусу.
- Сортировка: по дате, цене, популярности.
- Поиск магазинов по названию.

Endpoint: `GET /api/search?q=...&minPrice=...&maxPrice=...&size=...&sort=...`

---

## Хранение цен

Текущая схема хранит цену как `REAL` (float). Float арифметика ненадёжна для денег
(0.1 + 0.2 ≠ 0.3). Перейти на `INTEGER` в центах:

```sql
-- Миграция
ALTER TABLE products ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0;
UPDATE products SET price_cents = CAST(price * 100 AS INTEGER);
-- Затем удалить старый столбец (через пересоздание таблицы в SQLite)
```

На фронте: `(price_cents / 100).toFixed(2)` для отображения.
В API: принимать и возвращать `price_cents` (целое число).

**Валюта:** сейчас `€` захардкожена в UI. Добавить поле `currency TEXT DEFAULT 'EUR'`
в таблицу `shops` (валюта одна на магазин). На фронте — подставлять символ по коду.
Поддерживаемые валюты на старте: EUR, USD, RUB, GEL.

---

## Порядок реализации

```
[ ] 2.0: Security hardening
    [ ] Cookie: добавить Secure флаг
    [ ] CSRF: генерация токенов, проверка в middleware (включая TMA-сессии)
    [ ] Redirect: валидация через URL constructor
    [ ] Rate limiter: убрать bypass для unknown IP, не доверять x-forwarded-for
    [ ] Rate limiter: dev-mode с TRUST_LOCAL
    [ ] Input validation: shopId, productId параметры
    [ ] Input validation: зарезервированные slug'и магазинов (admin, api, tma, dashboard, ...)
    [x] File upload: magic bytes ДО записи на диск (уже исправлено)
    [ ] CSP nonce вместо unsafe-inline
    [ ] Rate limiter: периодическая очистка Map (утечка памяти)
    [ ] Очистка файлов при удалении товара/магазина (rm uploads/)
    [ ] Лимиты на сущности: max магазинов/пользователя, товаров/магазин, размер запроса
    [ ] Health-check endpoint (GET /api/health)
    [ ] Graceful shutdown (SIGTERM → db.close())
    [ ] Периодическая экспирация бронирований (setInterval sweep)
    [ ] Строгая валидация статус-машины (confirm/release/sold проверяют текущий статус)
    [ ] Аудит-лог: JSON в stdout

[ ] 2.1: Система пользователей
    [ ] Система миграций (папка migrations/, таблица _migrations, бекап перед миграцией)
    [ ] Bootstrap первого admin'а (seed через env var или CLI)
    [ ] Таблицы users, user_sessions
    [ ] Нормализация email (lowercase) при сохранении и поиске
    [ ] Max concurrent sessions per user (≤ 10)
    [ ] ALTER shops: owner_id, notify_email, notify_channels, status, currency
    [ ] Обновить auth.ts: session в БД, getUserFromRequest, requireOwner
    [ ] TMA initData HMAC-SHA256 валидация
    [ ] TMA: защита от replay initData (хранить использованные hash, TTL 5 мин)
    [ ] TMA: race condition при создании user (ON CONFLICT DO NOTHING)
    [ ] TMA: silent refresh сессии (401 → переотправка initData)
    [ ] TMA: Authorization header вместо cookie (защита от CSRF)
    [ ] Обновить middleware: role-based routing
    [ ] Миграция цен: REAL → INTEGER (центы) + поле currency в shops

[ ] 2.2: Magic link (веб-авторизация)
    [ ] Таблица magic_links
    [ ] POST /api/auth/register (создание user + отправка magic link)
    [ ] Защита от email enumeration при регистрации (всегда 200 OK)
    [ ] POST /api/auth/magic-link (async отправка, защита от timing-атаки)
    [ ] Инвалидация старых magic links при создании нового
    [ ] GET /auth/verify (верификация токена, создание сессии)
    [ ] Referrer-Policy: no-referrer на /auth/verify
    [ ] Страницы /register и /login
    [ ] Logout / logout-all
    [ ] Очистка expired magic links

[ ] 2.3: Owner dashboard + обновлённые API
    [ ] TMA-страницы /tma/owner/* (список магазинов, товары, бронирования)
    [ ] Веб-дашборд /dashboard/* (зеркало TMA-функционала)
    [ ] Пагинация для всех списков (магазины, товары, бронирования)
    [ ] API: PUT магазин, PUT товар (partial update, ограничения для reserved/sold)
    [ ] API: управление фото (add/delete/reorder + cache invalidation)
    [ ] API: POST sold (перевод товара в «продано»)
    [ ] API: бронирования для владельца (список, подтверждение, отклонение)
    [ ] Уведомления покупателю о статусе бронирования (TMA → Telegram msg, анонимные → email)
    [ ] Связь продавец ↔ покупатель (deep link tg://user?id= в уведомлении продавцу)
    [ ] Защита от self-reserve (owner не может бронировать свои товары)
    [ ] Linking аккаунтов (Telegram ↔ email) + обработка race condition (ON CONFLICT → 409)
    [ ] Unlinking аккаунтов (с проверкой что останется способ входа)
    [ ] Уникальность slug магазина (409 + предложение альтернатив)
    [ ] Контакт-форма: привязка к магазину + поле message
    [ ] Deep links (t.me/bot?startapp=shopId) с роутингом buyer/owner + обработка несуществующего shopId
    [ ] CSP для /tma/owner/*
    [ ] Команда /myshops в боте

[ ] 2.4: Email-уведомления
    [ ] SMTP интеграция (nodemailer)
    [ ] DNS: SPF, DKIM, DMARC записи (документировать)
    [ ] Очередь retry для уведомлений (notification_queue)
    [ ] Magic link: ускоренный backoff (30s/1m/2m) с priority: high
    [ ] Уведомления о бронированиях на email
    [ ] Magic link: отправка писем
    [ ] Email verification при привязке

[ ] 2.5: Удаление аккаунта + модерация
    [ ] DELETE /api/user/account
    [ ] Анонимизация персональных данных (reserved_by)
    [ ] Модерация магазинов (pending/active/suspended)
    [ ] Admin-панель: управление пользователями и магазинами

[ ] 2.6 (будущее): Поиск и фильтрация
    [ ] FTS5 поиск товаров по названию
    [ ] Фильтр по цене, размеру, статусу
    [ ] Сортировка (дата, цена)
```

---

## Риски и митигация

| Риск | Митигация |
|------|-----------|
| Миграция существующих магазинов | `owner_id = NULL` → видны только admin'у; admin назначает владельцев |
| Загрузка фото в TMA | `<input type="file">` работает в Telegram WebView; тестировать на Android/iOS |
| Deep links на магазин | Валидация shopId + роутинг buyer/owner по telegram_id; 404 → ошибка с кнопкой «На главную» |
| Подделка initData | HMAC-SHA256 валидация + проверка auth_date (не старше 5 мин) + replay protection (hash cache) |
| Конфликт аккаунтов (email ↔ telegram_id) | Отказать при конфликте, предложить войти другим способом; merge вручную через admin; ON CONFLICT → 409 |
| SMTP недоступен | Telegram как primary; email опционально; очередь retry с 3 попытками; ускоренный backoff для magic link |
| Race condition при бронировании | SQLite transaction; один продукт = одна бронь |
| Race condition при создании user (TMA) | UNIQUE constraint + `ON CONFLICT DO NOTHING` + повторный SELECT |
| Race condition при linking аккаунтов | UNIQUE constraint на telegram_id + ON CONFLICT обработка → 409 |
| Horizontal scaling | SQLite = single node; при необходимости мигрировать на PostgreSQL |
| Потеря Telegram аккаунта | Magic link на email как запасной вход (если email привязан) |
| Magic link перехвачен | TTL 15 мин + одноразовый + HTTPS + Referrer-Policy: no-referrer |
| Email enumeration (magic link) | Асинхронная отправка; одинаковое время ответа вне зависимости от наличия аккаунта |
| Email enumeration (register) | Всегда 200 OK; если email занят → отправить уведомление владельцу вместо ошибки |
| CSRF на TMA-сессии | TMA использует Authorization header вместо cookie |
| Float арифметика для цен | Миграция на INTEGER (центы) в фазе 2.1 |
| Утечка памяти rate limiter | Периодическая очистка Map (setInterval) |
| Письма в спаме | SPF/DKIM/DMARC DNS-записи; документировать при настройке SMTP |
| SQLite миграции не откатываются | Бекап файла БД перед миграцией; каждая миграция в отдельной транзакции |
| Slug магазина конфликтует с маршрутами | Список RESERVED_SLUGS; валидация при создании; 400 с понятным сообщением |
| Orphan-файлы при удалении товара/магазина | rm uploads/ после DELETE в БД; resolve path перед удалением |
| DoS через массовое создание сущностей | Лимиты: 10 магазинов/пользователя, 200 товаров/магазин, 100 MB/запрос |
| Ленивая экспирация бронирований | Периодический sweep (setInterval, 5 мин) в дополнение к ленивой экспирации |
| «Воскрешение» проданного товара через release | Строгая валидация статус-машины: проверка текущего статуса перед каждым переходом |
| Покупатель не знает статус брони | Уведомление через Telegram (TMA) или email; localStorage для анонимных |
| Bootstrap admin'а после удаления ADMIN_PASSWORD | Seed через env var SEED_ADMIN_TELEGRAM_ID при пустой таблице users |
| Потеря данных при SIGTERM | Graceful shutdown: db.close() по SIGTERM |
| Cache-Control immutable на изменяемых фото | Новые имена файлов при re-upload или ?v=timestamp |
