#!/usr/bin/env bash
# SessionStart hook for Claude Code on the web (claude.ai/code).
#
# The cloud VM ships Node 20–22 and an empty node_modules. This installs the
# Node major pinned in .nvmrc, the pnpm pinned in package.json, the workspace
# dependencies, and builds @aurboda/api-spec (backend and web import its dist).
# Outside the cloud it exits at once.
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

NODE_MAJOR="$(sed 's/^v//; s/\..*//' .nvmrc | tr -d '[:space:]')"
PREFIX="/opt/node${NODE_MAJOR}"

if [ ! -x "${PREFIX}/bin/node" ]; then
  echo "📦 Installing Node ${NODE_MAJOR} into ${PREFIX}"
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  sums="$(curl -fsSL "${base}/SHASUMS256.txt")"
  tarball="$(printf '%s\n' "${sums}" | awk '/linux-x64\.tar\.xz$/ { print $2 }')"
  tmp="$(mktemp -d)"
  curl -fsSL "${base}/${tarball}" -o "${tmp}/${tarball}"
  (cd "${tmp}" && printf '%s\n' "${sums}" | grep " ${tarball}\$" | sha256sum -c -)
  mkdir "${tmp}/node"
  tar -xJf "${tmp}/${tarball}" -C "${tmp}/node" --strip-components=1
  rm -rf "${PREFIX}"
  mv "${tmp}/node" "${PREFIX}"
  rm -rf "${tmp}"
fi

export PATH="${PREFIX}/bin:${PATH}"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"${PREFIX}/bin:\$PATH\"" >> "${CLAUDE_ENV_FILE}"
fi

PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")"
if [ "$(pnpm --version 2>/dev/null || true)" != "${PNPM_VERSION}" ]; then
  echo "📦 Installing pnpm ${PNPM_VERSION}"
  npm install --global --silent "pnpm@${PNPM_VERSION}"
fi

# Backend integration tests use testcontainers (postgis/postgis). The VM has
# dockerd installed but not running; start it in the background if it is not.
if command -v dockerd >/dev/null && ! docker ps >/dev/null 2>&1; then
  echo "🐳 Starting dockerd"
  nohup dockerd > /tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 20); do
    docker ps >/dev/null 2>&1 && break
    sleep 1
  done
  docker ps >/dev/null 2>&1 || echo "⚠️  dockerd did not come up; see /tmp/dockerd.log" >&2
fi

# @flow-js/garmin-connect is a github: dependency, which pnpm fetches as a
# tarball from codeload.github.com. The session's GitHub proxy answers 403 for
# repositories not attached to the session; that is policy, not something to
# route around.
if ! pnpm install --frozen-lockfile; then
  echo "❌ pnpm install failed. A 403 from codeload.github.com is the session's GitHub" >&2
  echo "   proxy: it serves tarballs only for repositories attached to the session, and" >&2
  echo "   fiddur/garmin-connect is not. See 'Running in the cloud' in AGENTS.md." >&2
  exit 1
fi

pnpm --filter @aurboda/api-spec build

echo "✅ node $(node --version), pnpm $(pnpm --version), api-spec built"
