#!/usr/bin/env bash
# Starts the app built by scripts/wsl-build.sh. WSLg shows it as a window on the Windows desktop.
# Node (for agents started with npx or node) comes from nvm, so it is put on the PATH first.
set -eu
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
# WebKitGTK's GPU compositing draws a blank window under WSLg on some drivers; software is reliable
export WEBKIT_DISABLE_COMPOSITING_MODE=1
exec "$HOME/acp-ui-build/src-tauri/target/release/acp-ui" "$@"
