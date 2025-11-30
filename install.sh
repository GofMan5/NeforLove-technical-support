#!/bin/bash

# ============================================================================
# NeforLove Telegram Support Bot - Installation Script
# ============================================================================

set -e

# ============================================================================
# Color Definitions
# ============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# Output Functions
# ============================================================================
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}→ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_step() {
    echo -e "\n${BLUE}[$1] $2${NC}"
}

# ============================================================================
# Default Values
# ============================================================================
INSTALL_DIR="$HOME/support-bot"
SKIP_SYSTEMD=false
LOCAL_INSTALL=false
REPO_URL="https://github.com/GofMan5/NeforLove-technical-support"


# ============================================================================
# Help Message
# ============================================================================
show_help() {
    echo "NeforLove Telegram Support Bot - Installation Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help          Show this help message and exit"
    echo "  --no-systemd    Skip systemd service creation"
    echo "  --dir <path>    Install to specified directory (default: $HOME/support-bot)"
    echo "  --local         Local install (skip cloning, use current directory)"
    echo ""
    echo "Examples:"
    echo "  $0                          # Install with defaults"
    echo "  $0 --no-systemd             # Install without systemd service"
    echo "  $0 --dir /opt/bot           # Install to /opt/bot"
    echo "  $0 --dir /opt/bot --no-systemd"
    echo "  $0 --local                  # Install in current directory (no git clone)"
    echo ""
}

# ============================================================================
# Argument Parser
# ============================================================================
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --help)
                show_help
                exit 0
                ;;
            --no-systemd)
                SKIP_SYSTEMD=true
                shift
                ;;
            --dir)
                if [[ -z "$2" || "$2" == --* ]]; then
                    print_error "Option --dir requires a directory path"
                    exit 1
                fi
                INSTALL_DIR="$2"
                shift 2
                ;;
            --local)
                LOCAL_INSTALL=true
                INSTALL_DIR="$(pwd)"
                shift
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
}

# ============================================================================
# Dependency Checker
# ============================================================================
check_dependencies() {
    print_step "1/7" "Проверка зависимостей..."
    
    local missing_deps=false
    
    # Check for git
    if command -v git &> /dev/null; then
        print_success "git найден: $(git --version)"
    else
        print_error "git не найден"
        print_info "Установите: sudo apt install git"
        missing_deps=true
    fi
    
    # Check for node
    if command -v node &> /dev/null; then
        local node_version=$(node --version | sed 's/v//')
        local node_major=$(echo "$node_version" | cut -d. -f1)
        
        if [[ "$node_major" -ge 18 ]]; then
            print_success "Node.js найден: v$node_version"
        else
            print_error "Требуется Node.js 18+. Текущая версия: v$node_version"
            print_info "Обновите Node.js: curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt install -y nodejs"
            missing_deps=true
        fi
    else
        print_error "Node.js не найден"
        print_info "Установите: curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt install -y nodejs"
        missing_deps=true
    fi
    
    # Check for npm
    if command -v npm &> /dev/null; then
        print_success "npm найден: $(npm --version)"
    else
        print_error "npm не найден"
        print_info "npm обычно устанавливается вместе с Node.js"
        missing_deps=true
    fi
    
    # Exit if any dependencies are missing
    if [[ "$missing_deps" == true ]]; then
        echo ""
        print_error "Установите недостающие зависимости и запустите скрипт снова"
        exit 1
    fi
    
    print_success "Все зависимости установлены"
}

# ============================================================================
# Repository Cloning
# ============================================================================
clone_repository() {
    print_step "2/7" "Клонирование репозитория..."
    
    # Skip cloning if --local flag was set
    if [[ "$LOCAL_INSTALL" == true ]]; then
        print_info "Локальная установка - клонирование пропущено"
        
        # Verify package.json exists
        if [[ ! -f "$INSTALL_DIR/package.json" ]]; then
            print_error "Файл package.json не найден в $INSTALL_DIR"
            print_info "Убедитесь, что вы находитесь в директории проекта"
            exit 1
        fi
        
        print_success "Используется существующая директория: $INSTALL_DIR"
        cd "$INSTALL_DIR"
        return 0
    fi
    
    # Check if directory already exists
    if [[ -d "$INSTALL_DIR" ]]; then
        print_warning "Директория $INSTALL_DIR уже существует"
        echo ""
        echo "Выберите действие:"
        echo "  1) Чистая установка (удалить и установить заново)"
        echo "  2) Обновить (git reset --hard + pull)"
        echo "  3) Отмена"
        echo ""
        echo -n "Ваш выбор (1/2/3): "
        read -n 1 -r REPLY < /dev/tty
        echo
        
        case $REPLY in
            1)
                print_info "Удаление старой директории..."
                rm -rf "$INSTALL_DIR"
                print_info "Клонирование из $REPO_URL..."
                if git clone "$REPO_URL" "$INSTALL_DIR"; then
                    print_success "Репозиторий склонирован в $INSTALL_DIR"
                else
                    print_error "Не удалось клонировать репозиторий"
                    exit 1
                fi
                ;;
            2)
                if [[ -d "$INSTALL_DIR/.git" ]]; then
                    print_info "Сброс и обновление репозитория..."
                    cd "$INSTALL_DIR"
                    git fetch origin
                    if git reset --hard origin/main; then
                        print_success "Репозиторий обновлён"
                    else
                        print_error "Не удалось обновить репозиторий"
                        exit 1
                    fi
                else
                    print_error "Директория не является git репозиторием"
                    print_info "Выберите чистую установку (1)"
                    exit 1
                fi
                ;;
            *)
                print_info "Установка отменена"
                exit 0
                ;;
        esac
    else
        # Clone the repository
        print_info "Клонирование из $REPO_URL..."
        if git clone "$REPO_URL" "$INSTALL_DIR"; then
            print_success "Репозиторий склонирован в $INSTALL_DIR"
        else
            print_error "Не удалось клонировать репозиторий"
            print_info "Проверьте подключение к интернету и доступность репозитория"
            exit 1
        fi
    fi
    
    # Change to install directory
    cd "$INSTALL_DIR"
}

# ============================================================================
# Install Dependencies
# ============================================================================
install_dependencies() {
    print_step "3/7" "Установка зависимостей..."
    
    # Ensure we're in the install directory
    cd "$INSTALL_DIR"
    
    # Run npm install
    print_info "Запуск npm install..."
    if npm install; then
        print_success "Зависимости установлены"
    else
        print_error "Ошибка установки зависимостей"
        print_info "Проверьте логи выше для деталей"
        exit 1
    fi
    
    # Run npm run build to compile TypeScript
    print_info "Компиляция TypeScript..."
    if npm run build; then
        print_success "Проект скомпилирован"
    else
        print_error "Ошибка компиляции TypeScript"
        print_info "Проверьте логи выше для деталей"
        exit 1
    fi
}

# ============================================================================
# Configuration Wizard
# ============================================================================
configure_environment() {
    print_step "4/7" "Настройка конфигурации..."
    
    # Ensure we're in the install directory
    cd "$INSTALL_DIR"
    
    # Default values for configuration
    local DEFAULT_DATABASE_PATH="./data/bot.db"
    local DEFAULT_LOG_LEVEL="info"
    local DEFAULT_LOCALE="ru"
    local DEFAULT_LOCALES_PATH="./locales"
    
    # Prompt for BOT_TOKEN with validation loop
    print_info "Введите токен бота от @BotFather"
    print_info "Формат: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
    while true; do
        echo -n "BOT_TOKEN: "
        read BOT_TOKEN < /dev/tty
        if validate_token "$BOT_TOKEN"; then
            print_success "Токен принят"
            break
        else
            print_error "Неверный формат токена. Получите токен у @BotFather"
            print_info "Формат: числовой_id:буквенно-цифровая_строка"
        fi
    done
    
    echo ""
    
    # Prompt for ADMIN_IDS with validation loop
    print_info "Введите Telegram ID администраторов (через запятую без пробелов)"
    print_info "Пример: 123456789 или 123456789,987654321"
    print_info "Узнать свой ID можно у @userinfobot"
    while true; do
        echo -n "ADMIN_IDS: "
        read ADMIN_IDS < /dev/tty
        if validate_admin_ids "$ADMIN_IDS"; then
            print_success "ID администраторов приняты"
            break
        else
            print_error "Неверный формат. Введите числовые ID через запятую без пробелов"
        fi
    done
    
    echo ""
    
    # Prompt for SUPPORT_GROUP_ID with validation loop
    print_info "Введите ID группы техподдержки с топиками"
    print_info "ID группы начинается с -100, например: -1001234567890"
    print_info "Узнать ID группы можно добавив @RawDataBot в группу"
    while true; do
        echo -n "SUPPORT_GROUP_ID: "
        read SUPPORT_GROUP_ID < /dev/tty
        if validate_group_id "$SUPPORT_GROUP_ID"; then
            print_success "ID группы принят"
            break
        else
            print_error "ID группы должен начинаться с -100"
        fi
    done
    
    echo ""
    
    # Set default values
    DATABASE_PATH="$DEFAULT_DATABASE_PATH"
    LOG_LEVEL="$DEFAULT_LOG_LEVEL"
    BOT_DEFAULT_LOCALE="$DEFAULT_LOCALE"
    LOCALES_PATH="$DEFAULT_LOCALES_PATH"
    
    print_info "Используются значения по умолчанию:"
    print_info "  DATABASE_PATH: $DATABASE_PATH"
    print_info "  LOG_LEVEL: $LOG_LEVEL"
    print_info "  DEFAULT_LOCALE: $BOT_DEFAULT_LOCALE"
    print_info "  LOCALES_PATH: $LOCALES_PATH"
    
    print_success "Конфигурация собрана"
}

# ============================================================================
# .env File Generator
# ============================================================================
generate_env_file() {
    print_step "5/7" "Создание файла .env..."
    
    # Ensure we're in the install directory
    cd "$INSTALL_DIR"
    
    local ENV_FILE="$INSTALL_DIR/.env"
    
    # Check if .env already exists
    if [[ -f "$ENV_FILE" ]]; then
        print_warning "Файл .env уже существует"
        echo -n "Перезаписать существующий файл? (y/n): "
        read -n 1 -r REPLY < /dev/tty
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Существующий .env файл сохранён"
            return 0
        fi
    fi
    
    # Write configuration to .env file
    cat > "$ENV_FILE" << EOF
# NeforLove Telegram Support Bot Configuration
# Generated by install.sh on $(date)

# Telegram Bot Token from @BotFather
BOT_TOKEN=$BOT_TOKEN

# Comma-separated Telegram IDs of bot administrators
ADMIN_IDS=$ADMIN_IDS

# Telegram group ID for support (must start with -100)
SUPPORT_GROUP_ID=$SUPPORT_GROUP_ID

# Path to SQLite database file
DATABASE_PATH=$DATABASE_PATH

# Logging level: debug, info, warn, error
LOG_LEVEL=$LOG_LEVEL

# Default locale for the bot
DEFAULT_LOCALE=$BOT_DEFAULT_LOCALE

# Path to locales directory
LOCALES_PATH=$LOCALES_PATH
EOF
    
    print_success "Файл .env создан"
}

# ============================================================================
# Validation Functions
# ============================================================================

# Validate Telegram bot token format: numeric_id:alphanumeric_string
# Example valid token: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
validate_token() {
    local token="$1"
    
    # Check if empty
    if [[ -z "$token" ]]; then
        return 1
    fi
    
    # Token format: numeric_id:alphanumeric_string
    # The numeric part is the bot ID, the alphanumeric part is the secret
    if [[ "$token" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
        return 0
    else
        return 1
    fi
}

# Validate admin IDs: comma-separated positive integers without spaces around commas
# Example valid: "123456789" or "123,456,789"
validate_admin_ids() {
    local ids="$1"
    
    # Check if empty
    if [[ -z "$ids" ]]; then
        return 1
    fi
    
    # Must be positive integers separated by commas, no spaces around commas
    if [[ "$ids" =~ ^[0-9]+(,[0-9]+)*$ ]]; then
        return 0
    else
        return 1
    fi
}

# Validate support group ID: must start with -100 followed by digits
# Example valid: "-1001234567890"
validate_group_id() {
    local group_id="$1"
    
    # Check if empty
    if [[ -z "$group_id" ]]; then
        return 1
    fi
    
    # Must start with -100 followed by more digits
    if [[ "$group_id" =~ ^-100[0-9]+$ ]]; then
        return 0
    else
        return 1
    fi
}

# ============================================================================
# Database Setup
# ============================================================================
setup_database() {
    print_step "6/7" "Настройка базы данных..."
    
    # Ensure we're in the install directory
    cd "$INSTALL_DIR"
    
    # Create data directory if it doesn't exist
    local DATA_DIR="$INSTALL_DIR/data"
    
    if [[ ! -d "$DATA_DIR" ]]; then
        print_info "Создание директории data..."
        if mkdir -p "$DATA_DIR"; then
            print_success "Директория data создана"
        else
            print_error "Не удалось создать директорию data"
            print_info "Проверьте права на запись в $INSTALL_DIR"
            exit 1
        fi
    else
        print_info "Директория data уже существует"
    fi
    
    # Run database migrations
    print_info "Запуск миграций базы данных..."
    if npm run db:migrate; then
        print_success "Миграции выполнены успешно"
    else
        print_error "Ошибка миграции базы данных"
        print_info "Возможные причины:"
        print_info "  - Нет прав на запись в директорию data"
        print_info "  - Файл базы данных повреждён"
        print_info "  - Ошибка в скриптах миграции"
        print_info ""
        print_info "Попробуйте:"
        print_info "  1. Проверить права: ls -la $DATA_DIR"
        print_info "  2. Удалить БД и повторить: rm -f $DATA_DIR/bot.db"
        print_info "  3. Запустить миграции вручную: npm run db:migrate"
        exit 1
    fi
    
    print_success "База данных настроена"
}

# ============================================================================
# Systemd Service Creation
# ============================================================================
create_systemd_service() {
    print_step "7/7" "Создание systemd сервиса..."
    
    # Skip if --no-systemd flag was set
    if [[ "$SKIP_SYSTEMD" == true ]]; then
        print_info "Создание systemd сервиса пропущено (--no-systemd)"
        return 0
    fi
    
    # Check if systemctl is available
    if ! command -v systemctl &> /dev/null; then
        print_warning "systemctl не найден. Пропуск создания сервиса."
        print_info "Вы можете запустить бота вручную: cd $INSTALL_DIR && npm start"
        return 0
    fi
    
    # Get current user
    local CURRENT_USER=$(whoami)
    
    # Generate service file content
    local SERVICE_CONTENT="[Unit]
Description=NeforLove Telegram Support Bot
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target"
    
    local SERVICE_FILE="/etc/systemd/system/support-bot.service"
    local TEMP_SERVICE_FILE="/tmp/support-bot.service"
    
    # Write service content to temp file
    echo "$SERVICE_CONTENT" > "$TEMP_SERVICE_FILE"
    
    print_info "Создание файла сервиса..."
    print_info "Требуются права sudo для копирования в $SERVICE_FILE"
    
    # Copy to systemd directory with sudo
    if sudo cp "$TEMP_SERVICE_FILE" "$SERVICE_FILE"; then
        print_success "Файл сервиса создан: $SERVICE_FILE"
    else
        print_error "Не удалось создать файл сервиса"
        print_info "Для создания systemd сервиса нужны права sudo"
        print_info "Вы можете запустить бота вручную: cd $INSTALL_DIR && npm start"
        rm -f "$TEMP_SERVICE_FILE"
        return 1
    fi
    
    # Clean up temp file
    rm -f "$TEMP_SERVICE_FILE"
    
    # Reload systemd daemon
    print_info "Перезагрузка systemd daemon..."
    if sudo systemctl daemon-reload; then
        print_success "systemd daemon перезагружен"
    else
        print_error "Не удалось перезагрузить systemd daemon"
        return 1
    fi
    
    return 0
}

# ============================================================================
# Enable and Start Service
# ============================================================================
enable_start_service() {
    # Skip if --no-systemd flag was set
    if [[ "$SKIP_SYSTEMD" == true ]]; then
        return 0
    fi
    
    # Skip if systemctl is not available
    if ! command -v systemctl &> /dev/null; then
        return 0
    fi
    
    # Enable the service
    print_info "Включение автозапуска сервиса..."
    if sudo systemctl enable support-bot; then
        print_success "Сервис добавлен в автозапуск"
    else
        print_error "Не удалось включить автозапуск сервиса"
        return 1
    fi
    
    # Start the service
    print_info "Запуск сервиса..."
    if sudo systemctl start support-bot; then
        print_success "Сервис запущен"
    else
        print_error "Не удалось запустить сервис"
        print_info "Проверьте логи: sudo journalctl -u support-bot -f"
        return 1
    fi
    
    # Display service status
    echo ""
    print_info "Статус сервиса:"
    sudo systemctl status support-bot --no-pager || true
    
    return 0
}

# ============================================================================
# Installation Summary
# ============================================================================
show_summary() {
    echo ""
    echo "============================================================================"
    print_success "Установка завершена!"
    echo "============================================================================"
    echo ""
    print_info "Путь установки: $INSTALL_DIR"
    echo ""
    
    if [[ "$SKIP_SYSTEMD" == true ]] || ! command -v systemctl &> /dev/null; then
        print_info "Полезные команды:"
        echo "  Запуск бота:     cd $INSTALL_DIR && npm start"
        echo "  Просмотр логов:  tail -f $INSTALL_DIR/logs/*.log"
    else
        print_info "Управление сервисом:"
        echo "  Статус:          sudo systemctl status support-bot"
        echo "  Запуск:          sudo systemctl start support-bot"
        echo "  Остановка:       sudo systemctl stop support-bot"
        echo "  Перезапуск:      sudo systemctl restart support-bot"
        echo "  Логи:            sudo journalctl -u support-bot -f"
    fi
    
    echo ""
    print_info "Следующие шаги:"
    echo "  1. Убедитесь, что бот запущен и работает"
    echo "  2. Напишите боту /start в Telegram"
    echo "  3. Проверьте работу техподдержки"
    echo ""
}

# ============================================================================
# Source-only mode for testing
# ============================================================================
if [[ "${1}" == "--source-only" ]]; then
    return 0 2>/dev/null || exit 0
fi

# ============================================================================
# Error Handler
# ============================================================================
cleanup_on_error() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        echo ""
        print_error "Установка прервана из-за ошибки (код: $exit_code)"
        print_info "Проверьте сообщения выше для деталей"
    fi
    exit $exit_code
}

# Set up error trap
trap cleanup_on_error EXIT

# ============================================================================
# Main Function
# ============================================================================
main() {
    # Display welcome banner
    echo ""
    echo "============================================================================"
    echo "  NeforLove Telegram Support Bot - Установка"
    echo "============================================================================"
    echo ""
    
    # Parse command line arguments
    parse_arguments "$@"
    
    # Display configuration
    print_info "Директория установки: $INSTALL_DIR"
    if [[ "$LOCAL_INSTALL" == true ]]; then
        print_info "Режим: локальная установка"
    fi
    if [[ "$SKIP_SYSTEMD" == true ]]; then
        print_info "Systemd сервис: пропущен"
    else
        print_info "Systemd сервис: будет создан"
    fi
    echo ""
    
    # Step 1: Check dependencies
    check_dependencies
    
    # Step 2: Clone repository
    clone_repository
    
    # Step 3: Install npm dependencies and build
    install_dependencies
    
    # Step 4: Interactive configuration
    configure_environment
    
    # Step 5: Generate .env file
    generate_env_file
    
    # Step 6: Setup database
    setup_database
    
    # Step 7: Create and start systemd service (if not skipped)
    create_systemd_service
    enable_start_service
    
    # Show completion summary
    show_summary
    
    # Clear the error trap on successful completion
    trap - EXIT
    
    return 0
}

# ============================================================================
# Run Main
# ============================================================================
main "$@"
