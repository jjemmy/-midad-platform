# MIDAD Platform - deterministic build, no dependency resolution needed.
FROM node:22-alpine

WORKDIR /app

# The app has zero npm dependencies, so we copy the sources directly.
COPY package.json ./
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
# Default port; Railway overrides this with its own PORT variable when set.
ENV PORT=8080
EXPOSE 8080

USER node

CMD ["node", "server.js"]
