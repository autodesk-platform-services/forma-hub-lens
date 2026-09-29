# Forma Hub Lens — container image.
#
# Node 24 is required: the app stores its cache in the built-in node:sqlite
# module, so there is no native dependency to compile and no database server
# to run alongside it.
#
# The cache lives on a volume at /data. Mount one — without it the uploaded
# extract, the activity cache and all sessions are lost on every restart.

# ---- deps ----------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---- build ---------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
# Build-time placeholders: the real values are supplied at runtime. They exist
# only so module-load-time config checks don't fail during the build.
ENV APS_CLIENT_ID=build \
    APS_CLIENT_SECRET=build \
    APS_CALLBACK_URL=http://localhost:3000/api/aps/callback \
    FORMA_HUB_ID=00000000-0000-0000-0000-000000000000 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime -------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data

RUN addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S nextjs -G nodejs \
 && mkdir -p /data && chown -R nextjs:nodejs /data

# standalone output carries its own minimal node_modules
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

# Hosts that inject their own PORT would otherwise fail a probe
# hard-coded to 3000, so read it back from the environment.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
