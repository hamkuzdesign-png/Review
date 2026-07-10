#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/hamkuzdesign-png/Review"
NODE_MAJOR="22"
INSTALL_DIR="$HOME/.figma-design-diff"
NODE_DIR="$INSTALL_DIR/node"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Этот скрипт рассчитан только на macOS." >&2
  exit 1
fi

# 1. Найти проект рядом со скриптом, иначе скачать код с GitHub
if [ -f "$SCRIPT_DIR/package.json" ]; then
  PROJECT_DIR="$SCRIPT_DIR"
else
  echo "==> Скачиваю код проекта..."
  mkdir -p "$INSTALL_DIR"
  curl -fsSL "$REPO_URL/archive/refs/heads/main.tar.gz" -o "$INSTALL_DIR/repo.tar.gz"
  rm -rf "$INSTALL_DIR/Review-main"
  tar -xzf "$INSTALL_DIR/repo.tar.gz" -C "$INSTALL_DIR"
  PROJECT_DIR="$INSTALL_DIR/Review-main"
fi
cd "$PROJECT_DIR"

# 2. Node.js: использовать системный, если >=20, иначе скачать портативный (без sudo)
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  CUR_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if [ "$CUR_MAJOR" -ge 20 ]; then
    NODE_OK=1
  fi
fi

if [ "$NODE_OK" -eq 1 ]; then
  NPM_BIN="$(command -v npm)"
  NPX_BIN="$(command -v npx)"
  echo "==> Использую системный Node.js $(node -v)"
else
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    echo "==> Node.js не найден — скачиваю портативную версию в $NODE_DIR (без прав администратора)..."
    ARCH="$(uname -m)"
    case "$ARCH" in
      arm64) NODE_ARCH="arm64" ;;
      x86_64) NODE_ARCH="x64" ;;
      *) echo "Неизвестная архитектура: $ARCH" >&2; exit 1 ;;
    esac
    mkdir -p "$INSTALL_DIR"
    FILENAME="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/SHASUMS256.txt" | grep "darwin-${NODE_ARCH}.tar.gz" | awk '{print $2}')"
    curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/${FILENAME}" -o "$INSTALL_DIR/node.tar.gz"
    rm -rf "$NODE_DIR"
    mkdir -p "$NODE_DIR"
    tar -xzf "$INSTALL_DIR/node.tar.gz" -C "$NODE_DIR" --strip-components=1
  fi
  export PATH="$NODE_DIR/bin:$PATH"
  NPM_BIN="$NODE_DIR/bin/npm"
  NPX_BIN="$NODE_DIR/bin/npx"
  echo "==> Использую портативный Node.js $("$NODE_DIR/bin/node" -v)"
fi

# 3. Зависимости + Chromium для Playwright (кешируется, повторный запуск быстрый)
echo "==> Устанавливаю зависимости (в первый раз может занять пару минут)..."
"$NPM_BIN" install --no-audit --no-fund
"$NPX_BIN" playwright install chromium

# 4. Собрать плагин под локальный бэкенд
BACKEND_URL="http://localhost:4517" "$NPM_BIN" run build --workspace=packages/plugin

# 5. (Пере)запустить бэкенд в фоне
PIDFILE="$PROJECT_DIR/.server.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "==> Останавливаю ранее запущенный бэкенд..."
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  sleep 1
fi

echo "==> Запускаю бэкенд в фоне (лог: $PROJECT_DIR/server.log)..."
nohup "$NPM_BIN" run dev:server > "$PROJECT_DIR/server.log" 2>&1 &
echo $! > "$PIDFILE"
sleep 2

if curl -fsS http://localhost:4517/health >/dev/null 2>&1; then
  echo ""
  echo "Бэкенд запущен: http://localhost:4517"
else
  echo ""
  echo "Бэкенд не ответил сразу — смотрите $PROJECT_DIR/server.log"
fi

echo ""
echo "Осталось вручную (один раз):"
echo "  Figma (desktop app) -> Plugins -> Development -> Import plugin from manifest..."
echo "  Выбрать файл: $PROJECT_DIR/packages/plugin/manifest.json"
echo ""
echo "Чтобы остановить бэкенд: kill \$(cat \"$PIDFILE\")"
