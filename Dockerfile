FROM node:20-bookworm-slim AS base
WORKDIR /app

# Full workspace context is needed at install time — packages/server depends
# on the @app/shared workspace package via npm workspaces.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/plugin/package.json packages/plugin/package.json
RUN npm ci --workspace=packages/server --workspace=packages/shared --include-workspace-root

COPY packages/shared packages/shared
COPY packages/server packages/server

# Playwright needs its own Chromium build plus a pile of system libraries —
# --with-deps installs both, matched to whatever playwright version
# package-lock.json resolved (so this never drifts from a manually-picked
# base-image tag).
RUN npx --prefix packages/server playwright install --with-deps chromium

RUN npm run build --workspace=packages/server

ENV NODE_ENV=production
EXPOSE 4517
CMD ["node", "packages/server/dist/index.js"]
