# cache-bust: 2026-04-16a
FROM node:20-slim AS frontend-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-slim
# Build tools + Chromium for Puppeteer (system Chrome avoids 170MB bundled download)
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*
# Tell Puppeteer to use system Chromium rather than downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm install
COPY server/ ./server/
COPY --from=frontend-build /app/client/dist ./client/dist
EXPOSE 3001
CMD ["node", "server/index.js"]
