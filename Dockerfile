# Build native dependencies (better-sqlite3) and compile TypeScript.
FROM node:26-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json .
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

# Run with the non-root node user. Mount a Fly Volume at /data for SQLite.
FROM node:26-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

RUN mkdir -p /data && chown node:node /data
USER node

CMD ["node", "dist/index.js"]
