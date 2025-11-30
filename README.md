# Telegram Support Bot

Модульный бот техподдержки на grammY + Drizzle ORM.

## Быстрая установка

```bash
curl -fsSL https://raw.githubusercontent.com/GofMan5/NeforLove-technical-support/main/install.sh | bash
```

Скрипт автоматически:
- Клонирует репозиторий
- Устанавливает зависимости
- Запрашивает конфигурацию (токен, ID админов, ID группы)
- Настраивает базу данных
- Создаёт systemd сервис

Флаги: `--no-systemd`, `--dir <path>`, `--local`, `--help`

## Обновление

```bash
cd ~/support-bot && curl -fsSL https://raw.githubusercontent.com/GofMan5/NeforLove-technical-support/main/update.sh | bash
```

Или локально:

```bash
./update.sh
```

Скрипт обновления:
- Создаёт бэкап (.env, data, locales)
- Останавливает сервис
- Получает обновления из git
- Обновляет зависимости и компилирует
- Запускает миграции БД
- Перезапускает сервис

Флаги: `--no-backup`, `--no-tests`, `--force`, `--help`

## Ручная установка

```bash
npm install
cp .env.example .env
# заполни .env
npm run build
npm run db:migrate
```

## Настройка

Создай группу в телеграме с топиками, добавь бота админом.

```env
BOT_TOKEN=токен_от_botfather
ADMIN_IDS=123456789
SUPPORT_GROUP_ID=-100xxxxxxxxxx
DATABASE_PATH=./data/bot.db
LOG_LEVEL=info
DEFAULT_LOCALE=ru
LOCALES_PATH=./locales
```

## Запуск

```bash
npm run dev    # разработка
npm start      # продакшн
```

## Управление сервисом

```bash
sudo systemctl status support-bot
sudo systemctl restart support-bot
sudo journalctl -u support-bot -f
```

## Структура

```
src/
├── bot/          # grammY инстанс
├── commands/     # реестр команд
├── core/         # конфиг, логгер
├── database/     # drizzle схема
├── middleware/   # пайплайн
├── modules/      # support, admin
└── services/     # i18n, сессии, аудит
```

## Тесты

```bash
npm test
```
