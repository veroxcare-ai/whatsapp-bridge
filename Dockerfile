# VEROX WhatsApp bridge (Baileys).
# git + build tools are required: Baileys pulls a GitHub dependency (libsignal)
# that npm must clone (git) and may compile (python3/make/g++).
# Debian (node:20-slim) is used instead of alpine for reliable native builds.
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      git python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 8787
CMD ["node", "server.js"]
