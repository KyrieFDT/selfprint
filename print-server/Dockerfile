FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache libreoffice

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY public/ ./public/
RUN mkdir -p uploads

EXPOSE 3000

CMD ["node", "src/index.js"]
