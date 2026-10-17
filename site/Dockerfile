# Built from the repository root (the site renders the app's components in ../src):
#   docker build -f site/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
COPY site/package.json site/package-lock.json site/
RUN cd site && npm ci
COPY src src
COPY site site
RUN cd site && npm run build

FROM node:22-alpine
WORKDIR /app
COPY site/package.json site/server.js ./
COPY --from=build /repo/site/dist dist
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
