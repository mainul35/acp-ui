#!/usr/bin/env bash
# Builds this fork as a Linux desktop app inside WSL, from the Windows checkout.
#
# The source is edited on Windows, but building through /mnt/c is slow (npm and cargo touch tens of
# thousands of small files), so it is copied to ~/acp-ui-build on the Linux side first, without
# node_modules or build output, and built there. The app is then run with scripts/wsl-run.sh.
#
#   wsl -d Ubuntu -e bash /mnt/c/Users/<you>/Documents/codes/acp-ui/scripts/wsl-build.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$HOME/acp-ui-build"
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
. "$HOME/.cargo/env"

mkdir -p "$WORK"
rsync -a --delete --exclude node_modules --exclude 'src-tauri/target' --exclude dist --exclude dist-web \
      --exclude .git "$SRC/" "$WORK/"
cd "$WORK"

# Only when the lock file changed: a full install is the slowest step
if ! cmp -s package-lock.json node_modules/.package-lock.copy 2>/dev/null; then
    npm ci --no-audit --no-fund
    cp package-lock.json node_modules/.package-lock.copy
fi

# The executable alone; an installer package is not needed to run it here
npx tauri build --no-bundle "$@"
echo "built: $WORK/src-tauri/target/release/acp-ui"
