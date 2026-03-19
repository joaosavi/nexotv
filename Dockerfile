FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache python3 build-base
RUN npm install -g pnpm@latest

# Install backend dependencies (needs build-base for better-sqlite3)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/
RUN pnpm install --filter @nexotv/backend --prod

RUN apk del python3 build-base

COPY packages/backend/server.js ./packages/backend/
COPY packages/backend/src/ ./packages/backend/src/
COPY packages/backend/public/ ./packages/backend/public/
COPY config/ ./config/

RUN mkdir -p /app/data

EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:7000/health || exit 1

CMD ["node", "packages/backend/server.js"]
