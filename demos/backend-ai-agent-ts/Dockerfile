# Build context: repo root
# docker build -t ai-agent -f demos/backend-ai-agent-ts/Dockerfile .

FROM node:20-alpine
WORKDIR /app

# Copy workspace manifests so npm can resolve the workspace graph
COPY package*.json ./
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
COPY demos/backend-ai-agent-ts/package.json ./demos/backend-ai-agent-ts/
COPY demos/backend-mcp-server-ts/package.json ./demos/backend-mcp-server-ts/
COPY demos/frontend-platform/package.json ./demos/frontend-platform/

# Install all dependencies (devDeps included for vite-node)
RUN npm install

# Copy source for the workspace library and the service itself
COPY packages/server ./packages/server
COPY demos/backend-ai-agent-ts ./demos/backend-ai-agent-ts

# Build the @mcp-fdc3/server library (workspace dependency)
RUN npm run build --workspace=packages/server

ENV NODE_ENV=production
EXPOSE 4000

CMD ["./node_modules/.bin/tsx", "demos/backend-ai-agent-ts/src/index.ts"]
