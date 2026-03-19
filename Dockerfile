FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache python3 build-base
RUN npm install -g pnpm@latest

# Install backend deps — ALL deps (devDeps needed for tsc compilation)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/
RUN pnpm install --filter @nexotv/backend

RUN apk del python3 build-base

COPY packages/backend/ ./packages/backend/
COPY config/ ./config/

RUN pnpm --filter @nexotv/backend build

RUN mkdir -p /app/data

EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:7000/health || exit 1

CMD ["node", "packages/backend/dist/server.js"]
