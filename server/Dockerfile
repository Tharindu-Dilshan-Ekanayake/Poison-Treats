# Game server image for Bloxity hosting. Build from the repo root, since the server
# reads ../shared/gameData.json:
#   docker build -f server/Dockerfile -t guess-my-number-server .
FROM node:22-alpine

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY shared /app/shared
COPY server/src ./src

ENV NODE_ENV=production
# Bloxity injects PORT (2567); this is only the fallback.
ENV PORT=2567
EXPOSE 2567

# Bloxity hosting requires a non-root user.
USER node
CMD ["node", "src/server.js"]
