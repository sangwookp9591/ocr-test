FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# rewrites는 빌드 시점에 env를 읽음 — compose 내부 네트워크의 api 서비스로 고정
ENV RECEIPT_API=http://api:8000
RUN npm run build

# standalone 런타임만 복사 — dev deps/빌드 툴체인 제외
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
ENV PORT=3005 HOSTNAME=0.0.0.0
EXPOSE 3005
CMD ["node", "server.js"]
