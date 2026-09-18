#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_FILE="$DESKTOP_DIR/NiZyLa.desktop"

mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=NiZyLa
Comment=Graph-aware programming editor
Exec=$APP_DIR/NiZyLa.sh
Path=$APP_DIR
Terminal=false
Categories=Development;IDE;TextEditor;Utility;
StartupNotify=true
EOF

chmod +x "$APP_DIR/NiZyLa.sh" "$DESKTOP_FILE"
echo "Installed NiZyLa launcher: $DESKTOP_FILE"
echo "You can now search for NiZyLa in your app launcher."
