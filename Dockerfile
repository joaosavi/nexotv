FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache python3 build-base

COPY package.json package-lock.json ./
RUN npm ci --production

RUN apk del python3 build-base

COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p /app/data

EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:7000/health || exit 1

CMD ["node", "server.js"]
