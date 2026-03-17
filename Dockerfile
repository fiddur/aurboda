# Combined Aurboda image - web frontend + backend API
# Uses nginx to serve static files and proxy /api to the Node.js backend

# Build stage - builds api-spec and web frontend
FROM node:25-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY apps/web/package.json apps/web/
COPY apps/backend/package.json apps/backend/
COPY packages/api-spec/package.json packages/api-spec/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY packages/api-spec/ packages/api-spec/
COPY apps/web/ apps/web/
RUN pnpm --filter @aurboda/api-spec build && pnpm --filter aurboda-web build

# Generate OpenAPI spec and HTML documentation
RUN pnpm --filter @aurboda/api-spec generate:openapi && pnpm --filter @aurboda/api-spec generate:html

# Production stage
FROM node:25-alpine

# Install nginx
RUN apk add --no-cache nginx

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

WORKDIR /app

# Copy workspace files and install production dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/api-spec/package.json ./packages/api-spec/
RUN pnpm install --frozen-lockfile

# Copy built api-spec from builder
COPY --from=builder /app/packages/api-spec/dist ./packages/api-spec/dist

# Copy backend source (Node 25 runs TypeScript directly via built-in type stripping)
COPY tsconfig.json ./
COPY apps/backend/src ./apps/backend/src

# Copy built web frontend
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy generated API documentation
COPY --from=builder /app/packages/api-spec/generated/api-docs.html /usr/share/nginx/html/apispec/index.html

# Copy nginx config and entrypoint
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ARG BUILD_SHA=unknown
ENV NODE_ENV=production
ENV BUILD_SHA=${BUILD_SHA}
EXPOSE 80

CMD ["/entrypoint.sh"]
