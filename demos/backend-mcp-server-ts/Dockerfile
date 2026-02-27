# Build context: repo root
# docker build -t mcp-server -f demos/backend-mcp-server-ts/Dockerfile .

FROM node:20-alpine
WORKDIR /app

# Copy workspace manifests so npm can resolve the workspace graph
COPY package.json package-lock.json ./
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
COPY demos/backend-ai-agent-ts/package.json ./demos/backend-ai-agent-ts/
COPY demos/backend-mcp-server-ts/package.json ./demos/backend-mcp-server-ts/
COPY demos/frontend-platform/package.json ./demos/frontend-platform/

# Install all dependencies (devDeps included for vite-node)
RUN npm ci

# Copy source for the workspace library this service depends on, and the service itself
COPY packages/server ./packages/server
COPY demos/backend-mcp-server-ts ./demos/backend-mcp-server-ts

# Build the @mcp-fdc3/server library (required by getTrades tool)
RUN npm run build --workspace=packages/server

ENV NODE_ENV=production
EXPOSE 3000

CMD ["./node_modules/.bin/vite-node", "demos/backend-mcp-server-ts/src/index.ts"]
