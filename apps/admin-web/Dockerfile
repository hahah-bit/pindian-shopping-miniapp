FROM node:24-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY contracts/package.json contracts/package.json
COPY backend/package.json backend/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/mini-program/package.json apps/mini-program/package.json
RUN npm ci
COPY contracts contracts
COPY apps/admin-web apps/admin-web
RUN npm run build -w @pindian/contracts && npm run build -w @pindian/admin-web

FROM nginx:stable-alpine AS runtime
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/admin-web/dist /usr/share/nginx/html
EXPOSE 80
