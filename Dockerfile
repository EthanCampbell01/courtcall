# ─── CourtCall Dockerfile ──────────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 make g++ \
    chromium fonts-liberation libgbm1 libasound2 \
    libatk-bridge2.0-0 libgtk-3-0 libnss3 libx11-xcb1 \
    libxcomposite1 libxrandr2 \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install

COPY server/ ./server/
COPY --from=frontend-build /app/client/dist ./client/dist

EXPOSE 3001
CMD ["node", "/app/server/index.js"]
