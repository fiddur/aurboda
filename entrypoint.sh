#!/bin/sh
# Combined entrypoint: runs both backend and nginx
# Container exits if either process dies

set -e

cleanup() {
    echo "Shutting down..."
    kill $BACKEND_PID $NGINX_PID 2>/dev/null || true
    exit ${1:-0}
}

trap 'cleanup 0' SIGTERM SIGINT

# Generate runtime config for frontend (API is now relative)
cat > /usr/share/nginx/html/config.js << 'EOF'
window.__RUNTIME_CONFIG__ = {
  API_URL: "/api"
};
EOF

# Start backend (binds to 127.0.0.1:3000, only accessible via nginx proxy)
cd /app && pnpm --filter aurboda-backend start &
BACKEND_PID=$!

# Give backend a moment to start
sleep 2

# Start nginx
nginx -g 'daemon off;' &
NGINX_PID=$!

echo "Aurboda started - backend PID: $BACKEND_PID, nginx PID: $NGINX_PID"

# Monitor both processes - exit if either dies
while kill -0 $BACKEND_PID 2>/dev/null && kill -0 $NGINX_PID 2>/dev/null; do
    sleep 2
done

echo "Process exited unexpectedly"
cleanup 1
