# Social and Market Data SuperApp: FinP2P Data Provider Adapter for LunarCrush
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci
COPY src ./src
COPY mock-router ./mock-router
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=4100
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY schemas ./schemas
USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "dist/src/server.js"]
