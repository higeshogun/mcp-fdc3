# Build context: repo root
# docker build -t frontend -f demos/frontend-platform/Dockerfile .

FROM nginx:1.27-alpine

COPY demos/frontend-platform/dist /usr/share/nginx/html
COPY demos/frontend-platform/nginx.conf /etc/nginx/conf.d/default.conf

# Copy standalone demo apps into nginx html so they're served as static files
COPY demos/frontend-app-blotter /usr/share/nginx/html/demos/frontend-app-blotter
COPY demos/frontend-app-trade-blotter /usr/share/nginx/html/demos/frontend-app-trade-blotter
COPY demos/frontend-app-order-ticket /usr/share/nginx/html/demos/frontend-app-order-ticket
COPY demos/frontend-app-rfq /usr/share/nginx/html/demos/frontend-app-rfq
COPY demos/frontend-app-news /usr/share/nginx/html/demos/frontend-app-news
COPY demos/frontend-app-watchlist /usr/share/nginx/html/demos/frontend-app-watchlist
COPY demos/frontend-app-chart /usr/share/nginx/html/demos/frontend-app-chart
COPY demos/frontend-app-positions /usr/share/nginx/html/demos/frontend-app-positions
COPY demos/frontend-app-account /usr/share/nginx/html/demos/frontend-app-account

# Place entrypoint script in nginx's entrypoint.d directory so it runs at startup
COPY demos/frontend-platform/docker-entrypoint.sh /docker-entrypoint.d/40-inject-env.sh
RUN chmod +x /docker-entrypoint.d/40-inject-env.sh

EXPOSE 8080
