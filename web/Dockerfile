FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# rewrites는 빌드 시점에 env를 읽음 — compose 내부 네트워크의 api 서비스로 고정
ENV RECEIPT_API=http://api:8000
RUN npm run build
EXPOSE 3005
CMD ["npm", "run", "start"]
