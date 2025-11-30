# Telegram Support Bot

Модульный бот техподдержки на grammY + Drizzle ORM.

## Быстрая установка

Автоматическая установка одной командой:

```bash
curl -fsSL https://raw.githubusercontent.com/GofMan5/NeforLove-technical-support/main/install.sh | bash
```

Или с wget:

```bash
wget -qO- https://raw.githubusercontent.com/GofMan5/NeforLove-technical-support/main/install.sh | bash
```

### Флаги установки

| Флаг | Описание |
|------|----------|
| `--help` | Показать справку по использованию |
| `--no-systemd` | Пропустить создание systemd сервиса |
| `--dir <path>` | Указать директорию установки (по умолчанию: ~/support-bot) |
| `--local` | Локальная установка в текущую директорию (без клонирования) |

Примеры:

```bash
# Установка в кастомную директорию
curl -fsSL https://raw.githubusercontent.com/GofMan5/NeforLove-technical-support/main/install.sh | bash -s -- --dir /opt/bot

# Установка без systemd сервиса
curl -fsSL https://raw.githubusercontent.com/GofMan5/NeforLove-technical-support/main/install.sh | bash -s -- --no-systemd

# Локальная установка (если уже склонировали репозиторий)
./install.sh --local

# Показать справку
curl -fsSL https://raw.githubusercontent.com/GofMan5/NeforLove-technical-support/main/install.sh | bash -s -- --help
```

## Ручная установка

```bash
npm install
cp .env.example .env
# заполни .env
```

## Настройка

Создай группу в телеграме с топиками, добавь бота админом. Получи ID группы (можно через @getidsbot).

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
# dev
npm run dev

# prod
npm run build
npm start
```

## Команды бота

- `/start` - Start bot
- `/lang` - Настройка лангуаге
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

## Миграции

```bash
npm run db:generate
npm run db:migrate
```
