# TenancyDesk — container image
#
# There is no build step: Node 24 runs the TypeScript source directly, so the
# image is just the source, the templates and production dependencies.

FROM node:24-alpine

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# pnpm is the project's package manager.
RUN npm install --global pnpm@10 && pnpm --version

# Dependencies first, so a source change does not reinstall them.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Application code and assets.
COPY src ./src
COPY templates ./templates
COPY public ./public
COPY scripts ./scripts
COPY docs ./docs
COPY README.md LICENSE ./

# Generated documents and the database live here; mount a volume over it.
RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.ts"]
