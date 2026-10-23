# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Install all dependencies needed for compiling TypeScript
COPY package*.json ./
RUN npm ci

# Copy configuration and source code
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to dist/
RUN npm run build

# ── Stage 2: Production Runner ──────────────────────────────
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Install production dependencies only (bcrypt compiles natively on Debian slim)
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript output from builder stage
COPY --chown=node:node --from=builder /app/dist ./dist

# Run as non-root user
USER node

EXPOSE 8080

# Healthcheck hitting GET /health using Node 22 built-in fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8080) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
