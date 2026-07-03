# Combined Aurboda image - web frontend + backend API
# Uses nginx to serve static files and proxy /api to the Node.js backend

# Build stage - builds api-spec and web frontend
FROM node:25-alpine AS builder
RUN npm install -g pnpm@10
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

# Install nginx + fontconfig (librsvg, via sharp, needs a registered font to
# rasterize SVG <text> in server-rendered images — the base image ships none).
RUN apk add --no-cache nginx fontconfig

# Install pnpm
RUN npm install -g pnpm@10

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

# Register the bundled Liberation fonts so librsvg/sharp can render SVG text
# (feed chart images) instead of tofu boxes — the base image has no fonts.
RUN mkdir -p /usr/share/fonts/liberation \
 && cp apps/backend/src/assets/fonts/*.ttf /usr/share/fonts/liberation/ \
 && fc-cache -f

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
# Lets the backend serve /u/* share pages with crawler-visible <head> meta by
# injecting into the same index.html nginx serves.
ENV WEB_INDEX_PATH=/usr/share/nginx/html/index.html
EXPOSE 80

CMD ["/entrypoint.sh"]
