# Imagen para despliegue (Render, Fly.io, Railway, Azure). Corre el backend + front con Bun.
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "src/server.ts"]
