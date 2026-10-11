#!/usr/bin/env bash
# Starts the app built by scripts/wsl-build.sh. WSLg shows it as a window on the Windows desktop.
# Node (for agents started with npx or node) comes from nvm, so it is put on the PATH first.
set -eu
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
# Under WSLg's Wayland the window draws but mouse input never reaches the WebKit view, so it runs
# through WSLg's X server instead. WebKitGTK's GPU paths (compositing, DMA-BUF buffers) have no real
# GPU behind them there and only add failure modes, so they are off; software drawing is reliable.
export GDK_BACKEND=x11
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
exec "$HOME/acp-ui-build/src-tauri/target/release/acp-ui" "$@"
