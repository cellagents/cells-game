FROM node:22-alpine

# git is needed by npm to resolve the @cellagents/game-protocol
# dependency, which is served as a tagged ref off its GitHub repo.
RUN apk add --no-cache git
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY package.json package-lock.json /usr/src/app/
RUN npm ci && npm cache clean --force
COPY . /usr/src/app
RUN npm run build

CMD [ "node", "bin/server/server.js" ]

HEALTHCHECK  --interval=5m --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

EXPOSE 3000
