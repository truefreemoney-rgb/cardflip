# node:sqlite requires Node 22.5+; pin to a recent LTS-track image so it
# matches the Node 24 this app was developed and tested against locally.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
