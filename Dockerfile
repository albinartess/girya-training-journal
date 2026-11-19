FROM node:24.14.0-bookworm-slim AS verify
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY server ./server
COPY dist ./dist
COPY tests ./tests
COPY backup.test.cjs identity.test.cjs ./
RUN npm run test:ci && npm run build

FROM node:24.14.0-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/girya.sqlite
WORKDIR /app
COPY --from=verify --chown=node:node /app/node_modules ./node_modules
COPY --from=verify --chown=node:node /app/server ./server
COPY --from=verify --chown=node:node /app/dist ./dist
COPY --from=verify --chown=node:node /app/package*.json ./
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh","-c","npm run migrate && exec node server/main.cjs"]
