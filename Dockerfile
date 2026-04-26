FROM node:24-alpine AS deps
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS builder
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node_modules/.bin/next build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache docker-cli docker-cli-compose
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]