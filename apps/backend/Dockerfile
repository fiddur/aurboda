# Build stage
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

WORKDIR /app

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/api-spec/package.json ./packages/api-spec/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files and build api-spec
COPY tsconfig.json ./
COPY packages/api-spec ./packages/api-spec
RUN pnpm --filter @aurboda/api-spec build

# Production stage
FROM node:22-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

WORKDIR /app

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/api-spec/package.json ./packages/api-spec/

# Install dependencies (tsx is in devDependencies but needed at runtime)
RUN pnpm install --frozen-lockfile

# Copy built api-spec from builder
COPY --from=builder /app/packages/api-spec/dist ./packages/api-spec/dist

# Copy source (we run TypeScript directly with tsx)
COPY tsconfig.json ./
COPY apps/backend/src ./apps/backend/src

EXPOSE 3000

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "aurboda-backend", "start"]
