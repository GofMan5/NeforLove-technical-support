# ============================================================================
# Telegram Support Bot - Multi-stage Dockerfile
# ============================================================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/
COPY drizzle/ ./drizzle/

# Build TypeScript
RUN npm run build

# ============================================================================
# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Create non-root user for security
RUN addgroup -g 1001 -S botgroup && \
    adduser -S botuser -u 1001 -G botgroup

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && \
    npm cache clean --force

# Remove build tools after npm install
RUN apk del python3 make g++

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

# Copy locales
COPY locales/ ./locales/

# Create data directory with proper permissions
RUN mkdir -p /app/data && chown -R botuser:botgroup /app

# Switch to non-root user
USER botuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# Default environment variables
ENV NODE_ENV=production \
    DATABASE_PATH=/app/data/bot.db \
    LOG_LEVEL=info \
    DEFAULT_LOCALE=ru \
    LOCALES_PATH=/app/locales

# Start the bot
CMD ["node", "dist/index.js"]
