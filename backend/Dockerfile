FROM node:24-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY contracts/package.json contracts/package.json
COPY backend/package.json backend/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/mini-program/package.json apps/mini-program/package.json
RUN npm ci
COPY contracts contracts
COPY backend backend
RUN npm run build -w @pindian/contracts && npm run build -w @pindian/backend

FROM node:24-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/package.json
COPY backend/package.json backend/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/mini-program/package.json apps/mini-program/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /workspace/backend/dist backend/dist
COPY --from=build /workspace/backend/migrations backend/migrations
COPY --from=build /workspace/contracts/dist contracts/dist
COPY contracts/openapi.yaml contracts/openapi.yaml
COPY infra/docker/health-api.cjs infra/docker/health-api.cjs
COPY infra/docker/health-worker.cjs infra/docker/health-worker.cjs
# 媒体文件目录（compose 挂载命名卷 media-data）
RUN mkdir -p /var/lib/pindian/media && chown node:node /var/lib/pindian/media
USER node
EXPOSE 3000
# 启动前执行迁移（advisory lock 保证与 worker/重试并发安全）
CMD ["sh", "-c", "node backend/dist/bootstrap/migrate.js && node backend/dist/bootstrap/main.js"]
