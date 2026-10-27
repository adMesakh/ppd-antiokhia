FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && npm ci --omit=dev \
 && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data TRUST_PROXY=1
EXPOSE 3000
CMD ["node", "server/index.js"]
