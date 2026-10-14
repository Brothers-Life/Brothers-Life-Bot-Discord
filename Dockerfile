# One image for every part of the bot: APP_ROLE (all, bot, api, front) or the command chooses what runs
#   node src/index.js prod   everything in one process
#   node src/bot.js prod     the Discord bot (+ periodic tasks; dials the API on API_URL)
#   node src/api.js prod     the panel's API
#   node src/front.js prod   the panel (React app) and the forwarding of /api to the API
# See docker-compose.yml and docs/architecture.md.

FROM node:22-bookworm-slim AS panel
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY assets ./assets
COPY launcher ./launcher
COPY launcher.js ./
COPY scripts/migrate-sqlite.mjs ./scripts/
COPY --from=panel /build/web/dist ./web/dist
# data/: backups of the database, TLS certificate of the front, yt-dlp/ffmpeg of the bot
RUN mkdir -p data logs && chown -R node:node data logs
USER node
VOLUME ["/app/data"]
CMD ["node", "src/start.js", "prod"]
