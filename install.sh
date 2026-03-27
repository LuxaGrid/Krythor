#!/usr/bin/env bash
# ============================================================
#  Krythor — One-line installer (Mac / Linux)
#
#  Install:
#    curl -fsSL https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.sh | bash
#
#  Update (after install):
#    krythor update
#
#  Installs to: ~/.krythor/
#  Creates command: krythor
#
#  No Node.js required — the bundled runtime is included in the zip.
# ============================================================
set -euo pipefail

REPO="LuxaGrid/Krythor"
INSTALL_DIR="${HOME}/.krythor"
GITHUB_API="https://api.github.com/repos/${REPO}/releases/latest"

BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

# ── Update mode ───────────────────────────────────────────────────────────────
# When the user runs "krythor update", the launcher re-invokes this script
# with UPDATE=1. Skips the interactive overwrite prompt.
UPDATE_MODE="${UPDATE:-0}"

# ── Flag parsing ──────────────────────────────────────────────────────────────
# Supports:
#   --no-onboard    Skip the first-time setup wizard after install
#   --no-prompt     Skip all interactive prompts (implies --no-onboard)
# Env var alternative: KRYTHOR_NON_INTERACTIVE=1
NO_ONBOARD=0
NO_PROMPT=0
for _arg in "$@"; do
  case "$_arg" in
    --no-onboard|--no-setup) NO_ONBOARD=1 ;;
    --no-prompt)             NO_PROMPT=1; NO_ONBOARD=1 ;;
  esac
done

# ── Non-interactive mode ──────────────────────────────────────────────────────
# Set KRYTHOR_NON_INTERACTIVE=1 to skip all prompts (CI/scripted installs).
# The setup wizard is also skipped — configure providers via providers.json or
# the Control UI after install.
NON_INTERACTIVE="${KRYTHOR_NON_INTERACTIVE:-0}"
if [ "$NO_PROMPT" = "1" ]; then NON_INTERACTIVE=1; fi

echo ""
echo -e "${CYAN}${BOLD}  KRYTHOR${RESET}${CYAN} — Installer${RESET}"
echo -e "  https://github.com/${REPO}"
echo ""

# ── Detect platform ───────────────────────────────────────────────────────────
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Linux)  PLATFORM="linux" ;;
  Darwin) PLATFORM="macos"  ;;
  *)
    echo -e "${RED}✗ Unsupported OS: $OS${RESET}"
    echo "  Krythor supports macOS and Linux."
    echo "  Windows users: open PowerShell and run:"
    echo "    iwr https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.ps1 | iex"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64 | amd64)   ARCH_TAG="x64"   ;;
  arm64  | aarch64) ARCH_TAG="arm64"  ;;
  *)
    echo -e "${YELLOW}⚠  Unknown architecture: $ARCH — assuming x64${RESET}"
    ARCH_TAG="x64"
    ;;
esac

ASSET_NAME="krythor-${PLATFORM}-${ARCH_TAG}.zip"
echo -e "${GREEN}✓${RESET} Platform detected: ${BOLD}${PLATFORM}-${ARCH_TAG}${RESET}"

if ! command -v curl &>/dev/null; then
  echo -e "${RED}✗ curl is required but not found. Please install curl and try again.${RESET}"
  exit 1
fi

# ── Fetch latest release ──────────────────────────────────────────────────────
echo -e "${GREEN}✓${RESET} Checking latest version..."
RELEASE_JSON=$(curl -fsSL --retry 3 "${GITHUB_API}")
VERSION=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')

ZIP_URL=$(echo "$RELEASE_JSON" | grep '"browser_download_url"' \
  | grep "\"${ASSET_NAME}\"" \
  | head -1 \
  | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')

# Fallback to any zip if no platform-specific asset found
if [ -z "$ZIP_URL" ]; then
  echo -e "${YELLOW}⚠  Platform asset (${ASSET_NAME}) not in this release — trying generic zip.${RESET}"
  ZIP_URL=$(echo "$RELEASE_JSON" | grep '"browser_download_url"' | grep '\.zip' | head -1 | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')
fi

if [ -z "$VERSION" ]; then
  echo -e "${RED}✗ Could not read version from GitHub. Check: https://github.com/${REPO}/releases${RESET}"
  exit 1
fi

if [ -z "$ZIP_URL" ]; then
  echo -e "${RED}✗ No release file found for your platform (${ASSET_NAME}).${RESET}"
  echo "  Check: https://github.com/${REPO}/releases"
  exit 1
fi

echo -e "${GREEN}✓${RESET} Latest version: ${BOLD}${VERSION}${RESET}"

# ── Check if already installed ────────────────────────────────────────────────
if [ -d "$INSTALL_DIR" ] && [ "$UPDATE_MODE" != "1" ] && [ "$NON_INTERACTIVE" != "1" ]; then
  echo ""
  echo -e "${YELLOW}⚠  Krythor is already installed at: ${INSTALL_DIR}${RESET}"
  echo "   Your settings, memory, and data are stored separately and will not be touched."
  printf "   Install ${VERSION} over existing version? [y/N] "
  read -r CONFIRM </dev/tty
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    exit 0
  fi
elif [ -d "$INSTALL_DIR" ] && [ "$NON_INTERACTIVE" = "1" ]; then
  echo -e "${YELLOW}⚠  Overwriting existing install (non-interactive mode)${RESET}"
fi

if [ -d "$INSTALL_DIR" ]; then
  echo -e "${GREEN}✓${RESET} Removing old install..."
  rm -rf "$INSTALL_DIR"
fi

# ── Download ──────────────────────────────────────────────────────────────────
TMP_DIR=$(mktemp -d)
TMP_ZIP="${TMP_DIR}/krythor.zip"

echo ""
echo -e "${GREEN}  Downloading Krythor ${VERSION}...${RESET}"
curl -fsSL --retry 3 --progress-bar -o "$TMP_ZIP" "$ZIP_URL"

if [ ! -f "$TMP_ZIP" ] || [ ! -s "$TMP_ZIP" ]; then
  echo -e "${RED}✗ Download failed or file is empty.${RESET}"
  rm -rf "$TMP_DIR"
  exit 1
fi

# ── Extract ───────────────────────────────────────────────────────────────────
echo -e "${GREEN}  Installing...${RESET}"
mkdir -p "$INSTALL_DIR"

if command -v unzip &>/dev/null; then
  unzip -q "$TMP_ZIP" -d "$TMP_DIR/extracted"
elif command -v python3 &>/dev/null; then
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$TMP_ZIP" "$TMP_DIR/extracted"
else
  echo -e "${RED}✗ Neither 'unzip' nor 'python3' found — cannot extract archive.${RESET}"
  rm -rf "$TMP_DIR"
  exit 1
fi

EXTRACTED=$(ls "$TMP_DIR/extracted")
ENTRY_COUNT=$(echo "$EXTRACTED" | wc -l | tr -d ' ')
if [ "$ENTRY_COUNT" -eq 1 ]; then
  cp -r "$TMP_DIR/extracted/$EXTRACTED/." "$INSTALL_DIR/"
else
  cp -r "$TMP_DIR/extracted/." "$INSTALL_DIR/"
fi

rm -rf "$TMP_DIR"
echo -e "${GREEN}✓${RESET} Files installed to: ${INSTALL_DIR}"

# ── Verify bundled Node runtime ───────────────────────────────────────────────
BUNDLED_NODE="${INSTALL_DIR}/runtime/node"
if [ -f "$BUNDLED_NODE" ]; then
  chmod 755 "$BUNDLED_NODE"
  echo ""
  echo -e "${GREEN}✓${RESET} Bundled Node runtime: $("$BUNDLED_NODE" --version 2>/dev/null || echo 'check failed')"
else
  echo -e "${YELLOW}⚠  Bundled Node runtime not found at: ${BUNDLED_NODE}${RESET}"
  echo "   The release zip may be incomplete. Try re-downloading."
fi

# ── Create krythor launcher ───────────────────────────────────────────────────
LAUNCHER="${INSTALL_DIR}/krythor"
cat > "$LAUNCHER" <<'LAUNCHEREOF'
#!/usr/bin/env bash
# Krythor launcher — generated by installer
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Handle "krythor update" — re-runs the installer script
if [ "$1" = "update" ]; then
  echo "Checking for Krythor updates..."
  UPDATE=1 curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.sh | bash
  exit 0
fi

exec "${DIR}/runtime/node" "${DIR}/start.js" "$@"
LAUNCHEREOF
chmod +x "$LAUNCHER"

# ── Startup health check ──────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}  Running startup health check...${RESET}"
if [ -f "$BUNDLED_NODE" ]; then
  if "${BUNDLED_NODE}" -e "require('./node_modules/better-sqlite3')" --cwd "${INSTALL_DIR}" 2>/dev/null; then
    echo -e "${GREEN}✓${RESET} better-sqlite3 loads correctly"
  else
    # Try with explicit working directory change
    if ( cd "${INSTALL_DIR}" && "${BUNDLED_NODE}" -e "require('./node_modules/better-sqlite3')" 2>/dev/null ); then
      echo -e "${GREEN}✓${RESET} better-sqlite3 loads correctly"
    else
      echo -e "${YELLOW}⚠  better-sqlite3 health check failed.${RESET}"
      echo "   Run: krythor repair"
    fi
  fi
fi

# ── Add to shell profile ──────────────────────────────────────────────────────
ALIAS_LINE="export PATH=\"\$PATH:${INSTALL_DIR}\""
PROFILE_UPDATED=false

add_to_profile() {
  local profile="$1"
  if [ -f "$profile" ]; then
    if ! grep -qF "${INSTALL_DIR}" "$profile"; then
      printf "\n# Krythor\n%s\n" "$ALIAS_LINE" >> "$profile"
      PROFILE_UPDATED=true
    fi
  fi
}

add_to_profile "${HOME}/.bashrc"
add_to_profile "${HOME}/.bash_profile"
add_to_profile "${HOME}/.zshrc"

# ── Run first-time setup wizard ───────────────────────────────────────────────
SETUP_SCRIPT="${INSTALL_DIR}/packages/setup/dist/bin/setup.js"
if [ -f "$SETUP_SCRIPT" ] && [ "$UPDATE_MODE" != "1" ] && [ "$NON_INTERACTIVE" != "1" ] && [ "$NO_ONBOARD" != "1" ]; then
  echo ""
  echo -e "${CYAN}  Running first-time setup...${RESET}"
  echo ""
  if [ -f "$BUNDLED_NODE" ]; then
    "${BUNDLED_NODE}" "$SETUP_SCRIPT" || true
  else
    node "$SETUP_SCRIPT" || true
  fi
elif [ "$NON_INTERACTIVE" = "1" ] || [ "$NO_ONBOARD" = "1" ]; then
  echo -e "${YELLOW}  Setup wizard skipped.${RESET}"
  echo "  Configure providers via: krythor setup  or the Control UI after starting."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  Setup complete!${RESET}"
echo -e "${GREEN}  Krythor ${VERSION} is ready.${RESET}"
echo ""
echo "  To start Krythor, run:"
echo -e "    ${BOLD}${INSTALL_DIR}/krythor${RESET}"
echo ""

if [ "$PROFILE_UPDATED" = true ]; then
  echo "  The 'krythor' command has been added to your PATH."
  echo "  To use it in this terminal window right now, run:"
  if [[ "$SHELL" == *"zsh"* ]]; then
    echo -e "    ${BOLD}source ~/.zshrc${RESET}"
  else
    echo -e "    ${BOLD}source ~/.bashrc${RESET}"
  fi
  echo ""
  echo "  In future terminal sessions it will work automatically."
  echo ""
fi

echo "  After starting, open your browser to:"
echo -e "    ${BOLD}http://localhost:47200${RESET}"
echo ""
echo "  To update Krythor later:"
echo -e "    ${BOLD}krythor update${RESET}"
echo ""
