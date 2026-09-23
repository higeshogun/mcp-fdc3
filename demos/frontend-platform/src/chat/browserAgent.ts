import type { AIConfig, StructuredMessage } from './types';
import { getWebMcpClient } from '../mcp/webMcpServer';

const SYSTEM_PROMPT = `You are a helpful UI assistant demonstrating a financial software application with FDC3 interop. You are NOT a broker and you do NOT place actual financial trades.
You are permitted and expected to use tools to submit ANY order type requested by the user, including market orders and limit orders with limit prices, as these are UI demonstrations in a mock environment.
Use appropriate tools when the user asks to switch views or open widgets/tabs (switchView for chart, watchlist, news, rfq, order-ticket, account, positions, orders blotter, trade blotter, chat), view trades (getTrades), filter news (getNews), display charts (viewChart), submit/execute orders (submitOrder), stage/prepare orders in the order ticket (stageOrder), cancel pending orders on the blotter (cancelOrder), view portfolio positions (getPositions), check account balance and equity (getAccountSummary), add/remove watchlist instruments (addToWatchlist, removeFromWatchlist), or clear desktop filters (clearFilters).
Never return fabricated JSON or external links in your response.
Be concise and clear in your final answers.`;

interface MessageHistoryItem {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

const chatSessionHistories = new Map<string, MessageHistoryItem[]>();

export function clearChatSessionHistory(sessionId: string) {
  chatSessionHistories.delete(sessionId);
}

/**
 * Fetches tool schemas dynamically from the in-browser WebMCP server
 * and formats them for LLM function calling.
 */
async function getToolsSchemaForLlm() {
  const client = await getWebMcpClient();
  const { tools } = await client.listTools();

  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

function getProviderEndpointAndHeaders(aiConfig: AIConfig) {
  const provider = aiConfig.provider || 'custom';
  let url = '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  let effectiveModel = aiConfig.model;

  if (provider === 'gemini') {
    const key = aiConfig.apiKey?.trim();
    if (!key) {
      throw new Error('Google Gemini API Key is required. Please set it in ⚙️ AI Settings.');
    }
    effectiveModel = effectiveModel || 'gemini-2.0-flash';
    url = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
    headers['Authorization'] = `Bearer ${key}`;
  } else if (provider === 'openai') {
    const key = aiConfig.apiKey?.trim();
    if (!key) {
      throw new Error('OpenAI API Key is required. Please set it in ⚙️ AI Settings.');
    }
    effectiveModel = effectiveModel || 'gpt-4o';
    const baseUrl = (aiConfig.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
    url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
    headers['Authorization'] = `Bearer ${key}`;
  } else if (provider === 'ollama') {
    effectiveModel = effectiveModel || 'llama3.2';
    const baseUrl = (aiConfig.baseUrl?.trim() || 'http://localhost:11434').replace(/\/+$/, '');
    url = baseUrl.endsWith('/v1/chat/completions') || baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/v1/chat/completions`;
    if (aiConfig.apiKey?.trim()) {
      headers['Authorization'] = `Bearer ${aiConfig.apiKey.trim()}`;
    }
  } else {
    // Custom OpenAI compatible (e.g. self-hosted LLM)
    const baseUrl = (aiConfig.baseUrl?.trim() || 'https://myllm.kumatech.net/v1').replace(/\/+$/, '');
    effectiveModel = effectiveModel || 'gemma-4-12b';
    url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
    if (aiConfig.apiKey?.trim()) {
      headers['Authorization'] = `Bearer ${aiConfig.apiKey.trim()}`;
    }
  }

  return { url, headers, model: effectiveModel };
}

export async function runBrowserAgent(
  sessionId: string,
  question: string,
  aiConfig: AIConfig
): Promise<StructuredMessage> {
  const { url, headers, model } = getProviderEndpointAndHeaders(aiConfig);
  const toolsSchema = await getToolsSchemaForLlm();
  const mcpClient = await getWebMcpClient();

  let history = chatSessionHistories.get(sessionId);
  if (!history) {
    history = [{ role: 'system', content: SYSTEM_PROMPT }];
    chatSessionHistories.set(sessionId, history);
  }

  history.push({ role: 'user', content: question });

  // Limit conversation history to last 15 messages
  if (history.length > 15) {
    history = [history[0], ...history.slice(-14)];
    chatSessionHistories.set(sessionId, history);
  }

  const payload: any = {
    model,
    messages: history,
    tools: toolsSchema,
    tool_choice: 'auto',
    temperature: 0,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(errText);
    } catch {}
    const errMsg = parsed?.error?.message || parsed?.message || errText;
    throw new Error(`AI Provider Error (${res.status}): ${errMsg}`);
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  const message = choice?.message;

  if (!message) {
    throw new Error('Invalid response structure from AI Provider');
  }

  let finalResource: any = null;
  const toolCalls = message.tool_calls;

  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    history.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: toolCalls,
    });

    const toolResults: string[] = [];

    for (const toolCall of toolCalls) {
      const fnName = toolCall?.function?.name;
      let fnArgs: any = {};
      try {
        fnArgs =
          typeof toolCall?.function?.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : toolCall?.function?.arguments || {};
      } catch (e) {
        console.error('Failed to parse tool arguments', e);
      }

      // Execute tool via in-browser WebMCP Client
      console.log(`[WebMCP] Calling tool '${fnName}' with args:`, fnArgs);
      const mcpResult: any = await mcpClient.callTool({
        name: fnName,
        arguments: fnArgs,
      });

      let toolText = '';
      if (Array.isArray(mcpResult?.content)) {
        for (const item of mcpResult.content) {
          if (item.type === 'text') {
            toolText += (toolText ? '\n' : '') + item.text;
          } else if (item.type === 'resource' && item.resource) {
            finalResource = item.resource;
          }
        }
      }

      if (!finalResource) {
        if (mcpResult?.fdc3Resource) {
          finalResource = mcpResult.fdc3Resource.resource || mcpResult.fdc3Resource;
        } else if (mcpResult?._meta?.fdc3) {
          finalResource = mcpResult._meta.fdc3.resource || mcpResult._meta.fdc3;
        }
      }

      if (!toolText) {
        toolText = `Executed ${fnName}`;
      }

      toolResults.push(toolText);

      history.push({
        role: 'tool',
        tool_call_id: toolCall.id || 'call_1',
        name: fnName,
        content: toolText,
      });
    }

    // Secondary synthesis turn
    try {
      const secondRes = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: history,
          temperature: 0,
        }),
      });

      if (secondRes.ok) {
        const secondData = await secondRes.json();
        const secondMsg = secondData?.choices?.[0]?.message;
        if (secondMsg?.content) {
          history.push({ role: 'assistant', content: secondMsg.content });
          return {
            finalAnswer: secondMsg.content,
            textContent: secondMsg.content,
            mcpResource: finalResource,
            toolCalls,
          };
        }
      }
    } catch (e) {
      console.warn('Failed second turn synthesis, using tool text directly', e);
    }

    const fallbackAnswer = toolResults.join('\n');
    history.push({ role: 'assistant', content: fallbackAnswer });
    return {
      finalAnswer: fallbackAnswer,
      textContent: fallbackAnswer,
      mcpResource: finalResource,
      toolCalls,
    };
  }

  // No tool calls - plain conversational answer
  const answer = message.content || 'Done.';
  history.push({ role: 'assistant', content: answer });

  return {
    finalAnswer: answer,
    textContent: answer,
    mcpResource: undefined,
    toolCalls: [],
  };
}
