# syntax=docker/dockerfile:1

FROM node:22-bookworm AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx prisma generate \
  && npm run build \
  && mkdir -p dist/generated \
  && cp -R src/generated/prisma dist/generated/prisma

# Runtime: Playwright browsers + Chromium deps for Winline scrapes
FROM mcr.microsoft.com/playwright:v1.62.0-jammy
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh \
  && npx playwright install chromium

EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
