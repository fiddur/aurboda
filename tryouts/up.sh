#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${HERE}/docker-compose.yml"
IMAGE=fiddur/aurboda

TRYOUT_DIR="${TRYOUT_DIR:-/tmp/tryout}"
TRYOUT_PORT="${TRYOUT_PORT:-8080}"
export TRYOUT_DIR TRYOUT_PORT

STATE="${TRYOUT_DIR}/state.json"
BASE_URL="http://127.0.0.1:${TRYOUT_PORT}"
DEMO_USER="${DEMO_USER:-qsreddit_demo}"

FRESH=no
WAIT_IMAGE=no
for argument in "$@"; do
  case "${argument}" in
    --fresh) FRESH=yes ;;
    --wait-image) WAIT_IMAGE=yes ;;
    *)
      echo "❌ unknown argument ${argument} — the flags are --fresh and --wait-image" >&2
      exit 2
      ;;
  esac
done

if [ -z "${AURBODA_TAG:-}" ]; then
  echo "❌ AURBODA_TAG is required: the merge commit's 7-character sha, or 'develop'." >&2
  echo "   AURBODA_TAG=1a2b3c4 tryouts/up.sh --fresh --wait-image" >&2
  exit 2
fi
export AURBODA_TAG

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo > /dev/null; then
    sudo "$@"
  else
    echo "❌ need root (or sudo) to run: $*" >&2
    return 1
  fi
}

random_hex() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(+process.argv[1]).toString("hex"))' "$1"
}

state_field() {
  [ -f "${STATE}" ] || return 0
  node -e '
    const { readFileSync } = require("node:fs")
    try {
      const value = JSON.parse(readFileSync(process.argv[1], "utf8"))[process.argv[2]]
      if (typeof value === "string") process.stdout.write(value)
    } catch {}
  ' "${STATE}" "$1"
}

# A dead daemon (the session-start hook's, or one lost to a VM restore) leaves
# its pid file behind; once the pid is recycled the new dockerd refuses to start
# or waits for a containerd that is never started.
clear_stale_pid() {
  local file="$1" expected="$2" pid
  shift 2
  pid="$(as_root cat "${file}" 2> /dev/null)" || return 0
  [ "$(ps -p "${pid}" -o comm= 2> /dev/null || true)" = "${expected}" ] && return 0
  as_root rm -f "${file}" "$@"
  echo "🧹 removed stale ${file}"
}

# Docker's preview repository is exempt from the pull quota, so reading the
# anonymous per-IP allowance there does not spend it. Prints the remaining
# count, or nothing when it cannot tell.
dockerhub_quota_remaining() {
  local token
  token="$(curl -fsS -m 10 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:ratelimitpreview/test:pull' |
    node -e 'let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => { try { process.stdout.write(JSON.parse(s).token ?? "") } catch {} })')"
  [ -n "${token}" ] || return 1
  curl -fsSI -m 10 -H "Authorization: Bearer ${token}" \
    https://registry-1.docker.io/v2/ratelimitpreview/test/manifests/latest |
    tr -d '\r' | awk -F'[:;]' 'tolower($1) == "ratelimit-remaining" { gsub(/ /, "", $2); print $2 }'
}

if ! docker info > /dev/null 2>&1; then
  echo "🐳 no Docker daemon — starting dockerd"
  clear_stale_pid /var/run/docker.pid dockerd /var/run/docker.sock
  clear_stale_pid /var/run/docker/containerd/containerd.pid containerd
  as_root sh -c 'nohup dockerd > /tmp/dockerd.log 2>&1 &' || true
  WAITED=0
  while [ "${WAITED}" -lt 60 ] && ! docker info > /dev/null 2>&1; do
    sleep 1
    WAITED=$((WAITED + 1))
  done
fi

if ! docker info > /dev/null 2>&1; then
  echo "❌ no Docker daemon after 60s; the last lines of /tmp/dockerd.log:" >&2
  tail -n 20 /tmp/dockerd.log >&2 2> /dev/null || echo "   (there is no /tmp/dockerd.log)" >&2
  exit 1
fi

mkdir -p "${TRYOUT_DIR}"
chmod 700 "${TRYOUT_DIR}"

PGPASSWORD="$(state_field pgPassword)"
SESSION_SECRET="$(state_field sessionSecret)"
export PGPASSWORD SESSION_SECRET

if [ "${FRESH}" = yes ]; then
  echo "🧹 fresh run — dropping the stack, its volume and the old state"
  : "${PGPASSWORD:=unused}" "${SESSION_SECRET:=unused}"
  docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans
  rm -f "${STATE}" "${TRYOUT_DIR}/token.txt"
  PGPASSWORD=""
  SESSION_SECRET=""
fi

# Reused unless --fresh: the postgres volume keeps the role's old password, so a
# regenerated one would lock the app out of its own database.
[ -n "${PGPASSWORD}" ] || PGPASSWORD="$(random_hex 16)"
# createAuth rejects anything but exactly 32 bytes, which 16 hex-encoded is.
[ -n "${SESSION_SECRET}" ] || SESSION_SECRET="$(random_hex 16)"
export PGPASSWORD SESSION_SECRET

DOCKERHUB_LOGGED_IN=no
if [ -n "${DOCKERHUB_USERNAME:-}" ] && [ -n "${DOCKERHUB_TOKEN:-}" ]; then
  echo "🔑 docker login as ${DOCKERHUB_USERNAME}"
  if ! printf '%s' "${DOCKERHUB_TOKEN}" | docker login --username "${DOCKERHUB_USERNAME}" --password-stdin > /dev/null; then
    echo "❌ docker login failed for ${DOCKERHUB_USERNAME} — check DOCKERHUB_USERNAME/DOCKERHUB_TOKEN" >&2
    exit 1
  fi
  DOCKERHUB_LOGGED_IN=yes
fi

if [ "${WAIT_IMAGE}" = yes ]; then
  echo "⏳ waiting for ${IMAGE}:${AURBODA_TAG} on Docker Hub (every 60s, up to 30 min)"
  FOUND=no
  QUOTA_EXHAUSTED=no
  for attempt in $(seq 1 30); do
    if [ "${DOCKERHUB_LOGGED_IN}" = no ]; then
      if [ "$(dockerhub_quota_remaining 2> /dev/null || true)" = 0 ]; then
        if [ "${QUOTA_EXHAUSTED}" = no ]; then
          echo "⚠️  the anonymous Docker Hub quota for this egress IP is exhausted; not polling until it recovers"
        fi
        QUOTA_EXHAUSTED=yes
        sleep 60
        continue
      fi
      QUOTA_EXHAUSTED=no
    fi
    if docker manifest inspect "${IMAGE}:${AURBODA_TAG}" > /dev/null 2>&1; then
      echo "✅ image found after ~$(((attempt - 1) * 60))s"
      FOUND=yes
      break
    fi
    sleep 60
  done
  if [ "${FOUND}" != yes ] && [ "${QUOTA_EXHAUSTED}" = yes ]; then
    echo "❌ gave up on ${IMAGE}:${AURBODA_TAG}: the anonymous Docker Hub quota is exhausted." >&2
    echo "   It is per egress IP, shared with other cloud VMs, and rolls over within the hour." >&2
    echo "   A DOCKERHUB_USERNAME/DOCKERHUB_TOKEN pair in the environment lifts it." >&2
    exit 1
  fi
  if [ "${FOUND}" != yes ]; then
    echo "❌ ${IMAGE}:${AURBODA_TAG} never appeared." >&2
    echo "   .github/workflows/docker.yml only builds when apps/backend, apps/web, packages," >&2
    echo "   pnpm-lock.yaml, Dockerfile, nginx.conf or entrypoint.sh changed — a merge that" >&2
    echo "   touched none of them produces no image at all. Otherwise CI failed." >&2
    exit 1
  fi
fi

echo "📥 pulling ${IMAGE}:${AURBODA_TAG}"
docker compose -f "${COMPOSE_FILE}" pull --quiet

echo "🚀 starting aurboda-tryout-cloud on ${BASE_URL}"
if ! docker compose -f "${COMPOSE_FILE}" up -d --wait; then
  echo "❌ the stack did not come up — the last 60 log lines:" >&2
  docker compose -f "${COMPOSE_FILE}" logs --tail 60 >&2
  exit 1
fi

echo "⏳ waiting for ${BASE_URL}/api/version"
READY=no
WAITED=0
while [ "${WAITED}" -lt 120 ]; do
  if curl -fs -m 2 "${BASE_URL}/api/version" -o "${TRYOUT_DIR}/version.json"; then
    READY=yes
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done

if [ "${READY}" != yes ]; then
  echo "❌ ${BASE_URL}/api/version never answered — the last 60 log lines:" >&2
  docker compose -f "${COMPOSE_FILE}" logs --tail 60 >&2
  exit 1
fi

SERVED_SHA="$(node -e '
  const { readFileSync } = require("node:fs")
  process.stdout.write(String(JSON.parse(readFileSync(process.argv[1], "utf8")).build_sha))
' "${TRYOUT_DIR}/version.json")"

TRYOUT_STATE="${STATE}" \
  TRYOUT_BASE_URL="${BASE_URL}" \
  TRYOUT_PORT="${TRYOUT_PORT}" \
  TRYOUT_TAG="${AURBODA_TAG}" \
  TRYOUT_BUILD_SHA="${SERVED_SHA}" \
  TRYOUT_USER="${DEMO_USER}" \
  TRYOUT_PGPASSWORD="${PGPASSWORD}" \
  TRYOUT_SESSION_SECRET="${SESSION_SECRET}" \
  node -e '
    const { existsSync, readFileSync, writeFileSync } = require("node:fs")
    const path = process.env.TRYOUT_STATE
    const before = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
    const after = {
      ...before,
      baseUrl: process.env.TRYOUT_BASE_URL,
      port: Number(process.env.TRYOUT_PORT),
      tag: process.env.TRYOUT_TAG,
      buildSha: process.env.TRYOUT_BUILD_SHA,
      username: process.env.TRYOUT_USER,
      pgPassword: process.env.TRYOUT_PGPASSWORD,
      sessionSecret: process.env.TRYOUT_SESSION_SECRET,
    }
    writeFileSync(path, JSON.stringify(after, null, 2) + "\n", { mode: 0o600 })
  '
chmod 600 "${STATE}"

node "${HERE}/login.mjs"

mkdir -p "${TRYOUT_DIR}/run/shots"

echo "✅ aurboda is up"
echo "   base URL   ${BASE_URL}"
echo "   image      ${IMAGE}:${AURBODA_TAG}"
echo "   build sha  ${SERVED_SHA}"
echo "   state      ${STATE}"
echo "   token      ${TRYOUT_DIR}/token.txt"
echo "   logs       docker compose -p aurboda-tryout-cloud logs -f aurboda"
echo "   scratch    ${TRYOUT_DIR}/run (screenshots in ${TRYOUT_DIR}/run/shots)"
