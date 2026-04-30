# Next.js + Python OR-Tools solver in a single container.
# Build context is the `web/` directory.
FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 python3-venv python3-pip \
        sqlite3 openssl ca-certificates curl tini && \
    rm -rf /var/lib/apt/lists/*

# Isolated Python env so pip works on Debian 12 (PEP 668).
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir ortools openpyxl

WORKDIR /app

# Install ALL deps (dev + prod) — needed for `next build` and `prisma generate`.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build.
COPY . .
# Small VPS (≈1 GB RAM): cap Node heap so `next build` uses swap instead of OOM-killing the host.
RUN export NODE_OPTIONS="--max-old-space-size=1536" NEXT_TELEMETRY_DISABLED=1 && \
    npx prisma generate && npm run build

# Trim dev deps from the final image.
RUN npm prune --omit=dev && npm cache clean --force

# Persistent SQLite lives on a mounted volume at /app/data.
ENV NODE_ENV=production
ENV DATABASE_URL="file:/app/data/data.db"
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

# tini as PID 1 for clean signal handling; seed accounts+migrations on boot.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "mkdir -p /app/data && npx prisma migrate deploy && npm start"]
