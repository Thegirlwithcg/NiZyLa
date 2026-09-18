#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "NiZyLa needs Node.js/npm installed."
  echo "Install Node.js, then run this launcher again."
  read -rp "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing NiZyLa dependencies..."
  npm install
fi

echo "Starting NiZyLa..."
npm run start
