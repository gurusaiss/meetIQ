# Lecture Intelligence Platform — runtime image.
# No build step: Node strips TypeScript types at runtime (per package.json scripts).
FROM node:22-alpine

WORKDIR /app

# Install production deps only (the mock/SQLite path needs none at runtime, but
# @anthropic-ai/sdk is required when LLM_PROVIDER=anthropic).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3000
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000

# Liveness probe hits the app's own /healthz (checks the datastore).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://localhost:3000/healthz" >/dev/null 2>&1 || exit 1

CMD ["node", "--experimental-strip-types", "src/web/server.ts"]
