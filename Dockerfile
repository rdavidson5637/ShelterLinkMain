FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache postgresql-client

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p backups \
  && chown -R app:app /app

USER app

EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
