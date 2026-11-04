# ---- build ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- runtime ----
FROM node:22-alpine
RUN addgroup -S emit && adduser -S emit -G emit
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER emit
EXPOSE 587 465
ENV EMIT_SMTP_HOST=0.0.0.0 \
    EMIT_SMTP_PORT=587
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "const n=require('net');const s=n.connect({host:'127.0.0.1',port:process.env.EMIT_SMTP_PORT||587},()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"
CMD ["node", "src/index.mjs"]
