FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci

FROM node:20-alpine AS runtime
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/worker ./apps/worker
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
USER node
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "apps/worker/src/server.ts"]
