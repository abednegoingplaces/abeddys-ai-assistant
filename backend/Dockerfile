FROM node:22-bookworm-slim

# System Chromium for whatsapp-web.js, OpenSSL for Prisma, CA certs for TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates openssl fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROMIUM_LOW_MEMORY=true \
    NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Keep Node's heap small so Chromium has room on a 512 MB instance.
CMD ["node", "--max-old-space-size=160", "dist/index.js"]
