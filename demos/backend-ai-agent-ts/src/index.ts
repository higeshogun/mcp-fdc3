import express, { Request, Response } from 'express';
import cors from 'cors';
import { ChatOpenAI } from '@langchain/openai';
import { loadMcpTools } from '@langchain/mcp-adapters';
import { HumanMessage, ReactAgent, ResponseFormatUndefined, createAgent } from 'langchain';
import { AgentMiddleware, AnyAnnotationRoot } from 'langchain/dist/agents/middleware/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const OPENAI_API_KEY = requireEnv('OPENAI_API_KEY');
const OPENAI_MODEL = requireEnv('OPENAI_MODEL');

const AI_AGENT_NAME = 'backend-ai-agent-ts';
const AI_AGENT_VERSION = '0.1.0';
const BACKEND_MCP_SERVER_NAME = 'backend-mcp-server-ts';
const BACKEND_MCP_SERVER_URL = 'http://localhost:3000/mcp';
const FRONTEND_PLATFORM_ORIGIN = 'http://localhost:8080';

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


const getModel = async (): Promise<ChatOpenAI> => {
  console.log('getModel - started creating ChatOpenAI model...');
  const model = new ChatOpenAI({
    model: OPENAI_MODEL,
    openAIApiKey: OPENAI_API_KEY,
    temperature: 0,
    maxTokens: 512,
  });
  console.log('getModel - completed creating ChatOpenAI model');
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

const getAgent = async (model: ChatOpenAI): Promise<ReactAgent<ResponseFormatUndefined, undefined, AnyAnnotationRoot, readonly AgentMiddleware<any, any, any>[]>> => {
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

const getResponse = async (userPrompt: string): Promise<any> => {
  console.log(`getResponse - started getting response for prompt: '${userPrompt}' ...`);

  // const response = await model.invoke([{
  //   role: 'user',
  //   content: userPrompt
  // }]);

  const response = await agent.invoke({
    messages: [new HumanMessage(userPrompt)],
  });

  console.log(`getResponse - completed getting response for prompt: '${userPrompt}'`);
  return response;
};


console.log(`\nStarting AI agent service (${AI_AGENT_NAME})\n`);
const model = await getModel();
const agent = await getAgent(model);
const app = express();
const port = 4000;

app.use(express.json());

app.use(cors({
  origin: FRONTEND_PLATFORM_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-client', 'authorization'],
}));

// // Handle GET requests (for basic testing purposes only)
// app.get('/api/chat', async (req: Request, res: Response) => {
//   console.log('\n\nReceived GET /api/chat');
//   // const userPrompt = 'What is the capital of France?';
//   const userPrompt = 'Get trades for apple';
//   const response = await getResponse(userPrompt);
//   return res.status(200).json({
//     response
//   });
// });

// Handle POST requests for frontend-to-agent communication e.g. from frontend-platform
app.post('/api/chat', async (req: Request, res: Response) => {
  console.log(`\n\nReceived POST /api/chat (question: '${req.body?.question}')`);
  const userPrompt = req.body?.question;
  const response = await getResponse(userPrompt);
  return res.status(200).json({
    response
  });
});


app.listen(port, () => {
  console.log(`\nAI agent service (${AI_AGENT_NAME}) listening at http://localhost:${port}\n`);
});
