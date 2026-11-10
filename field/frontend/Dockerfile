# Field web - static React build served by unprivileged nginx, which also
# proxies /api to the Field API on the internal app network.
# The build output is static files, identical on every architecture, so the build
# stage runs natively on the build host; only the nginx stage is per-platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
