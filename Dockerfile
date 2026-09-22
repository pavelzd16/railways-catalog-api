FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:22-alpine
WORKDIR /app

# npm из базового образа несёт tar с CVE-2026-59873 (critical, ловит Trivy в CI).
# 10.9.9 — та же ветка npm 10 с исправленным tar; npm нужен для npx prisma и npm run при старте.
RUN npm install -g npm@10.9.9 && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma 
COPY --from=builder /app/prisma.config.ts ./

EXPOSE 8000

# Применяем миграции и запускаем приложение
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:prod"]