# syntax=docker/dockerfile:1
FROM oven/bun:1.3.10 AS deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.10 AS build

WORKDIR /app

ARG VITE_COUP_WS_PORT=
ARG VITE_COUP_WS_URL=
ENV VITE_COUP_WS_PORT=$VITE_COUP_WS_PORT
ENV VITE_COUP_WS_URL=$VITE_COUP_WS_URL

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY . .

RUN bunx svelte-kit sync && bun run build

FROM oven/bun:1.3.10-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV COUP_WS_PORT=24678

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./

EXPOSE 3000 24678

CMD ["bun", "build/index.js"]
