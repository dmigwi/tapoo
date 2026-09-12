FROM node:24-bookworm-slim AS build

RUN corepack enable \
    && corepack prepare pnpm@11.25.0 --activate

WORKDIR /workspace

COPY package.json *.yaml ./

RUN pnpm install \
    --frozen-lockfile \
    --config.confirmModulesPurge=false

COPY . .

RUN pnpm run build:frontend

FROM nginx:1.27-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/public /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
