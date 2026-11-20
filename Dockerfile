# Works on Railway, Render, Fly.io or any Docker host. Attach a persistent volume mounted at /data
# (SQLite database + private recordings live there; without a volume, every redeploy wipes results).
# No VOLUME instruction on purpose: Railway rejects it; the host attaches the volume.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/data/assessment.db STORAGE_DIR=/data/storage PORT=3000
COPY --from=build /app ./
EXPOSE 3000
CMD ["sh", "-c", "npx next start -p ${PORT}"]
