# syntax=docker/dockerfile:1

# ---------- base: shared deps layer ----------
FROM node:24-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---------- dev: Vite dev server with HMR (used by docker-compose.yml) ----------
FROM base AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]
