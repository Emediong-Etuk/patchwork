# The full (non-slim) image already ships git, openssl and CA certificates,
# which PATCHWORK needs for incident workspaces and Prisma.
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN PATCHWORK_DISABLE_RUNTIME=1 npm run build

FROM node:22-bookworm
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
# Hosts such as Railway and Render set PORT; `next start` listens on it.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && npm start"]
