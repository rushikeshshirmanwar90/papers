# ============================================
# Stage 1: Dependencies Installation Stage
# ===========================================

# IMPORTANT: Node.js Version Maintenance
# package.json pins "engines.node" to 22.x, so this uses the Node 22 LTS line.
# Keep the NODE_VERSION ARG on the latest 22.x slim image for security fixes.
ARG NODE_VERSION=22-slim

FROM node:${NODE_VERSION} AS dependencies

# Set working directory
WORKDIR /app

# Copy package-related files first to leverage Docker's caching mechanism
COPY package.json package-lock.json .npmrc* ./

# Install project dependencies with frozen lockfile for reproducible builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ============================================
# Stage 2: Build Next.js application in standalone mode
# ============================================

FROM node:${NODE_VERSION} AS builder

# Set working directory
WORKDIR /app

# Copy project dependencies from dependencies stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy application source code
COPY . .

ENV NODE_ENV=production
# Makes next.config.mjs emit .next/standalone
ENV NEXT_OUTPUT=standalone

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# src/lib/db.ts throws at import without MONGODB_URI, and `next build` imports
# the API routes. This placeholder is only for the build; it is not kept.
# The real value is supplied when the container runs.
ARG MONGODB_URI=mongodb://localhost:27017/build-placeholder
ENV MONGODB_URI=$MONGODB_URI

# Build Next.js application
RUN npm run build

# ============================================
# Stage 3: Run Next.js application
# ============================================

FROM node:${NODE_VERSION} AS runner

# Set working directory
WORKDIR /app

# Headless Chromium prints the question-paper PDFs (src/lib/questionPaper/render.ts
# uses CHROME_PATH when set). Fonts cover Latin, Greek and math symbols.
# Chrome's sandbox needs privileges a default container doesn't have, so
# CHROME_PATH points at a small wrapper that adds --no-sandbox.
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-core fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox --disable-dev-shm-usage "$@"\n' > /usr/local/bin/chromium-nosandbox \
    && chmod +x /usr/local/bin/chromium-nosandbox
ENV CHROME_PATH=/usr/local/bin/chromium-nosandbox

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# Copy production assets
COPY --from=builder --chown=node:node /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown node:node .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Switch to non-root user for security best practices
USER node

# Expose port 3000 to allow HTTP traffic
EXPOSE 3000

# Start Next.js standalone server
CMD ["node", "server.js"]
