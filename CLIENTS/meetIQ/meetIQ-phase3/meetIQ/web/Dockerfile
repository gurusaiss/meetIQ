# MeetIQ — Next.js presentation layer.
# Debian-based image (not alpine): the local embedding model runs on
# onnxruntime, which has no musl build.
FROM node:24-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY src ./src
COPY sample-data ./sample-data
WORKDIR /repo/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
# Shared code in ../src imports pg / @anthropic-ai/sdk / @huggingface/transformers.
# Node resolves those from /repo/node_modules, so point it at web's install.
RUN ln -s /repo/web/node_modules /repo/node_modules
COPY web/ ./
RUN npm run build

FROM node:24-slim
WORKDIR /repo
COPY --from=build /repo/src ./src
COPY --from=build /repo/sample-data ./sample-data
WORKDIR /repo/web
COPY --from=build /repo/web/node_modules ./node_modules
COPY --from=build /repo/web/.next ./.next
COPY --from=build /repo/web/package.json ./
COPY --from=build /repo/web/next.config.ts ./
RUN ln -s /repo/web/node_modules /repo/node_modules

ENV PORT=3000
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "next", "start"]
