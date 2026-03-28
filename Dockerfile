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
RUN npm ci --ignore-scripts 2>/dev/null || npm install
COPY client/ ./
RUN npm run build

# ─── Stage 2: Production server ───────────────────────────────────────
FROM node:20-slim

# Install chromium for Puppeteer (optional — for auto-scraper)
RUN apt-get update && apt-get install -y \
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
    python3 \
    make \
    g++ \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install server dependencies
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install

# Copy server code
COPY server/ ./server/

# Copy built frontend
COPY --from=frontend-build /app/client/dist ./client/dist

# Setup database if it doesn't exist
RUN cd server && node setup-db.js

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:3001/api/scoring || exit 1

# Start server
WORKDIR /app/server
CMD ["node", "index.js"]
