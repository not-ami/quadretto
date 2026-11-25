# Quadretto — app image. Build: `docker compose build` (or `docker build -t quadretto .`).
# The database runs in its own container (see docker-compose.yml). C/C++ execution is off in Docker:
# its sandbox (bubblewrap) needs privileges a container should not have.
ARG NODE_IMAGE=node:26-trixie-slim
FROM ${NODE_IMAGE}

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8790 RUN_SANDBOX=off
WORKDIR /app

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server/ server/
COPY public/ public/
COPY VERSION ./

# The app writes only the Pyodide package cache and the .credentials files made by `node server/admin.js create-user` (in /app).
RUN mkdir -p /app/pyodide-cache && chown node:node /app /app/pyodide-cache
USER node

EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8790/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/server.js"]
