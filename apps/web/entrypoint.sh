#!/bin/sh

# Generate runtime config from environment variables
cat > /usr/share/nginx/html/config.js << EOF
window.__RUNTIME_CONFIG__ = {
  API_URL: "${VITE_API_URL:-}"
};
EOF

# Start nginx
exec nginx -g 'daemon off;'
