# Build context: repo root
# docker build -t frontend -f demos/frontend-platform/Dockerfile .

# ---- Builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests for dependency resolution
COPY package*.json ./
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
COPY demos/backend-ai-agent-ts/package.json ./demos/backend-ai-agent-ts/
COPY demos/backend-mcp-server-ts/package.json ./demos/backend-mcp-server-ts/
COPY demos/frontend-platform/package.json ./demos/frontend-platform/

RUN npm install

# Copy source for workspace libraries and the frontend
COPY packages/client ./packages/client
COPY packages/server ./packages/server
COPY demos/frontend-platform ./demos/frontend-platform

# Build workspace libraries first (frontend imports from their dist/)
RUN npm run build --workspace=packages/client
RUN npm run build --workspace=packages/server

# Build the React app with a placeholder URL that will be replaced at runtime
RUN VITE_AI_AGENT_ENDPOINT=RUNTIME_REPLACE_AI_AGENT_ENDPOINT \
    npm run build --workspace=demos/frontend-platform

# ---- Production: nginx ----
FROM nginx:1.27-alpine

COPY --from=builder /app/demos/frontend-platform/dist /usr/share/nginx/html
COPY demos/frontend-platform/nginx.conf /etc/nginx/conf.d/default.conf

# Copy standalone demo apps into nginx html so they're served as static files
COPY demos/frontend-app-blotter /usr/share/nginx/html/demos/frontend-app-blotter
COPY demos/frontend-app-trade-blotter /usr/share/nginx/html/demos/frontend-app-trade-blotter
COPY demos/frontend-app-order-ticket /usr/share/nginx/html/demos/frontend-app-order-ticket
COPY demos/frontend-app-rfq /usr/share/nginx/html/demos/frontend-app-rfq
COPY demos/frontend-app-news /usr/share/nginx/html/demos/frontend-app-news
COPY demos/frontend-app-watchlist /usr/share/nginx/html/demos/frontend-app-watchlist

# Place entrypoint script in nginx's entrypoint.d directory so it runs at startup
COPY demos/frontend-platform/docker-entrypoint.sh /docker-entrypoint.d/40-inject-env.sh
RUN chmod +x /docker-entrypoint.d/40-inject-env.sh

EXPOSE 8080
