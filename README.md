# Telegram Support Bot

Бот техподдержки с тикетами и топиками. grammY + Drizzle + SQLite.

## Запуск

```bash
git clone https://github.com/GofMan5/NeforLove-technical-support
cd NeforLove-technical-support
cp .env.example .env
# заполнить .env
docker compose up -d
```

Логи: `docker compose logs -f`

## Конфигурация

Создай группу с топиками, добавь бота админом.

```env
BOT_TOKEN=токен_от_botfather
ADMIN_IDS=123456789
SUPPORT_GROUP_ID=-100xxxxxxxxxx
DATABASE_PATH=./data/bot.db
LOG_LEVEL=info
DEFAULT_LOCALE=ru
LOCALES_PATH=./locales
```

## Разработка

```bash
npm install
npm run dev
npm test
npm run db:studio
```

## Лицензия

MIT
