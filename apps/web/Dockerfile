# Monorepo-aware Next.js Dockerfile (build context must be repo root).
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS builder
WORKDIR /repo
RUN npm install --global npm@11.19.1 --no-audit --no-fund
ARG NEXT_PUBLIC_API_BASE=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}

# Workspace manifests
COPY package.json package-lock.json .npmrc ./

# Local workspace packages + web app
COPY packages ./packages
COPY apps/web ./apps/web

# Workspace install and web build
RUN npm ci --workspace @cooking/web --include-workspace-root --no-audit --no-fund
RUN npm --workspace @cooking/design-tokens run build
RUN npm --workspace @cooking/web run build

FROM ${NODE_IMAGE} AS runner
RUN npm install --global npm@11.19.1 --no-audit --no-fund
WORKDIR /repo

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Runtime manifests + source needed for workspace dependency resolution
COPY package.json package-lock.json .npmrc ./
COPY packages ./packages
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web/next.config.mjs ./apps/web/next.config.mjs
COPY apps/web/public ./apps/web/public

# Install only production deps for the web workspace
RUN npm ci --omit=dev --workspace @cooking/web --include-workspace-root=false --no-audit --no-fund

# Copy built app output
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next ./apps/web/.next
COPY --from=builder /repo/apps/web/next-env.d.ts ./apps/web/next-env.d.ts
COPY --from=builder /repo/apps/web/tsconfig.json ./apps/web/tsconfig.json

USER nextjs

EXPOSE 3000

CMD ["npm", "--workspace", "@cooking/web", "run", "start"]
