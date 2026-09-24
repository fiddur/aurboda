#!/usr/bin/env bash
set -euo pipefail

# Self-contained on purpose: this is pasteable into the tryout routine's
# environment setup field, where the repository is not cloned yet and only the
# image's stock Node exists. Nothing here depends on the workspace or on the
# Node the session-start hook installs.

TRYOUT_HOME="${TRYOUT_HOME:-/opt/tryout}"
MARKER="${TRYOUT_HOME}/chrome-path"

if [ -s "${MARKER}" ] && [ -x "$(cat "${MARKER}")" ]; then
  echo "✅ tryout browser already installed: $(cat "${MARKER}")"
  exit 0
fi

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo > /dev/null; then
    sudo "$@"
  else
    echo "❌ need root (or sudo) to run: $*" >&2
    exit 1
  fi
}

export DEBIAN_FRONTEND=noninteractive

if command -v apt-get > /dev/null; then
  echo "📦 Installing fonts"
  as_root apt-get update -qq
  as_root apt-get install -y -qq fonts-liberation fonts-noto-color-emoji
else
  echo "⚠️  no apt-get — skipping fonts; screenshots may render tofu"
fi

as_root mkdir -p "${TRYOUT_HOME}"
as_root chown "$(id -u):$(id -g)" "${TRYOUT_HOME}"
cd "${TRYOUT_HOME}"
[ -f package.json ] || npm init -y > /dev/null

echo "📦 Installing puppeteer and its matched Chrome"
PUPPETEER_CACHE_DIR="${TRYOUT_HOME}/chrome"
export PUPPETEER_CACHE_DIR
PUPPETEER_SKIP_DOWNLOAD=1 npm install --silent --no-fund --no-audit puppeteer

# --install-deps pulls Chrome's shared libraries through apt, which needs root.
as_root env PUPPETEER_CACHE_DIR="${PUPPETEER_CACHE_DIR}" PATH="${PATH}" \
  npx puppeteer browsers install chrome --install-deps
as_root chown -R "$(id -u):$(id -g)" "${TRYOUT_HOME}"

CHROME="$(node -e 'process.stdout.write(require("puppeteer").executablePath())')"
[ -x "${CHROME}" ] || {
  echo "❌ puppeteer reports ${CHROME}, which is not executable" >&2
  exit 1
}

echo "🧪 Smoke test"
TRYOUT_CHROME="${CHROME}" node -e '
  const puppeteer = require("puppeteer")
  puppeteer
    .launch({ executablePath: process.env.TRYOUT_CHROME, args: ["--no-sandbox"] })
    .then(async (browser) => {
      console.log("✅", await browser.version())
      await browser.close()
    })
    .catch((failure) => {
      console.error("❌", failure)
      process.exit(1)
    })
'

printf '%s' "${CHROME}" > "${MARKER}"
echo "✅ wrote ${MARKER}"
