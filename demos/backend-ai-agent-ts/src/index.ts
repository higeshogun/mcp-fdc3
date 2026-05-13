import express, { Request, Response } from 'express';
import cors from 'cors';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import { loadMcpTools } from '@langchain/mcp-adapters';
import { HumanMessage, createAgent } from 'langchain';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Supported providers: openai | gemini | ollama
const AI_PROVIDER = (process.env.AI_PROVIDER ?? 'openai').toLowerCase();

const AI_AGENT_NAME = 'backend-ai-agent-ts';
const AI_AGENT_VERSION = '0.1.0';
const BACKEND_MCP_SERVER_NAME = 'backend-mcp-server-ts';
const BACKEND_MCP_SERVER_URL = process.env.BACKEND_MCP_SERVER_URL ?? 'http://localhost:3000/mcp';
const FRONTEND_PLATFORM_ORIGIN = process.env.FRONTEND_PLATFORM_ORIGIN ?? 'http://localhost:8080';

const SYSTEM_PROMPT = `You are a financial trading assistant. Always respond by calling the most appropriate tool. If no tool applies, output exactly: NO_APPLICABLE_TOOL.

Tool routing guide:
- getTrades: user asks for trades, trade history, or orders for a company/ticker. Examples: "get trades for Apple", "show trades for TSLA", "what trades are there for Microsoft"
- getNews: user asks to see news, headlines, or articles for a company/ticker. Examples: "show me NVDA news", "get news for Apple", "AAPL headlines", "what's the news on Tesla"
- submitOrder: user wants to buy or sell a stock/equity. Extract side (buy/sell), ticker, and quantity (default 100 if not specified), and order type (market or limit, default market). Examples: "buy 50 AAPL", "stage a limit buy MSFT at 412", "sell 200 TSLA", "place a market buy for NVDA"
- requestQuote: user wants to trade FX or requests a dealer quote. Examples: "request a quote for EUR/USD", "RFQ 1M EUR/USD two-way", "buy 500k GBP/USD"
- clearFilters: user wants to clear or reset filters. Examples: "clear filters", "show all", "reset", "remove filter"

Never return JSON, URLs, or links in your text response.
Never offer to find further information or suggest follow-up prompts.
The only JSON acceptable is that returned directly by tools.
Confirm actions concisely, e.g. "Trades retrieved for Apple Inc." or "Order staged: LIMIT BUY 100 MSFT @ 412."
`;


const getModel = async (): Promise<BaseChatModel> => {
  console.log(`getModel - creating model for provider: '${AI_PROVIDER}'...`);

  let model: BaseChatModel;

  switch (AI_PROVIDER) {
    case 'gemini': {
      const apiKey = requireEnv('GEMINI_API_KEY');
      const modelName = requireEnv('GEMINI_MODEL');
      model = new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey,
        temperature: 0,
        maxOutputTokens: 512,
      });
      break;
    }

    case 'ollama': {
      const modelName = requireEnv('OLLAMA_MODEL');
      const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
      model = new ChatOllama({
        model: modelName,
        baseUrl,
        temperature: 0,
      });
      break;
    }

    case 'openai':
    default: {
      const apiKey = requireEnv('OPENAI_API_KEY');
      const modelName = requireEnv('OPENAI_MODEL');
      model = new ChatOpenAI({
        model: modelName,
        openAIApiKey: apiKey,
        temperature: 0,
        maxTokens: 512,
      });
      break;
    }
  }

  console.log(`getModel - model ready (provider: ${AI_PROVIDER})`);
  return model;
};

const initHttpClient = async (): Promise<Client> => {
  console.log('initHttpClient - started initializing HTTP client for MCP Server...');
  const client = new Client({
    name: AI_AGENT_NAME,
    version: AI_AGENT_VERSION,
  });
  const transport = new StreamableHTTPClientTransport(new URL(BACKEND_MCP_SERVER_URL));
  await client.connect(transport);
  console.log('initHttpClient - completed initializing HTTP client for MCP Server');
  return client;
};

const getAgent = async (model: BaseChatModel): Promise<any> => {
  console.log('getAgent - started creating agent...');
  const httpClient = await initHttpClient();
  const tools = await loadMcpTools(BACKEND_MCP_SERVER_NAME, httpClient);
  const agent = createAgent({
    model,
    tools,
    systemPrompt: SYSTEM_PROMPT
  });
  console.log('getAgent - completed creating agent');
  return agent;
};

let chatHistory: any[] = [];


console.log(`\nStarting AI agent service (${AI_AGENT_NAME})\n`);
const model = await getModel();
const agent = await getAgent(model);
const app = express();
const port = Number(process.env.PORT) || 4000;

let allowedOrigins: boolean | string[] = true;
if (FRONTEND_PLATFORM_ORIGIN !== '*') {
  allowedOrigins = FRONTEND_PLATFORM_ORIGIN.split(',').map(o => o.trim());
}

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-client', 'authorization'],
}));
app.use(express.json());

// Health check for Cloud Run readiness probes.
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// Handle POST requests for frontend-to-agent communication e.g. from frontend-platform
app.post('/api/chat', async (req: Request, res: Response) => {
  console.log(`\n\nReceived POST /api/chat (question: '${req.body?.question}', reset: ${req.body?.reset})`);
  try {
    if (req.body?.reset) {
      chatHistory = [];
      return res.status(200).json({ status: 'ok', response: { messages: [] } });
    }

    const userPrompt = req.body?.question;
    chatHistory.push(new HumanMessage(userPrompt));

    console.log(`getResponse - invoking agent ...`);
    const response = await agent.invoke({
      messages: chatHistory,
    });
    chatHistory = response.messages;
    console.log(`getResponse - completed agent invocation`);

    return res.status(200).json({
      response
    });
  } catch (error: any) {
    console.error('Error handling chat request:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Unhandled error:', err);
  if (err instanceof SyntaxError && 'body' in err) {
    console.error('JSON parsing error:', err.message);
    return res.status(400).send({ error: 'invalid json' });
  }
  return res.status(500).send({ error: err.message || 'Internal Server Error' });
});

app.listen(port, () => {
  console.log(`\nAI agent service (${AI_AGENT_NAME}) listening at http://localhost:${port}\n`);
});
