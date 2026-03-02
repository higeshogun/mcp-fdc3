import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import z from 'zod';
import { getTrades, getNews, clearFilters, submitOrder, requestQuote } from './tools/index.js';

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors({
  origin: "*",
  allowedHeaders: [
    'content-type',
    'mcp-session-id',
    'mcp-protocol-version'
  ],
  exposedHeaders: [
    "mcp-session-id" // expose it so the Inspector can read it
  ],
}));
app.use(express.json());

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// Handle POST requests for client-to-server communication.
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    // A session already exists; reuse the existing transport.
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // This is a new initialization request. Create a new transport.
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = transport;
        console.log(`MCP Session initialized: ${sid}`);
      },
    });

    // Clean up the transport from our map when the session closes.
    transport.onclose = () => {
      if (transport.sessionId) {
        console.log(`MCP Session closed: ${transport.sessionId}`);
        delete transports[transport.sessionId];
      }
    };

    // Create a new server instance for this specific session.
    const server = new McpServer({
      name: 'backend-mcp-server-ts',
      version: '0.1.0',
    });

    // @ts-expect-error type instantiation too deep
    server.registerTool('getTrades', {
      title: 'GetTrades',
      description: 'Returns trades for a given company and raises an FDC3 ViewInstrument intent targeting the trade blotter.',
      inputSchema: {
        companyName: z.string().describe('Company name or ticker symbol'),
      },
    }, getTrades);

    // @ts-expect-error type instantiation too deep
    server.registerTool('getNews', {
      title: 'GetNews',
      description: 'Filters the news feed for a given company or instrument. Use this when the user asks to see news, headlines, or articles for a specific company or ticker symbol.',
      inputSchema: {
        companyName: z.string().describe('Company name or ticker symbol to filter news for'),
      },
    }, getNews);

    // @ts-expect-error type instantiation too deep
    server.registerTool('clearFilters', {
      title: 'ClearFilters',
      description: 'Clears all active FDC3 filters across all panels (blotter, news, watchlist). Use this when the user says "clear filters", "reset", "show all", or "remove filter".',
      inputSchema: {},
    }, clearFilters);

    // @ts-expect-error type instantiation too deep
    server.registerTool('submitOrder', {
      title: 'SubmitOrder',
      description: 'Stages a traditional order in the Order Ticket app (Equities or simple instruments). Provide the side (buy/sell), quantity, and ticker symbol. The frontend will populate the Order Ticket where the user can confirm execution.',
      inputSchema: {
        side: z.enum(['buy', 'sell']).describe('The side of the order (buy or sell)'),
        quantity: z.number().describe('The number of shares/contracts to trade'),
        ticker: z.string().describe('The ticker symbol, e.g., AAPL, MSFT'),
      },
    }, submitOrder as any);

    // @ts-expect-error type instantiation too deep
    server.registerTool('requestQuote', {
      title: 'RequestQuote',
      description: 'Stages a Request For Quote (RFQ) in the RFQ panel for OTC instruments like FX pairs (e.g. EUR/USD). Use this when the user wants to trade FX or specifically asks to request a quote from dealers. Provide side, quantity, and instrument.',
      inputSchema: {
        side: z.enum(['buy', 'sell', 'two-way']).describe('The side to request (buy, sell, or two-way)'),
        quantity: z.number().describe('The notional amount to trade (e.g. 1000000)'),
        instrument: z.string().describe('The instrument symbol, e.g., EUR/USD'),
      },
    }, requestQuote as any);

    // Connect the server instance to the transport for this session.
    await server.connect(transport);
  } else {
    return res.status(400).json({
      error: { message: 'Bad Request: No valid session ID provided' },
    });
  }

  // Handle the client's request using the session's transport.
  await transport.handleRequest(req, res, req.body);
});

// A separate, reusable handler for GET and DELETE requests.
const handleSessionRequest = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    return res.status(404).send('Session not found');
  }

  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

// Health check for Cloud Run readiness probes.
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// GET handles the long-lived stream for server-to-client messages.
app.get('/mcp', handleSessionRequest);

// DELETE handles explicit session termination from the client.
app.delete('/mcp', handleSessionRequest);

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
  console.log(`MCP endpoint available at http://localhost:${port}/mcp`);
});
