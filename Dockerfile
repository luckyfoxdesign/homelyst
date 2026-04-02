FROM oven/bun:alpine
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
RUN bun run build
EXPOSE 4321
CMD ["bun", "./dist/server/entry.mjs"]
