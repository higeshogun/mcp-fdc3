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

const SYSTEM_PROMPT = `Only respond via tools; if not tool applies output: NO_APPLICABLE_TOOL.
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
