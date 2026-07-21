# Lecture Intelligence Platform — Next.js presentation layer.
FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY src ./src
COPY sample-data ./sample-data
WORKDIR /repo/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-alpine
WORKDIR /repo
COPY --from=build /repo/src ./src
COPY --from=build /repo/sample-data ./sample-data
WORKDIR /repo/web
COPY --from=build /repo/web/node_modules ./node_modules
COPY --from=build /repo/web/.next ./.next
COPY --from=build /repo/web/package.json ./
COPY --from=build /repo/web/next.config.ts ./

ENV PORT=3000
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://localhost:3000/healthz" >/dev/null 2>&1 || exit 1

CMD ["npx", "next", "start"]
