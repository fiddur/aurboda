FROM node:22-alpine AS builder
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

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80
CMD ["/entrypoint.sh"]
