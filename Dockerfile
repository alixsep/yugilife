# The Rust core, compiled to WebAssembly for the yugilife-core package. The package's own build
# script runs here, so it needs Node beside Rust.
FROM node:24.11.1-slim AS node
FROM rust:1.98.1-slim AS core
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY rust-toolchain.toml ./
RUN rustup toolchain install
COPY Cargo.toml Cargo.lock rustfmt.toml ./
COPY .cargo .cargo
COPY crates crates
COPY scripts/run-command.mjs scripts/
COPY packages/yugilife-core/scripts packages/yugilife-core/scripts
RUN node packages/yugilife-core/scripts/build-wasm.mjs

FROM ghcr.io/pnpm/pnpm:11.9.0 AS build
RUN pnpm runtime set node 24.11.1 -g
WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
COPY --from=core /app/packages/yugilife-core/wasm/yugilife_core.wasm /tmp/yugilife_core.wasm
RUN YUGILIFE_CORE_WASM=/tmp/yugilife_core.wasm pnpm build:pages

FROM nginx:1.31.5-alpine3.24 AS serve
COPY --from=build /app/apps/yugilife/dist /usr/share/nginx/html/yugilife
COPY apps/yugilife/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
