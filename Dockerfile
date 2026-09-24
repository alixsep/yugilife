FROM ghcr.io/pnpm/pnpm:11.9.0 AS build
RUN pnpm runtime set node 24.11.1 -g
WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build:pages

FROM nginx:1.31.5-alpine3.24 AS serve
COPY --from=build /app/apps/yugilife/dist /usr/share/nginx/html/yugilife
COPY apps/yugilife/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
