FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN PATCHWORK_DISABLE_RUNTIME=1 npm run build

FROM node:22-bookworm-slim
WORKDIR /app
# git is required for incident workspaces; openssl for Prisma.
RUN apt-get update && apt-get install -y --no-install-recommends openssl git ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && npm start"]
