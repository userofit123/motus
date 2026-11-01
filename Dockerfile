# Motus server image: the API, the web app and the exercise library in one container.
# Build:  docker build -t motus .
FROM node:22-alpine AS build
WORKDIR /src
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
COPY packages/exercise-data/package.json packages/exercise-data/
RUN corepack pnpm install --frozen-lockfile --filter @motus/server... --filter @motus/web...
COPY . .
RUN corepack pnpm --filter @motus/web exec vite build
# the exercise photos (public domain), downloaded at build time
RUN node scripts/fetch-exercise-images.mjs
RUN corepack pnpm deploy --filter @motus/server --prod /out \
 && cp -r apps/web/dist /out/web && cp -r packages/exercise-data/images /out/images \
 && node -p "require('./package.json').version" > /out/VERSION

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_DIR=/app/web IMAGES_DIR=/app/images
COPY --from=build /out /app
RUN addgroup -S motus && adduser -S motus -G motus && mkdir -p /data && chown motus:motus /data
USER motus
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/version >/dev/null || exit 1
CMD ["node", "--import", "tsx", "src/index.ts"]
