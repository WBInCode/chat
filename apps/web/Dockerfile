# chatv2 web (Vite/React) — build statyczny serwowany przez nginx.
# nginx proxuje /api oraz /ws (socket.io) do chat-api => jeden origin (ciasteczka + WS OK).
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @chatv2/shared build
# Pusty VITE_API_URL => web używa ścieżek względnych (ten sam origin, proxy nginx).
# SSO-only: strona logowania kieruje do Huba (WB Platform); lokalna rejestracja/login wyłączone.
RUN printf 'VITE_API_URL=\nVITE_SSO_ONLY=true\nVITE_HUB_URL=https://wb-partners.pl\n' > apps/web/.env.production
RUN pnpm --filter @chatv2/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
