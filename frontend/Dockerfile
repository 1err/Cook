# Multi-stage: build then serve with standalone output.
# Override base when Docker Hub flakes (502 on auth): docker compose build --build-arg NODE_IMAGE=node:20-alpine
# Or set NODE_IMAGE in a root `.env` file for compose substitution.
ARG NODE_IMAGE=node:20-alpine
FROM ${NODE_IMAGE} AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Re-declare for this stage (Dockerfile ARG scope across FROM).
ARG NODE_IMAGE=node:20-alpine
FROM ${NODE_IMAGE} AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Standalone: server + minimal node_modules. Static assets in public/ must be copied explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
