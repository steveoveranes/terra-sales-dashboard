# ---------- build the frontend ----------
FROM node:22-bookworm AS webbuild
WORKDIR /app/web
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---------- build the backend ----------
FROM node:22-bookworm AS serverbuild
WORKDIR /app/server
COPY server/package.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# ---------- runtime ----------
FROM node:22-bookworm AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
COPY server/package.json ./
RUN npm install --omit=dev
COPY --from=serverbuild /app/server/dist ./dist
COPY --from=webbuild /app/web/dist ./web-dist
RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "dist/index.js"]
