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
  path_line="export PATH=\"${PREFIX}/bin:\$PATH\""
  grep -qxF "${path_line}" "${CLAUDE_ENV_FILE}" 2>/dev/null || echo "${path_line}" >> "${CLAUDE_ENV_FILE}"
fi

PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")"
if [ "$(pnpm --version 2>/dev/null || true)" != "${PNPM_VERSION}" ]; then
  echo "📦 Installing pnpm ${PNPM_VERSION}"
  npm install --global --silent "pnpm@${PNPM_VERSION}"
fi

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

# A dockerd that died, or a VM restored from a snapshot, leaves its pid files
# behind; once the pid is recycled the next dockerd refuses to start or waits
# for a containerd that is never started.
clear_stale_pid() {
  local file="$1" expected="$2"
  shift 2
  [ -f "${file}" ] || return 0
  [ "$(ps -p "$(cat "${file}")" -o comm= 2>/dev/null || true)" = "${expected}" ] && return 0
  as_root rm -f "${file}" "$@"
  echo "🧹 removed stale ${file}"
}

# Backend integration tests use testcontainers (postgis/postgis). The VM has
# dockerd installed but not running; start it in the background if it is not.
if command -v dockerd >/dev/null && ! docker ps >/dev/null 2>&1; then
  clear_stale_pid /var/run/docker.pid dockerd /var/run/docker.sock
  clear_stale_pid /var/run/docker/containerd/containerd.pid containerd
  echo "🐳 Starting dockerd"
  nohup dockerd > /tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 20); do
    docker ps >/dev/null 2>&1 && break
    sleep 1
  done
  docker ps >/dev/null 2>&1 || echo "⚠️  dockerd did not come up; see /tmp/dockerd.log" >&2
fi

# Every dependency comes from registry.npmjs.org. A failure here is the
# environment's network policy, not something to route around.
if ! pnpm install --frozen-lockfile; then
  echo "❌ pnpm install failed. See 'Running in the cloud' in AGENTS.md." >&2
  exit 1
fi

pnpm --filter @aurboda/api-spec build

echo "✅ node $(node --version), pnpm $(pnpm --version), api-spec built"
