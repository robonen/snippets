# ── Сборка ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
RUN npm install -g pnpm@11
WORKDIR /src

COPY vite-layers/ vite-layers/
COPY sync-crdt/ sync-crdt/
COPY brain/ brain/

# Порядок обязателен: brain резолвит соседей по link: на СОБРАННЫЕ dist'ы.
RUN cd vite-layers && pnpm install --frozen-lockfile && pnpm build
RUN cd sync-crdt && pnpm install --frozen-lockfile && pnpm -r build
RUN cd brain && pnpm install --frozen-lockfile \
  && pnpm --filter @brain/web build \
  && pnpm --filter @brain/server build

# ── Рантайм ──────────────────────────────────────────────────────────────────
FROM node:24-alpine
# .output самодостаточен: nitro бандлит зависимости, public несёт PWA.
COPY --from=build /src/brain/apps/server/.output /app

# Данные лендов — на томе: в Proxmox он монтируется на вкладке Disks при
# создании контейнера. Остальные переменные (SYNC_TOKEN, PUBLIC_ORIGIN, PORT)
# задаются в Options уже созданного контейнера.
ENV DATA_DIR=/data \
    PORT=3000 \
    NODE_ENV=production
VOLUME /data
EXPOSE 3000

CMD ["node", "/app/server/index.mjs"]
