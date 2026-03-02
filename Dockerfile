FROM node:18-alpine

WORKDIR /app

# Copy dependency files first (for Docker layer caching)
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy source code
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/

# Expose default port
EXPOSE 7000

# Start the server
CMD ["node", "server.js"]
