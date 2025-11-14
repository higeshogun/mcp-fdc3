# MCP-FDC3

The **`MCP-FDC3`** library enables [FDC3](https://fdc3.finos.org/) interoperability workflows to be used together with [MCP (Model Context Protocol)](https://modelcontextprotocol.io/introduction) within AI workflows. MCP-FDC3 delivers FDC3 intents and broadcasts directly from an MCP server and actions them a frontend platform. It has the potential to elevate FDC3 experiences with intuitive chat-based AI integration.

> *This project is a very early experiment for MCP / FDC3 integration ideas, and as such has only had very limited work and testing. The intention is to inspire, to demonstrate what is possible, to uncover integration challenges, and above all to stimulate a discussion about the intersection of AI technologies/patterns and FDC3 interop.*

# Overview

MCP-FDC3 provides two libraries:

- **`server`** - utilities to generate FDC3 resources (e.g. `Fdc3Resource`) in an MCP server.
- **`client`** - functions (e.g. `handleMcpFdc3Resource`) to process the FDC3 resources and handle the automatic invocation of appropriate FDC3 API methods.

This repo also contains three associated projects that can be used to test and demonstrate the `server` and `client` libraries:

- **`backend-mcp-server-ts`** - a basic MCP Server built using [express](https://www.npmjs.com/package/express), [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), and the MCP-FDC3 `server` library.
- **`backend-ai-agent-ts`** - a basic AI Agent built using [express](https://www.npmjs.com/package/express), [langchain](https://www.npmjs.com/package/langchain) and [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk). Uses an [OpenAI](https://openai.com/) model together with the tools from the `backend-mcp-server-ts` service.
- **`frontend-platform`** - a basic chat-based frontend built using [Vite](https://vite.dev/), [React](https://react.dev/), and the MCP-FDC3 `client` library. Connects to the `backend-mcp-server-ts` service.

The key building blocks of MCP-FDC3 (FDC3 Resource, Resource Creators and Resource Handler) are explained in the following article, along with some further thoughts and open questions:

[MCP-FDC3: Integrating AI and FDC3 Workflows](https://www.linkedin.com/pulse/mcp-fdc3-integrating-ai-fdc3-workflows-derek-novavi-22rde/)

**Acknowledgement:** This embryonic library was very much inspired by the amazing work undertaken by Ido Salomon and Liad Yosef in creating the [MCP-UI](https://mcpui.dev/) SDK!

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
- In the new `.env` file set the `OPENAI_API_KEY` to your OpenAI API key

Then run the following commands:

```
cd demos/backend-ai-agent-ts
npm i
npm run dev
```

`backend-ai-agent-ts` should now be served on http://localhost:4000

### Frontend Platform

First configure the environment:

- Copy the provided `/demos/frontend-platform/example.env` file to `/demos/frontend-platform/.env`.

Then run the following commands:

```
cd demos/frontend-platform
npm i
npm run dev
```

Now simply point your browser to http://localhost:8080/ to run the Demo Frontend Platform.

In the frontend, enter a user prompt such as:
- "Get trades for apple"
- "Get trades for microsoft"

This is a basic demo, so be sure to inspect your console to see logs of the FDC3 API method invocations that happen in response to your prompts!

Now you've got this far, you can test out MCP / FDC3 integration further using the following steps:

- Create and register additional tools within `backend-mcp-server-ts` e.g. using the MCP-FDC3 Resource Creators.
- Change the `fdc3Agent` reference in `Chatbar.tsx` within `frontend-platform` to something more useful e.g. the finos/FDC3 FDC3 DA reference implementation, or your own FDC3 DA.
- Change the `iframe` in `App.tsx` within `frontend-platform` to load one of your FDC3-enabled apps, and perhaps a second FDC3-enabled app in an additional `iframe`.

### Frontend Blotter App

TODO

### Frontend News App

TODO
