# MCP-FDC3

This repo contains the MCP-FDC3 library and associated demos.

# Getting Started

## Prerequisites

The code in this repo assumes you are running [Node.js](https://nodejs.org/). It was originally built and testing using Node v24.11.0.

If you are working on other applications which rely on other versions of Node.js then use of [Node Version Manager for Linux/macOS](https://github.com/nvm-sh/nvm) or [Node Version Manager for Windows](https://github.com/coreybutler/nvm-windows) or equivalent is recommended.

## Install and Build the Libraries

### Client Library

Run the following commands:

```
cd packages/client
npm i
npm run build
```

The built `client` library should now be available in the `dist` folder.

### Server Library

Run the following commands:

```
cd packages/server
npm i
npm run build
```

The built `server` library should now be available in the `dist` folder.

## Install, Build and Run the Demos

### MCP Server

Run the following commands:

```
cd demos/backend-mcp-server-ts
npm i
npm run dev
```

The `backend-mcp-server-ts` MCP endpoint should now be available on http://localhost:3000/mcp

### AI Agent

First configure the environment:

- Copy the provided `/demos/backend-ai-agent-ts/example.env` file to `/demos/backend-ai-agent-ts/.env`.
- In the new `.env` file set the OPENAI_API_KEY to your OpenAI API key

Then run the following commands:

```
cd demos/backend-ai-agent-ts
npm i
npm run dev
```

`backend-ai-agent-ts` should now be served on http://localhost:4000

### Frontend Platform

Run the following commands:

```
cd demos/frontend-platform
npm i
npm run dev
```

### Frontend Blotter App

TODO

### Frontend News App

TODO
