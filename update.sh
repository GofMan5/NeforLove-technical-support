#!/bin/bash

# ============================================================================
# NeforLove Telegram Support Bot - Update Script
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
SKIP_BACKUP=false
SKIP_TESTS=false
FORCE_UPDATE=false

# ============================================================================
# Help Message
# ============================================================================
show_help() {
    echo "NeforLove Telegram Support Bot - Update Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help          Show this help message and exit"
    echo "  --no-backup     Skip creating backup before update"
    echo "  --no-tests      Skip running tests after update"
    echo "  --force         Force update without confirmation"
    echo ""
    echo "Examples:"
    echo "  $0                          # Update with defaults"
    echo "  $0 --no-backup              # Update without backup"
    echo "  $0 --no-tests               # Update without running tests"
    echo "  $0 --force                  # Update without confirmation"
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
            --no-backup)
                SKIP_BACKUP=true
                shift
                ;;
            --no-tests)
                SKIP_TESTS=true
                shift
                ;;
            --force)
                FORCE_UPDATE=true
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
# Pre-flight Checks
# ============================================================================
preflight_checks() {
    print_step "1/7" "Проверка окружения..."
    
    # Check if we're in the right directory
    if [[ ! -f "package.json" ]]; then
        print_error "package.json не найден"
        print_info "Запустите скрипт из директории проекта"
        exit 1
    fi
    
    # Check if it's a git repository
    if [[ ! -d ".git" ]]; then
        print_error "Это не git репозиторий"
        print_info "Обновление возможно только для git репозитория"
        exit 1
    fi
    
    # Check for node
    if ! command -v node &> /dev/null; then
        print_error "Node.js не найден"
        exit 1
    fi
    
    # Check for npm
    if ! command -v npm &> /dev/null; then
        print_error "npm не найден"
        exit 1
    fi
    
    print_success "Окружение проверено"
}

# ============================================================================
# Service Management
# ============================================================================
stop_service() {
    print_step "2/7" "Остановка сервиса..."
    
    # Check if systemctl is available and service exists
    if command -v systemctl &> /dev/null; then
        if systemctl is-active --quiet support-bot 2>/dev/null; then
            print_info "Остановка systemd сервиса..."
            if sudo systemctl stop support-bot; then
                print_success "Сервис остановлен"
                return 0
            else
                print_error "Не удалось остановить сервис"
                exit 1
            fi
        fi
    fi
    
    # Check for PM2
    if command -v pm2 &> /dev/null; then
        if pm2 describe support-bot &> /dev/null; then
            print_info "Остановка PM2 процесса..."
            if pm2 stop support-bot; then
                print_success "PM2 процесс остановлен"
                return 0
            fi
        fi
    fi
    
    # Check for running node process
    if pgrep -f "node.*dist/index.js" &> /dev/null; then
        print_info "Остановка node процесса..."
        pkill -f "node.*dist/index.js" || true
        sleep 2
        print_success "Node процесс остановлен"
        return 0
    fi
    
    print_info "Активный сервис не найден"
}

start_service() {
    print_step "7/7" "Запуск сервиса..."
    
    # Check if systemctl is available and service exists
    if command -v systemctl &> /dev/null; then
        if systemctl is-enabled --quiet support-bot 2>/dev/null; then
            print_info "Запуск systemd сервиса..."
            if sudo systemctl start support-bot; then
                sleep 3
                if systemctl is-active --quiet support-bot; then
                    print_success "Сервис запущен"
                    echo ""
                    print_info "Статус сервиса:"
                    sudo systemctl status support-bot --no-pager || true
                    return 0
                else
                    print_error "Сервис не запустился"
                    print_info "Проверьте логи: sudo journalctl -u support-bot -f"
                    exit 1
                fi
            else
                print_error "Не удалось запустить сервис"
                exit 1
            fi
        fi
    fi
    
    # Check for PM2
    if command -v pm2 &> /dev/null; then
        if pm2 describe support-bot &> /dev/null; then
            print_info "Запуск PM2 процесса..."
            if pm2 restart support-bot; then
                print_success "PM2 процесс запущен"
                return 0
            fi
        fi
    fi
    
    print_warning "Автоматический запуск сервиса не настроен"
    print_info "Запустите бота вручную: npm start"
}

# ============================================================================
# Backup
# ============================================================================
create_backup() {
    print_step "3/7" "Создание резервной копии..."
    
    if [[ "$SKIP_BACKUP" == true ]]; then
        print_info "Создание бэкапа пропущено (--no-backup)"
        return 0
    fi
    
    local BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"
    
    # Create backup directory
    mkdir -p "$BACKUP_DIR"
    
    # Backup .env file
    if [[ -f ".env" ]]; then
        cp .env "$BACKUP_DIR/.env"
        print_info "Сохранён .env"
    fi
    
    # Backup database
    if [[ -d "data" ]]; then
        cp -r data "$BACKUP_DIR/data"
        print_info "Сохранена база данных"
    fi
    
    # Backup locales (if customized)
    if [[ -d "locales" ]]; then
        cp -r locales "$BACKUP_DIR/locales"
        print_info "Сохранены локализации"
    fi
    
    print_success "Бэкап создан: $BACKUP_DIR"
}

# ============================================================================
# Git Update
# ============================================================================
pull_updates() {
    print_step "4/7" "Получение обновлений..."
    
    # Fetch latest changes
    print_info "Получение изменений из репозитория..."
    git fetch origin
    
    # Use reset --hard to handle any history changes (force push, squash, etc.)
    print_info "Применение обновлений..."
    if git reset --hard origin/main; then
        print_success "Обновления получены"
    else
        print_error "Не удалось получить обновления"
        print_info "Проверьте подключение к интернету"
        exit 1
    fi
}

# ============================================================================
# Dependencies Update
# ============================================================================
update_dependencies() {
    print_step "5/7" "Обновление зависимостей..."
    
    # Install/update dependencies
    print_info "Запуск npm install..."
    if npm install; then
        print_success "Зависимости обновлены"
    else
        print_error "Ошибка обновления зависимостей"
        exit 1
    fi
    
    # Rebuild project
    print_info "Компиляция TypeScript..."
    if npm run build; then
        print_success "Проект скомпилирован"
    else
        print_error "Ошибка компиляции"
        exit 1
    fi
}

# ============================================================================
# Database Migrations
# ============================================================================
run_migrations() {
    print_step "6/7" "Миграции базы данных..."
    
    print_info "Запуск миграций..."
    if npm run db:migrate; then
        print_success "Миграции выполнены"
    else
        print_error "Ошибка миграций"
        print_info "База данных может быть повреждена"
        print_info "Восстановите из бэкапа при необходимости"
        exit 1
    fi
}

# ============================================================================
# Tests
# ============================================================================
run_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        print_info "Тесты пропущены (--no-tests)"
        return 0
    fi
    
    print_info "Запуск тестов..."
    if npm test -- --run; then
        print_success "Все тесты пройдены"
    else
        print_warning "Некоторые тесты не прошли"
        print_info "Проверьте результаты тестов"
    fi
}

# ============================================================================
# Summary
# ============================================================================
show_summary() {
    echo ""
    echo "============================================================================"
    print_success "Обновление завершено!"
    echo "============================================================================"
    echo ""
    
    if command -v systemctl &> /dev/null && systemctl is-enabled --quiet support-bot 2>/dev/null; then
        print_info "Управление сервисом:"
        echo "  Статус:          sudo systemctl status support-bot"
        echo "  Логи:            sudo journalctl -u support-bot -f"
        echo "  Перезапуск:      sudo systemctl restart support-bot"
    else
        print_info "Запуск бота:"
        echo "  npm start"
    fi
    
    echo ""
}

# ============================================================================
# Error Handler
# ============================================================================
cleanup_on_error() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        echo ""
        print_error "Обновление прервано из-за ошибки (код: $exit_code)"
        print_info "Проверьте сообщения выше для деталей"
        print_info "При необходимости восстановите из бэкапа"
    fi
    exit $exit_code
}

trap cleanup_on_error EXIT

# ============================================================================
# Main Function
# ============================================================================
main() {
    echo ""
    echo "============================================================================"
    echo "  NeforLove Telegram Support Bot - Обновление"
    echo "============================================================================"
    echo ""
    
    parse_arguments "$@"
    
    # Confirmation
    if [[ "$FORCE_UPDATE" != true ]]; then
        echo -n "Начать обновление? (y/n): "
        read -n 1 -r REPLY < /dev/tty
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Обновление отменено"
            exit 0
        fi
    fi
    
    preflight_checks
    stop_service
    create_backup
    pull_updates
    update_dependencies
    run_migrations
    run_tests
    start_service
    show_summary
    
    trap - EXIT
    return 0
}

# ============================================================================
# Run Main
# ============================================================================
main "$@"
