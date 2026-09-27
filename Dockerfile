# Static SPA build. There's no web server in this image -- Caddy (already
# running as the reverse proxy in front of the backend, see ../backend's
# Caddyfile/DEPLOY.md) serves the built files directly and reverse-proxies
# /api/* to the backend container, so a second web server here would be
# redundant. This container's only job is to publish dist/ into the
# frontend_data volume Caddy mounts, then exit -- see docker-compose.yml's
# `frontend` service (restart: "no", no ports).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM alpine:3.20
COPY --from=build /app/dist /dist
CMD ["sh", "-c", "rm -rf /out/*; cp -a /dist/. /out/"]
