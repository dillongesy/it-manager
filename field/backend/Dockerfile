# Field API — Node, runs as the unprivileged `node` user on a read-only root FS.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# The uploads volume inherits this ownership on first mount.
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
