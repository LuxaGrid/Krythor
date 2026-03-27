# Krythor Gateway — Docker image
# Build: docker build -t krythor .
# Run:   docker run -p 47200:47200 -v krythor-data:/data krythor

FROM node:22-alpine

WORKDIR /app

# Install build tools needed for native module compilation (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install pnpm
RUN npm install -g pnpm@9.15.4

# Copy dependency manifests first (layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/gateway/package.json  packages/gateway/package.json
COPY packages/control/package.json  packages/control/package.json
COPY packages/setup/package.json    packages/setup/package.json
COPY packages/memory/package.json   packages/memory/package.json
COPY packages/models/package.json   packages/models/package.json
COPY packages/core/package.json     packages/core/package.json
COPY packages/guard/package.json    packages/guard/package.json
COPY packages/skills/package.json   packages/skills/package.json

# Copy .npmrc if it exists (optional — may not be present in all setups)
COPY .npmrc* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build all packages
RUN pnpm build

# Krythor data directory — mount a volume here for persistent storage
ENV KRYTHOR_DATA_DIR=/data
VOLUME /data

# Gateway listens on port 47200
EXPOSE 47200

# Run as non-root user for security
RUN addgroup -S krythor && adduser -S krythor -G krythor
RUN chown -R krythor:krythor /app
USER krythor

# Liveness probe — pings the lightweight /healthz endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:47200/healthz || exit 1

CMD ["node", "start.js", "--no-browser"]
