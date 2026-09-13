FROM ghcr.io/pnpm/pnpm:12 AS build
RUN pnpm runtime set node 24 -g
WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build:pages

FROM nginx:alpine AS serve
COPY --from=build /app/apps/yugilife/dist /usr/share/nginx/html/yugilife
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
