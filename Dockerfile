# ─── CourtCall Dockerfile ──────────────────────────────────────────────
# Multi-stage build: build frontend, then serve everything from Node
#
# Build: docker build -t courtcall .
# Run:   docker run -p 3001:3001 -v courtcall-data:/app/server courtcall
#
# The SQLite database is stored in /app/server/courtcall.db
# Mount a volume to persist it across container restarts.

# ─── Stage 1: Build frontend ──────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build

# ─── Stage 2: Production server ───────────────────────────────────────
FROM node:20-slim

# Install build tools (needed for better-sqlite3 native compile) + chromium for scraper
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    chromium \
    fonts-liberation \
    libgbm1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxrandr2 \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install server dependencies (npm install runs postinstall which builds better-sqlite3)
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install

# Copy server code and startup script
COPY server/ ./server/
RUN chmod +x /app/server/start.sh

# Copy built frontend
COPY --from=frontend-build /app/client/dist ./client/dist

# Expose port
EXPOSE 3001

# Start via script — initialises DB on first run if needed
CMD ["sh", "/app/server/start.sh"]
