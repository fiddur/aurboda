#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${HERE}/docker-compose.yml"

TRYOUT_DIR="${TRYOUT_DIR:-/tmp/tryout}"
TRYOUT_PORT="${TRYOUT_PORT:-8080}"
export TRYOUT_PORT

PURGE=no
for argument in "$@"; do
  case "${argument}" in
    --purge) PURGE=yes ;;
    *)
      echo "❌ unknown argument ${argument} — the only flag is --purge" >&2
      exit 2
      ;;
  esac
done

# Compose interpolates the required variables even for `down`, where their
# values are irrelevant: the project name is what decides what gets removed.
export AURBODA_TAG="${AURBODA_TAG:-develop}"
export PGPASSWORD="${PGPASSWORD:-unused}"
export SESSION_SECRET="${SESSION_SECRET:-unused}"

if docker info > /dev/null 2>&1; then
  if [ "${PURGE}" = yes ]; then
    echo "🛑 stopping aurboda-tryout-cloud and dropping its volume"
    docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans
  else
    echo "🛑 stopping aurboda-tryout-cloud (the database volume stays)"
    docker compose -f "${COMPOSE_FILE}" down --remove-orphans
  fi
else
  echo "⚠️  no Docker daemon — nothing to stop"
fi

if [ "${PURGE}" = yes ]; then
  rm -rf "${TRYOUT_DIR}"
  echo "🧹 removed ${TRYOUT_DIR}"
fi
