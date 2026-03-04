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

CMD ["node", "server.js"]
