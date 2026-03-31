# Homelyst

Простой магазин для продажи вещей. Astro + SQLite + Tailwind, работает в Docker.

## Стек

- [Astro](https://astro.build) (SSR, Node adapter)
- SQLite через `better-sqlite3`
- Tailwind CSS
- Docker / Docker Compose

## Запуск

**Разработка**

```bash
docker compose -f compose.yml -f compose.dev.yml up
```

Приложение доступно на [http://localhost:4321](http://localhost:4321).
Папки `src/` и `public/` монтируются в контейнер — изменения применяются сразу.

**Продакшн**

```bash
docker compose up
```

## Переменные окружения

Скопируй `.env.example` в `.env` и заполни значения:

```
ADMIN_PASSWORD=  # пароль для входа в админку
DATABASE_PATH=   # путь к файлу SQLite (по умолчанию /app/data/db.sqlite)
```

## Импорт товаров

Данные товаров хранятся локально в `data/` и не входят в репозиторий. Для импорта:

```bash
docker compose -f compose.yml -f compose.dev.yml exec app npx tsx scripts/import.ts
```
