# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Stage 1: build — install all deps (including build tools for better-sqlite3),
# compile TypeScript, then prune devDependencies.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS build

# better-sqlite3 needs a C++ toolchain at install time.
# python3 / make / g++ are removed in the final stage.
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy manifest first so the npm-install layer caches independently of source.
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

# -----------------------------------------------------------------------------
# Stage 2: runtime — minimal image, no build tools, non-root user.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

# Run as a non-root user. node:alpine ships a "node" user (uid/gid 1000).
WORKDIR /app

# Copy only what the server needs at runtime.
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build

USER node

# Default config — empty registry. Lets the server boot under directory
# smoke tests (Glama, Smithery) that invoke the container without mounting
# a databases.json. Users in real deployments override MCP_DB_CONFIG to
# point at their own config (e.g. /config/databases.json mounted from host).
COPY --chown=node:node docker/default-config.json /app/config.json

# MCP servers speak over stdio by default — no port to expose, no HEALTHCHECK
# that hits a port. The directory harness invokes the binary and talks
# JSON-RPC over stdin/stdout.
ENV MCP_DB_CONFIG=/app/config.json

ENTRYPOINT ["node", "/app/build/index.js"]
