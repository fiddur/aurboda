# Combined Aurboda image - web frontend + backend API
# Uses nginx to serve static files and proxy /api to the Node.js backend

# Build stage for web frontend
FROM node:22-alpine AS web-builder
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY apps/web/package.json apps/web/
COPY packages/api-spec/package.json packages/api-spec/
RUN pnpm install --frozen-lockfile
COPY packages/api-spec/ packages/api-spec/
RUN pnpm --filter @aurboda/api-spec build
COPY apps/web/ apps/web/
RUN pnpm --filter aurboda-web build

# Build stage for backend dependencies
FROM node:22-alpine AS backend-builder
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/api-spec/package.json ./packages/api-spec/
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY packages/api-spec ./packages/api-spec
RUN pnpm --filter @aurboda/api-spec build

# Production stage
FROM node:22-alpine

# Install nginx
RUN apk add --no-cache nginx

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

WORKDIR /app

# Copy workspace files and install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/api-spec/package.json ./packages/api-spec/
RUN pnpm install --frozen-lockfile

# Copy built api-spec from builder
COPY --from=backend-builder /app/packages/api-spec/dist ./packages/api-spec/dist

# Copy backend source (we run TypeScript directly with tsx)
COPY tsconfig.json ./
COPY apps/backend/src ./apps/backend/src

# Copy built web frontend
COPY --from=web-builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/http.d/default.conf

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production

# nginx listens on port 80
EXPOSE 80

CMD ["/entrypoint.sh"]
