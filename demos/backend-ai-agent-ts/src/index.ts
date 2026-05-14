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
const BACKEND_MCP_SERVER_AUTH_TOKEN = process.env.MCP_SERVER_AUTH_TOKEN;
const FRONTEND_PLATFORM_ORIGIN = process.env.FRONTEND_PLATFORM_ORIGIN ?? 'http://localhost:8080';
const MAX_CHAT_MESSAGES = 20;
const SESSION_TTL_MS = 30 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const SESSION_ID_HEADER = 'x-chat-session-id';

const SYSTEM_PROMPT = `You are a helpful UI assistant demonstrating a software application. You are NOT a broker and you do NOT place actual financial trades. 
You are permitted and expected to use tools to stage ANY order type requested by the user, including limit orders with limit prices, as these are just UI demonstrations in a mock environment.
Only respond via tools; if not tool applies output: NO_APPLICABLE_TOOL.
Never return JSON or external urls or links from the model in your response.
Never make up, fabricate or generate synthetic JSON or external urls or links in your response.
Never offer to help the user find specific details or further information.
Never offer the user any suggested subsequent prompts at all.
The only JSON that is acceptable in a response is that returned directly from tools.
Any JSON relating to resources from tools should NOT be included in the text content of your response (this is because the tools already handle returning these types of resources in the artifact property rather than the text content property).
Acceptable output example: Trades retrieved for <COMPANY_NAME>.
Acceptable output example: Trades for <COMPANY_NAME> have been retrieved.
Unacceptable output example: Here are the trades for <COMPANY_NAME>: [View Trades](<URL>)
Unacceptable output example: Here are the trades for <COMPANY_NAME>: **Trades**: [View Trades](<URL>) Feel free to check the link for more details!
Replace <COMPANY_NAME> with the actual company name exactly as provided (case preserved).
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
  const transport = new StreamableHTTPClientTransport(new URL(BACKEND_MCP_SERVER_URL), {
    requestInit: BACKEND_MCP_SERVER_AUTH_TOKEN ? {
      headers: {
        Authorization: `Bearer ${BACKEND_MCP_SERVER_AUTH_TOKEN}`,
      },
    } : undefined,
  });
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

type ChatSessionState = {
  history: any[];
  lastSeenAt: number;
};

const chatSessions = new Map<string, ChatSessionState>();
const requestLogBySession = new Map<string, number[]>();

function getAllowedOrigins(): Set<string> | null {
  if (FRONTEND_PLATFORM_ORIGIN === '*') {
    return null;
  }

  return new Set(
    FRONTEND_PLATFORM_ORIGIN
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean)
  );
}

const allowedOrigins = getAllowedOrigins();

function cleanupExpiredState(now = Date.now()): void {
  for (const [sessionId, session] of chatSessions.entries()) {
    if (now - session.lastSeenAt > SESSION_TTL_MS) {
      chatSessions.delete(sessionId);
    }
  }

  for (const [sessionId, timestamps] of requestLogBySession.entries()) {
    const recent = timestamps.filter(ts => now - ts <= RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) {
      requestLogBySession.delete(sessionId);
      continue;
    }
    requestLogBySession.set(sessionId, recent);
  }
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!allowedOrigins) {
    return true;
  }

  return !!origin && allowedOrigins.has(origin);
}

function isValidSessionId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{16,128}$/i.test(value);
}

function getOrCreateSession(sessionId: string): ChatSessionState {
  const existing = chatSessions.get(sessionId);
  if (existing) {
    existing.lastSeenAt = Date.now();
    return existing;
  }

  const created: ChatSessionState = {
    history: [],
    lastSeenAt: Date.now(),
  };
  chatSessions.set(sessionId, created);
  return created;
}

function checkRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const recent = (requestLogBySession.get(sessionId) ?? []).filter(ts => now - ts <= RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  requestLogBySession.set(sessionId, recent);
  return recent.length <= RATE_LIMIT_MAX_REQUESTS;
}


console.log(`\nStarting AI agent service (${AI_AGENT_NAME})\n`);
const model = await getModel();
const agent = await getAgent(model);
const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(cors({
  origin: FRONTEND_PLATFORM_ORIGIN === '*'
    ? true
    : FRONTEND_PLATFORM_ORIGIN.split(',').map(o => o.trim()),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-client', 'authorization', SESSION_ID_HEADER],
}));
app.use(express.json());

// Health check for Cloud Run readiness probes.
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// Handle POST requests for frontend-to-agent communication e.g. from frontend-platform
app.post('/api/chat', async (req: Request, res: Response) => {
  console.log(`\n\nReceived POST /api/chat (question: '${req.body?.question}', reset: ${req.body?.reset})`);
  try {
    cleanupExpiredState();

    if (!isAllowedOrigin(req.headers.origin)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Origin is not allowed for this AI agent endpoint.',
      });
    }

    const sessionIdHeader = req.headers[SESSION_ID_HEADER];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({
        error: 'Invalid Session',
        message: `Missing or invalid ${SESSION_ID_HEADER} header.`,
      });
    }

    if (!checkRateLimit(sessionId)) {
      return res.status(429).json({
        error: 'Rate Limit Exceeded',
        message: 'Too many chat requests for this session. Please wait a minute and try again.',
      });
    }

    const reset = req.body?.reset === true;
    const userPrompt = req.body?.question;
    if (!reset && typeof userPrompt !== 'string') {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'question must be provided as a string.',
      });
    }

    const session = getOrCreateSession(sessionId);

    if (reset) {
      session.history = [];
      session.lastSeenAt = Date.now();
      return res.status(200).json({ status: 'ok', response: { messages: [] } });
    }

    session.history.push(new HumanMessage(userPrompt));
    session.history = session.history.slice(-MAX_CHAT_MESSAGES);
    session.lastSeenAt = Date.now();

    console.log(`getResponse - invoking agent with ${session.history.length} messages...`);
    const response = await agent.invoke({
      messages: session.history,
    });
    session.history = response.messages.slice(-MAX_CHAT_MESSAGES);
    session.lastSeenAt = Date.now();
    console.log(`getResponse - completed agent invocation successfully`);

    return res.status(200).json({
      response
    });
  } catch (error: any) {
    console.error('\n!!! AGENT INVOCATION ERROR !!!');
    console.error('Type:', error?.constructor?.name || typeof error);
    console.error('Message:', error.message);
    if (error.stack) console.error('Stack:', error.stack);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }

    // Check for common Gemini errors
    if (error.message?.includes('leaked')) {
      return res.status(403).json({
        error: 'API Key Leaked',
        message: 'Your Gemini API key has been reported as leaked by Google. Please generate a new key at https://aistudio.google.com/.'
      });
    }

    return res.status(500).json({
      error: 'Agent Error',
      message: error.message || 'Internal Server Error'
    });
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
