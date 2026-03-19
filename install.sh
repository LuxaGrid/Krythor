#!/usr/bin/env bash
# ============================================================
#  Krythor — One-line installer (Mac/Linux)
#  Usage: curl -fsSL https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.sh | bash
#
#  Installs to: ~/.krythor/
#  Creates command: krythor  (via shell profile alias)
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

echo ""
echo -e "${CYAN}  KRYTHOR — Installer${RESET}"
echo -e "${BOLD}  https://github.com/${REPO}${RESET}"
echo ""

# ── Check dependencies ────────────────────────────────────────────────────────
check_dep() {
  if ! command -v "$1" &>/dev/null; then
    echo -e "${RED}✗ Required tool not found: $1${RESET}"
    echo "  Please install $1 and try again."
    exit 1
  fi
}
check_dep curl
check_dep node

# ── Check Node.js version ─────────────────────────────────────────────────────
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo -e "${RED}✗ Node.js 20+ is required (you have $(node --version))${RESET}"
  echo "  Update at https://nodejs.org"
  exit 1
fi
echo -e "${GREEN}✓${RESET} Node.js $(node --version)"

# ── Fetch latest release info ─────────────────────────────────────────────────
echo -e "${GREEN}✓${RESET} Checking latest release..."
RELEASE_JSON=$(curl -fsSL "${GITHUB_API}")
VERSION=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
ZIP_URL=$(echo "$RELEASE_JSON" | grep '"browser_download_url"' | grep '\.zip' | head -1 | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')

if [ -z "$VERSION" ] || [ -z "$ZIP_URL" ]; then
  echo -e "${RED}✗ Could not find a release zip on GitHub.${RESET}"
  echo "  Check: https://github.com/${REPO}/releases"
  exit 1
fi
echo -e "${GREEN}✓${RESET} Found release: ${VERSION}"

# ── Check for existing install ────────────────────────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
  echo ""
  echo -e "${YELLOW}⚠  Krythor is already installed at: ${INSTALL_DIR}${RESET}"
  printf "   Overwrite with ${VERSION}? [y/N] "
  read -r CONFIRM </dev/tty
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "  Aborted."
    exit 0
  fi
  echo "  Removing existing install..."
  rm -rf "$INSTALL_DIR"
fi

# ── Download and extract ──────────────────────────────────────────────────────
TMP_DIR=$(mktemp -d)
TMP_ZIP="${TMP_DIR}/krythor.zip"

echo -e "${GREEN}✓${RESET} Downloading ${VERSION}..."
curl -fsSL --progress-bar -o "$TMP_ZIP" "$ZIP_URL"

if [ ! -f "$TMP_ZIP" ] || [ ! -s "$TMP_ZIP" ]; then
  echo -e "${RED}✗ Download failed or file is empty.${RESET}"
  rm -rf "$TMP_DIR"
  exit 1
fi

echo -e "${GREEN}✓${RESET} Extracting..."
mkdir -p "$INSTALL_DIR"

# Try unzip, fall back to python3
if command -v unzip &>/dev/null; then
  unzip -q "$TMP_ZIP" -d "$TMP_DIR/extracted"
else
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$TMP_ZIP" "$TMP_DIR/extracted"
fi

# Move contents into install dir (handle single top-level folder in zip)
EXTRACTED=$(ls "$TMP_DIR/extracted")
ENTRY_COUNT=$(echo "$EXTRACTED" | wc -l | tr -d ' ')
if [ "$ENTRY_COUNT" -eq 1 ]; then
  cp -r "$TMP_DIR/extracted/$EXTRACTED/." "$INSTALL_DIR/"
else
  cp -r "$TMP_DIR/extracted/." "$INSTALL_DIR/"
fi

rm -rf "$TMP_DIR"
echo -e "${GREEN}✓${RESET} Installed to: ${INSTALL_DIR}"

# ── Create krythor launch script ──────────────────────────────────────────────
LAUNCHER="${INSTALL_DIR}/krythor"
cat > "$LAUNCHER" <<'LAUNCHEREOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/start.js" "$@"
LAUNCHEREOF
chmod +x "$LAUNCHER"

# ── Add alias to shell profile ────────────────────────────────────────────────
ALIAS_LINE="alias krythor='${INSTALL_DIR}/krythor'"
PROFILE_UPDATED=false

add_to_profile() {
  local profile="$1"
  if [ -f "$profile" ]; then
    if ! grep -qF "alias krythor=" "$profile"; then
      printf "\n# Krythor\n%s\n" "$ALIAS_LINE" >> "$profile"
      PROFILE_UPDATED=true
    fi
  fi
}

add_to_profile "${HOME}/.bashrc"
add_to_profile "${HOME}/.bash_profile"
add_to_profile "${HOME}/.zshrc"

# ── Run setup wizard ──────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}  Running setup wizard...${RESET}"
echo ""
node "${INSTALL_DIR}/packages/setup/dist/bin/setup.js" || true

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}  Krythor ${VERSION} installed successfully!${RESET}"
echo ""
echo "  To launch Krythor:"
echo -e "    ${BOLD}${INSTALL_DIR}/krythor${RESET}"
echo ""
if [ "$PROFILE_UPDATED" = true ]; then
  echo "  A 'krythor' alias was added to your shell profile."
  echo "  Activate it in your current session:"
  echo -e "    ${BOLD}source ~/.bashrc${RESET}  (or ~/.zshrc)"
  echo ""
fi
echo "  Then open: http://localhost:47200"
echo ""
