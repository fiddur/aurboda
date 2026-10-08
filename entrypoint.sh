#!/bin/sh
# Combined entrypoint: runs both backend and nginx.
# Container exits if either process dies.
#
# On SIGTERM the backend drains first (bounded at 25 s in
# apps/backend/src/services/shutdown.ts), then nginx quits. BACKEND_STOP_TIMEOUT
# must sit between that bound and Docker's stop timeout (30 s, docs/docker.md).

set -e

BACKEND_STOP_TIMEOUT=27
NGINX_STOP_TIMEOUT=2

BACKEND_PID=
NGINX_PID=

# Send signal $2 to pid $1, then wait up to $3 seconds for it to exit before
# SIGKILLing it.
stop_process() {
    pid=$1
    [ -n "$pid" ] || return 0
    kill "-$2" "$pid" 2>/dev/null || return 0
    ( sleep "$3"; kill -KILL "$pid" 2>/dev/null ) &
    watchdog=$!
    wait "$pid" 2>/dev/null || true
    kill -KILL "$watchdog" 2>/dev/null || true
}

shutdown() {
    trap '' TERM INT
    echo "Stopping backend..."
    stop_process "$BACKEND_PID" TERM "$BACKEND_STOP_TIMEOUT"
    echo "Stopping nginx..."
    stop_process "$NGINX_PID" QUIT "$NGINX_STOP_TIMEOUT"
    echo "Stopped"
    exit "${1:-0}"
}

trap 'shutdown 0' TERM INT

# Generate runtime config for frontend (API is now relative)
cat > /usr/share/nginx/html/config.js << 'EOF'
window.__RUNTIME_CONFIG__ = {
  API_URL: "/api"
};
EOF

# node itself, not `pnpm start`: pnpm does not forward SIGTERM to its child, so
# the backend would never drain. A plain backgrounded command makes $! node's pid.
cd /app/apps/backend
PORT=3000 node src/api.ts &
BACKEND_PID=$!

# Give backend a moment to start
sleep 2

# Start nginx
nginx -g 'daemon off;' &
NGINX_PID=$!

echo "Aurboda started - backend PID: $BACKEND_PID, nginx PID: $NGINX_PID"

# Traps run only between foreground commands, so the sleep is kept short to
# react to SIGTERM within a second.
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$NGINX_PID" 2>/dev/null; do
    sleep 1
done

echo "Process exited unexpectedly"
shutdown 1
