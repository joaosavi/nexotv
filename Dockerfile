FROM node:18-alpine

WORKDIR /app

# Build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 build-base

# Install pnpm
RUN npm install -g pnpm@latest

# Install ALL workspace deps (backend native modules + frontend Vue toolchain)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN pnpm install

# Remove build tools after native compilation
RUN apk del python3 build-base

# Build frontend (Vue + Vite)
COPY packages/frontend/ ./packages/frontend/
RUN pnpm --filter @nexotv/frontend build

# Build backend (TypeScript)
COPY packages/backend/ ./packages/backend/
RUN pnpm --filter @nexotv/backend build

# Copy runtime config and create data dir
COPY config/ ./config/
RUN mkdir -p /app/data

EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:7000/health || exit 1

CMD ["node", "--max-old-space-size=400", "packages/backend/dist/server.js"]
