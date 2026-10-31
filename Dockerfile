FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm check && pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/* && corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY --from=build /app /app
ENV NODE_ENV=production SAAS_MODE=1 PPT_FONT=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc PPT_TITLE_FONT=/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc
CMD ["pnpm","exec","mastra","start"]
