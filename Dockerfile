# Tested with Bun 1.4. Any Bun 1.2 or newer includes the built-in Postgres client used here.
FROM oven/bun:1
WORKDIR /app
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "src/server.ts"]
