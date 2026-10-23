# Foocus Team — one container: Express backend that also serves the built frontend.
# Built and run by Render (see render.yaml); works with any Docker host.

# ── Stage 1: Build frontend ──────────────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npx vite build

# ── Stage 2: Build backend ───────────────────────────────────────────
FROM node:22-alpine AS backend-build
# bcrypt/sharp may need to compile native modules
RUN apk add --no-cache python3 make g++ openssl
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npx prisma generate
RUN npx tsc --noEmitOnError
RUN test -f dist/index.js
# Drop dev dependencies for the production image (keeps the generated Prisma client)
RUN npm prune --omit=dev

# ── Stage 3: Production image ────────────────────────────────────────
FROM node:22-alpine AS production
RUN apk add --no-cache openssl
RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup
WORKDIR /app

COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/package.json ./
COPY --from=backend-build /app/backend/prisma ./prisma

# Frontend build output, served by Express in production
COPY --from=frontend-build /app/frontend/dist ./public

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh && mkdir -p uploads/avatars && chown -R appuser:appgroup /app
USER appuser

ENV NODE_ENV=production
# Render sets PORT itself; this is the fallback for other hosts
ENV PORT=10000
EXPOSE 10000

ENTRYPOINT ["./entrypoint.sh"]
