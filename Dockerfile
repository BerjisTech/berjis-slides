# Build stage
FROM node:20-alpine AS build
WORKDIR /workspace
COPY clients/angular-auth ./clients/angular-auth
WORKDIR /workspace/file-management/slides
COPY file-management/slides/package.json ./package.json
COPY file-management/slides/yarn.lock ./yarn.lock
RUN corepack enable \
 && if [ -f yarn.lock ]; then yarn install --immutable; else yarn install; fi \
 && ln -s /workspace/file-management/slides/node_modules /workspace/node_modules
COPY file-management/slides/ .
RUN yarn build

# Runtime stage
FROM nginx:1.27-alpine
# Angular 17+ application builder outputs browser assets under dist/<app>/browser
COPY --from=build /workspace/file-management/slides/dist/slides/browser /usr/share/nginx/html
COPY file-management/slides/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
