import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { createFdc3RaiseIntentResource } from '@mcp-fdc3/server/dist/mcp-fdc3-server.esm.js';
import type { AppIdentifier, Context } from '@finos/fdc3';

// ── Mock Reference Data ──────────────────────────────────────────────────
export const tickerMappingData = [
  { name: 'Alphabet Inc', ticker: 'GOOGL' },
  { name: 'Amazon.com, Inc', ticker: 'AMZN' },
  { name: 'Apple Inc', ticker: 'AAPL' },
  { name: 'Facebook', ticker: 'META' },
  { name: 'Google', ticker: 'GOOGL' },
  { name: 'Meta Platforms, Inc', ticker: 'META' },
  { name: 'Microsoft Corp', ticker: 'MSFT' },
  { name: 'Nvidia Corp', ticker: 'NVDA' },
  { name: 'Tesla Inc', ticker: 'TSLA' },
  { name: 'JPMorgan Chase & Co', ticker: 'JPM' },
  { name: 'Goldman Sachs Group', ticker: 'GS' },
  { name: 'Visa Inc', ticker: 'V' },
  { name: 'Eli Lilly & Co', ticker: 'LLY' },
  { name: 'Netflix Inc', ticker: 'NFLX' },
];

export const fxMappingData: Record<string, string> = {
  'EUR/USD': 'EUR/USD',
  'EURUSD': 'EUR/USD',
  'GBP/USD': 'GBP/USD',
  'GBPUSD': 'GBP/USD',
  'USD/JPY': 'USD/JPY',
  'USDJPY': 'USD/JPY',
  'EURO DOLLAR': 'EUR/USD',
  'CABLE': 'GBP/USD',
  'POUND DOLLAR': 'GBP/USD',
};

function resolveCompanyOrTicker(input: string) {
  if (!input || typeof input !== 'string') return undefined;
  const sanitized = input.trim().toLowerCase();
  return tickerMappingData.find(
    c => c.name.toLowerCase().includes(sanitized) || c.ticker.toLowerCase() === sanitized
  );
}

function resolveInstrument(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const upper = input.trim().toUpperCase();
  if (fxMappingData[upper]) return fxMappingData[upper];
  const stock = tickerMappingData.find(
    c => c.name.toUpperCase() === upper || c.ticker.toUpperCase() === upper
  );
  if (stock) return stock.ticker;
  return upper;
}

// ── WebMCP Input & Output Normalization Helpers ────────────────────────────

/**
 * Robustly normalizes tool input across various inspector and client formats:
 * - Direct object: { companyName: 'AAPL' }
 * - Stringified JSON: '{"companyName":"AAPL"}'
 * - Wrapped args: { arguments: { ... } } or { args: { ... } }
 */
export function normalizeToolInput(input: any): Record<string, any> {
  if (!input) return {};
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === 'object') return normalizeToolInput(parsed);
    } catch {
      return { value: input };
    }
  }
  if (typeof input === 'object') {
    if (input.arguments && typeof input.arguments === 'object') {
      return normalizeToolInput(input.arguments);
    }
    if (typeof input.arguments === 'string') {
      try {
        return normalizeToolInput(JSON.parse(input.arguments));
      } catch {}
    }
    if (input.args && typeof input.args === 'object') {
      return normalizeToolInput(input.args);
    }
    if (typeof input.args === 'string') {
      try {
        return normalizeToolInput(JSON.parse(input.args));
      } catch {}
    }
    return input;
  }
  return {};
}

/**
 * Formats tool output to be 100% compliant with BOTH:
 * 1. Newest WebMCP standard (document.modelContext / Chrome 146+ / 150+):
 *    Direct JSON-serializable object matching outputSchema, with typed properties at root.
 * 2. MCP CallToolResult standard:
 *    Clean content array strictly of { type: 'text', text: string } with formatted JSON string,
 *    avoiding raw non-standard { type: 'resource' } items that break tool inspectors.
 */
export function createWebMcpResult(params: {
  status?: 'success' | 'error';
  message: string;
  data?: Record<string, any>;
  fdc3Resource?: any;
  isError?: boolean;
}) {
  const isError = params.isError ?? false;
  const status = params.status || (isError ? 'error' : 'success');
  const data = params.data || {};

  const structuredPayload: Record<string, any> = {
    status,
    success: !isError,
    message: params.message,
    data,
    ...data,
  };

  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'resource'; resource: any }
  > = [
    {
      type: 'text' as const,
      text: params.message,
    },
    {
      type: 'text' as const,
      text: JSON.stringify(structuredPayload, null, 2),
    },
  ];

  if (params.fdc3Resource) {
    if (params.fdc3Resource.type === 'resource' && params.fdc3Resource.resource) {
      content.push(params.fdc3Resource);
    } else if (params.fdc3Resource.uri && params.fdc3Resource.text) {
      content.push({
        type: 'resource' as const,
        resource: params.fdc3Resource,
      });
    }
  }

  return {
    ...structuredPayload,
    content,
    isError,
    fdc3Resource: params.fdc3Resource,
    _meta: params.fdc3Resource ? { fdc3: params.fdc3Resource } : undefined,
  };
}

// ── In-Memory MCP Server Instance ──────────────────────────────────────────
export function createWebMcpServer(): McpServer {
  const server = new McpServer({
    name: 'webmcp-fdc3-server',
    version: '1.0.0',
  });

  // 1. getTrades tool
  server.registerTool(
    'getTrades',
    {
      title: 'GetTrades',
      description:
        'Returns historical trades for a given company and broadcasts an FDC3 fdc3.instrument context via the ViewInstrument intent, targeting the Trade Blotter. Example input: "AAPL". Use this when the user wants to see their trade execution history.',
      inputSchema: {
        companyName: z.string().describe('Company name or ticker symbol (e.g. AAPL, NVIDIA)'),
      },
    },
    async (rawArgs: any) => {
      const args = normalizeToolInput(rawArgs);
      const inputStr = String(args.companyName || args.ticker || args.symbol || args.company || args.instrument || '').trim();
      const company = resolveCompanyOrTicker(inputStr) || (inputStr ? { name: inputStr.toUpperCase(), ticker: inputStr.toUpperCase() } : undefined);
      if (!company) {
        return createWebMcpResult({
          status: 'error',
          isError: true,
          message: 'Please specify a company name or ticker symbol to view trades.',
        });
      }

      const targetApp: AppIdentifier = { appId: 'frontend-app-trade-blotter' };
      const context: Context = {
        type: 'fdc3.instrument',
        name: company.name,
        id: { ticker: company.ticker },
      };
      const fdc3Resource = createFdc3RaiseIntentResource('ViewInstrument', context, targetApp);

      const mockTrades = [
        { tradeId: `T-${company.ticker}-01`, ticker: company.ticker, side: 'BUY', quantity: 500, price: 182.50, timestamp: '2026-09-08 09:30:15', status: 'FILLED' },
        { tradeId: `T-${company.ticker}-02`, ticker: company.ticker, side: 'BUY', quantity: 1000, price: 184.10, timestamp: '2026-09-08 10:14:22', status: 'FILLED' },
        { tradeId: `T-${company.ticker}-03`, ticker: company.ticker, side: 'SELL', quantity: 300, price: 188.75, timestamp: '2026-09-08 13:45:00', status: 'FILLED' },
      ];

      const message = `Successfully retrieved ${mockTrades.length} trades for ${company.name} (${company.ticker}) and raised an FDC3 ViewInstrument intent targeting the Trade Blotter.`;
      return createWebMcpResult({
        status: 'success',
        message,
        data: {
          company: company.name,
          ticker: company.ticker,
          tradesCount: mockTrades.length,
          trades: mockTrades,
        },
        fdc3Resource,
      });
    }
  );

  // 2. getNews tool
  server.registerTool(
    'getNews',
    {
      title: 'GetNews',
      description:
        'Filters the news feed by broadcasting an FDC3 fdc3.instrument context via the ViewInstrument intent, targeting the News App. Can filter by company/ticker (e.g. "NVDA", "AAPL"), market sentiment ("bullish" / positive or "bearish" / negative), and topic ("earnings", "macro", "tech", "rates").',
      inputSchema: {
        companyName: z.string().optional().describe('Optional company name or ticker symbol to filter news for (e.g. MSFT, AAPL, NVDA, COIN)'),
        sentiment: z.enum(['bullish', 'bearish', 'all']).optional().describe('Filter news by sentiment: "bullish" (positive) or "bearish" (negative)'),
        topic: z.enum(['earnings', 'macro', 'tech', 'rates', 'all']).optional().describe('Filter news by topic: earnings, macro, tech, or rates'),
      },
    },
    async (rawArgs: any) => {
      const args = normalizeToolInput(rawArgs);
      const inputStr = String(args.companyName || args.ticker || args.symbol || args.company || args.instrument || '').trim();
      const company = inputStr ? (resolveCompanyOrTicker(inputStr) || { name: inputStr.toUpperCase(), ticker: inputStr.toUpperCase() }) : undefined;
      const sentiment = args.sentiment ? String(args.sentiment).toLowerCase() : undefined;
      const topic = args.topic ? String(args.topic).toLowerCase() : undefined;

      const targetApp: AppIdentifier = { appId: 'frontend-app-news' };
      const context: Context = {
        type: 'fdc3.instrument',
        ...(company ? { name: company.name, id: { ticker: company.ticker } } : {}),
        ...(sentiment ? { sentiment } : {}),
        ...(topic ? { topic } : {}),
      };
      const fdc3Resource = createFdc3RaiseIntentResource('ViewInstrument', context, targetApp);

      const filterParts: string[] = [];
      if (company) filterParts.push(`for ${company.name} (${company.ticker})`);
      if (sentiment) filterParts.push(`with ${sentiment.toUpperCase()} sentiment`);
      if (topic) filterParts.push(`covering ${topic.toUpperCase()}`);
      const desc = filterParts.length > 0 ? filterParts.join(' ') : 'across all sectors';

      const message = `Filtered news ${desc} using an FDC3 ViewInstrument intent. The user's News Panel has updated accordingly.`;
      return createWebMcpResult({
        status: 'success',
        message,
        data: {
          filter: {
            company: company ? company.name : 'All Markets',
            ticker: company ? company.ticker : undefined,
            sentiment: sentiment || 'all',
            topic: topic || 'all',
          },
          articlesCount: 4,
          articles: [
            { headline: `${company ? company.name : 'Financial sector'} trading momentum accelerates`, sentiment: sentiment || 'bullish', topic: topic || 'macro', time: '15m ago' },
            { headline: `Earnings preview shows robust margin resilience`, sentiment: sentiment || 'bullish', topic: topic || 'earnings', time: '1h ago' },
          ],
        },
        fdc3Resource,
      });
    }
  );

  // 3. clearFilters tool
  server.registerTool(
    'clearFilters',
    {
      title: 'ClearFilters',
      description:
        'Resets the workspace context across all panels (blotter, news, watchlist, chart) by broadcasting an FDC3 ClearFilter intent. Use this when the user says "clear filters", "reset desktop", "clear all", or "show all".',
      inputSchema: {},
    },
    async () => {
      const targetApp: AppIdentifier = { appId: 'all' };
      const context: Context = { type: 'fdc3.clear' };
      const fdc3Resource = createFdc3RaiseIntentResource('ClearFilter', context, targetApp);

      return createWebMcpResult({
        status: 'success',
        message: 'Successfully broadcasted an FDC3 ClearFilter intent. All panels have been reset to their default unfiltered state.',
        data: {
          action: 'clearFilters',
          resetPanels: ['blotter', 'news', 'watchlist', 'chart'],
        },
        fdc3Resource,
      });
    }
  );

  // 4. submitOrder tool
  server.registerTool(
    'submitOrder',
    {
      title: 'SubmitOrder',
      description:
        'Submits and executes an order immediately (market order filled immediately, limit order placed as pending on the blotter) by broadcasting an FDC3 SubmitOrder intent to the Order Ticket and Orders Blotter. Use this when the user explicitly asks to buy, sell, execute, or place an order right away. Example inputs: "Buy 100 shares of AAPL", "Sell 50 NVDA at market", "Place limit buy order for 20 TSLA at 240".',
      inputSchema: {
        side: z.enum(['buy', 'sell']).describe('The side of the order (buy or sell)'),
        quantity: z.number().describe('The number of shares/contracts to trade'),
        ticker: z.string().describe('The ticker symbol, e.g., AAPL, MSFT, NVDA, TSLA'),
        orderType: z
          .enum(['market', 'limit'])
          .optional()
          .default('market')
          .describe('The type of order (market or limit). If the user mentions a price, this MUST be set to "limit"'),
        price: z
          .number()
          .optional()
          .describe('The limit price. You MUST provide this number if the user mentions a price.'),
      },
    },
    async (rawArgs: any) => {
      const args = normalizeToolInput(rawArgs);
      const rawTicker = String(args.ticker || args.symbol || args.companyName || args.instrument || 'AAPL').trim();
      const resolvedTicker = resolveInstrument(rawTicker) || rawTicker.toUpperCase();
      const rawSide = String(args.side || 'buy').toLowerCase();
      const side = rawSide.includes('sell') ? 'sell' : 'buy';
      const quantity = Math.max(1, Math.round(Number(args.quantity) || 100));
      const price = args.price !== undefined && args.price !== null && !isNaN(Number(args.price)) ? Number(args.price) : undefined;
      const orderType = args.orderType === 'limit' || price !== undefined ? 'limit' : 'market';
      const execute = true;

      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      const timeStr = today.toLocaleTimeString('en-US', { hour12: false });
      const orderId = `O${Math.floor(1000 + Math.random() * 9000)}`;

      const context = {
        type: 'fdc3.order',
        details: {
          orderId,
          ticker: resolvedTicker,
          side,
          quantity,
          type: orderType,
          price,
          execute,
          time: `${dateStr} ${timeStr}`,
        },
      };

      const fdc3Resource = createFdc3RaiseIntentResource(
        'SubmitOrder',
        context as any,
        { appId: 'frontend-app-order-ticket' }
      );

      const orderDesc =
        orderType === 'limit' && price !== undefined
          ? `LIMIT ${side.toUpperCase()} ${quantity} ${resolvedTicker} @ $${price}`
          : `MARKET ${side.toUpperCase()} ${quantity} ${resolvedTicker}`;

      const statusDesc = orderType === 'limit' ? 'placed as PENDING' : 'FILLED immediately';

      return createWebMcpResult({
        status: 'success',
        message: `Order submitted and executed for ${orderDesc} via FDC3 SubmitOrder intent. The order has been ${statusDesc} and recorded on your Orders Blotter.`,
        data: {
          orderId,
          ticker: resolvedTicker,
          side,
          quantity,
          orderType,
          price,
          orderStatus: orderType === 'limit' ? 'PENDING' : 'FILLED',
          timestamp: `${dateStr} ${timeStr}`,
        },
        fdc3Resource,
      });
    }
  );

  // 5. stageOrder tool
  server.registerTool(
    'stageOrder',
    {
      title: 'StageOrder',
      description:
        'Stages and populates an order in the Order Ticket UI without executing it, allowing the trader to review, edit, or confirm quantities, side, and prices before manual submission. Use this when the user asks to stage, prepare, draft, or set up an order (e.g., "Stage an order to buy 100 AAPL", "Prepare a limit buy for 50 TSLA at 240 in the ticket", "Set up an order to sell 20 MSFT", "Stage 100 NVDA").',
      inputSchema: {
        ticker: z.string().describe('The ticker symbol or company name, e.g., AAPL, MSFT, NVDA, TSLA'),
        side: z.enum(['buy', 'sell']).optional().default('buy').describe('The side of the order (buy or sell)'),
        quantity: z.number().optional().default(100).describe('The number of shares/contracts to stage'),
        orderType: z
          .enum(['market', 'limit'])
          .optional()
          .default('market')
          .describe('The type of order (market or limit)'),
        price: z
          .number()
          .optional()
          .describe('Optional limit price for limit orders'),
      },
    },
    async (rawArgs: any) => {
      const args = normalizeToolInput(rawArgs);
      const rawTicker = String(args.ticker || args.symbol || args.companyName || args.instrument || 'AAPL').trim();
      const resolvedTicker = resolveInstrument(rawTicker) || rawTicker.toUpperCase();
      const rawSide = String(args.side || 'buy').toLowerCase();
      const side = rawSide.includes('sell') ? 'sell' : 'buy';
      const quantity = Math.max(1, Math.round(Number(args.quantity) || 100));
      const price = args.price !== undefined && args.price !== null && !isNaN(Number(args.price)) ? Number(args.price) : undefined;
      const orderType = args.orderType === 'limit' || price !== undefined ? 'limit' : 'market';

      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      const timeStr = today.toLocaleTimeString('en-US', { hour12: false });
      const orderId = `S${Math.floor(1000 + Math.random() * 9000)}`;

      const context = {
        type: 'fdc3.order',
        details: {
          orderId,
          ticker: resolvedTicker,
          side,
          quantity,
          type: orderType,
          price,
          execute: false, // Explicitly stage only, do not auto-execute
          time: `${dateStr} ${timeStr}`,
        },
      };

      const fdc3Resource = createFdc3RaiseIntentResource(
        'StageOrder',
        context as any,
        { appId: 'frontend-app-order-ticket' }
      );

      const orderDesc =
        orderType === 'limit' && price !== undefined
          ? `LIMIT ${side.toUpperCase()} ${quantity} ${resolvedTicker} @ $${price}`
          : `MARKET ${side.toUpperCase()} ${quantity} ${resolvedTicker}`;

      return createWebMcpResult({
        status: 'success',
        message: `Order staged in Order Ticket for ${orderDesc} via FDC3 StageOrder intent. The ticket has been populated and is ready for your review and manual confirmation.`,
        data: {
          orderId,
          ticker: resolvedTicker,
          side,
          quantity,
          orderType,
          price,
          orderStatus: 'STAGED',
          timestamp: `${dateStr} ${timeStr}`,
        },
        fdc3Resource,
      });
    }
  );

  // 5. requestQuote tool
  server.registerTool(
    'requestQuote',
    {
      title: 'RequestQuote',
      description:
        'Constructs an FDC3 fdc3.order context and stages an RFQ via the InitiateRFQ intent in the RFQ panel for OTC instruments like FX pairs (e.g. EUR/USD). Use this when the user wants to trade FX or specifically asks to request a quote from dealers. Provide side, quantity, and instrument.',
      inputSchema: {
        side: z.enum(['buy', 'sell', 'two-way']).describe('The side to request (buy, sell, or two-way)'),
        quantity: z.number().describe('The notional amount to trade (e.g. 1000000)'),
        instrument: z.string().describe('The instrument symbol, e.g., EUR/USD'),
      },
    },
    async (rawArgs: any) => {
      const args = normalizeToolInput(rawArgs);
      const rawInst = String(args.instrument || args.ticker || args.symbol || args.pair || 'EUR/USD').trim();
      const resolvedTicker = resolveInstrument(rawInst) || rawInst.toUpperCase();
      const rawSide = String(args.side || 'two-way').toLowerCase();
      const side = rawSide.includes('buy') ? 'buy' : rawSide.includes('sell') ? 'sell' : 'two-way';
      const quantity = Math.max(1, Number(args.quantity) || 1000000);
      const rfqId = `RFQ-${Math.floor(100000 + Math.random() * 900000)}`;

      const context = {
        type: 'fdc3.order',
        details: {
          rfqId,
          ticker: resolvedTicker,
          side,
          quantity,
        },
      };

      const fdc3Resource = createFdc3RaiseIntentResource(
        'InitiateRFQ',
        context as any,
        { appId: 'frontend-app-rfq' }
      );

      return createWebMcpResult({
        status: 'success',
        message: `RFQ for ${side.toUpperCase()} ${quantity.toLocaleString()} ${resolvedTicker} successfully staged via an FDC3 InitiateRFQ intent. The RFQ panel is now populated.`,
        data: {
          rfqId,
          instrument: resolvedTicker,
          side,
          quantity,
          indicativeBid: 1.0842,
          indicativeAsk: 1.0844,
          statusText: 'QUOTED',
        },
        fdc3Resource,
      });
    }
  );

  // 6. viewChart tool
  server.registerTool(
    'viewChart',
    {
      title: 'ViewChart',
      description:
        'Displays or updates interactive financial charts (candlesticks, line/area, moving averages, volume) for an equity or FX instrument by broadcasting an FDC3 fdc3.instrument context via the ViewChart intent, targeting the Chart panel. Supports specifying timeframe (1D, 1W, 1M, 3M, 1Y) and chart style (candle, line). Example inputs: "show 1Y chart for NVDA", "switch to line chart", "show 1D chart".',
      inputSchema: {
        ticker: z.string().optional().describe('Ticker symbol or company name (e.g. AAPL, NVDA, TSLA, MSFT, COIN, EUR/USD). If omitted, modifies the currently active chart.'),
        timeframe: z.enum(['1D', '1W', '1M', '3M', '1Y']).optional().describe('Chart timeframe duration: 1D (1 day), 1W (1 week), 1M (1 month), 3M (3 months), 1Y (1 year)'),
        chartType: z.enum(['candle', 'line']).optional().describe('Chart style: candle or line'),
      },
    },
    async (rawArgs: any) => {
      const args = normalizeToolInput(rawArgs);
      const rawTicker = String(args.ticker || args.symbol || args.companyName || args.instrument || '').trim();
      const resolved = rawTicker ? (resolveInstrument(rawTicker) || resolveCompanyOrTicker(rawTicker)?.ticker || rawTicker.toUpperCase()) : undefined;
      const company = rawTicker ? (resolveCompanyOrTicker(rawTicker) || { name: resolved!, ticker: resolved! }) : undefined;
      const timeframe = args.timeframe;
      const chartType = args.chartType;

      const targetApp: AppIdentifier = { appId: 'frontend-app-chart' };
      const context: Context = {
        type: 'fdc3.instrument',
        ...(company ? { name: company.name, id: { ticker: resolved } } : {}),
        ...(timeframe ? { timeframe } : {}),
        ...(chartType ? { chartType } : {}),
      };
      const fdc3Resource = createFdc3RaiseIntentResource('ViewChart', context, targetApp);

      const targetDesc = company ? `${company.name} (${resolved})` : 'current instrument';
      const tfStr = timeframe ? ` [${timeframe}]` : '';
      const typeStr = chartType ? ` (${chartType})` : '';

      return createWebMcpResult({
        status: 'success',
        message: `Displayed chart for ${targetDesc}${tfStr}${typeStr} via an FDC3 ViewChart intent targeting the Chart panel.`,
        data: {
          ticker: resolved || 'ACTIVE',
          companyName: company ? company.name : undefined,
          timeframe: timeframe || '1D',
          chartType: chartType || 'candle',
          status: 'DISPLAYED',
        },
        fdc3Resource,
      });
    }
  );

  // 7. addToWatchlist tool
  server.registerTool(
    'addToWatchlist',
    {
      title: 'AddToWatchlist',
      description:
        "Adds a stock or financial instrument to the user's Watchlist panel by broadcasting an FDC3 AddWatchlist intent. Example: 'add COIN to my watchlist', 'track AMD on the watchlist'.",
      inputSchema: {
        ticker: z.string().describe('The ticker symbol to add to the watchlist (e.g. COIN, AMD, PLTR, NVDA, AAPL)'),
        companyName: z.string().optional().describe('Optional company name for the instrument (e.g. "Coinbase Global Inc.")'),
      },
    },
    async (rawArgs: any) => {
      const args = normalizeToolInput(rawArgs);
      const rawTicker = String(args.ticker || args.symbol || args.companyName || args.instrument || '').trim();
      const resolved = resolveInstrument(rawTicker) || resolveCompanyOrTicker(rawTicker)?.ticker || rawTicker.toUpperCase();
      const company = resolveCompanyOrTicker(rawTicker) || { name: args.companyName || `${resolved} Inc.`, ticker: resolved };

      const targetApp: AppIdentifier = { appId: 'frontend-app-watchlist' };
      const context: Context = {
        type: 'fdc3.instrument',
        name: company.name,
        id: { ticker: resolved },
      };
      const fdc3Resource = createFdc3RaiseIntentResource('AddWatchlist', context, targetApp);

      return createWebMcpResult({
        status: 'success',
        message: `Successfully added ${company.name} (${resolved}) to the Watchlist panel via an FDC3 AddWatchlist intent.`,
        data: {
          ticker: resolved,
          companyName: company.name,
          action: 'added',
          isNew: true,
        },
        fdc3Resource,
      });
    }
  );

  // 8. removeFromWatchlist tool
  server.registerTool(
    'removeFromWatchlist',
    {
      title: 'RemoveFromWatchlist',
      description:
        "Removes a stock or financial instrument from the user's Watchlist panel by broadcasting an FDC3 RemoveWatchlist intent. Example: 'remove TSLA from my watchlist', 'delete AAPL from watchlist'.",
      inputSchema: {
        ticker: z.string().describe('The ticker symbol to remove from the watchlist (e.g. TSLA, COIN, AAPL)'),
      },
    },
    async (rawArgs: any) => {
      const args = normalizeToolInput(rawArgs);
      const rawTicker = String(args.ticker || args.symbol || args.companyName || args.instrument || '').trim();
      const resolved = resolveInstrument(rawTicker) || resolveCompanyOrTicker(rawTicker)?.ticker || rawTicker.toUpperCase();

      const targetApp: AppIdentifier = { appId: 'frontend-app-watchlist' };
      const context: Context = {
        type: 'fdc3.instrument',
        id: { ticker: resolved },
      };
      const fdc3Resource = createFdc3RaiseIntentResource('RemoveWatchlist', context, targetApp);

      return createWebMcpResult({
        status: 'success',
        message: `Successfully removed ${resolved} from the Watchlist panel via an FDC3 RemoveWatchlist intent.`,
        data: {
          ticker: resolved,
          action: 'removed',
        },
        fdc3Resource,
      });
    }
  );

  // 9. cancelOrder tool
  server.registerTool(
    'cancelOrder',
    {
      title: 'CancelOrder',
      description:
        'Cancels an active or pending order on the Orders Blotter by broadcasting an FDC3 CancelOrder intent. You can specify a ticker symbol (e.g. "GS", "TSLA") or an order ID (e.g. "O009"). If neither is specified, it cancels the most recent pending order. Example inputs: "cancel my pending order for Goldman Sachs", "cancel pending order for TSLA", "cancel order O009", "cancel pending order".',
      inputSchema: {
        ticker: z.string().optional().describe('Ticker symbol of the pending order to cancel (e.g. GS, TSLA, AAPL)'),
        orderId: z.string().optional().describe('Specific order ID to cancel (e.g. O009)'),
      },
    },
    async (rawArgs: any) => {
      const args = normalizeToolInput(rawArgs);
      const rawTicker = args.ticker ? String(args.ticker).trim().toUpperCase() : undefined;
      const orderId = args.orderId ? String(args.orderId).trim().toUpperCase() : undefined;

      const targetApp: AppIdentifier = { appId: 'frontend-app-blotter' };
      const context: Context = {
        type: 'fdc3.order',
        details: {
          ...(orderId ? { orderId } : {}),
          ...(rawTicker ? { ticker: rawTicker } : {}),
        },
      };
      const fdc3Resource = createFdc3RaiseIntentResource('CancelOrder', context, targetApp);

      const targetDesc = orderId ? `order ${orderId}` : rawTicker ? `pending order for ${rawTicker}` : 'most recent pending order';

      return createWebMcpResult({
        status: 'success',
        message: `Successfully sent cancellation request for ${targetDesc} via FDC3 CancelOrder intent. The Orders Blotter has marked the order as CANCELLED.`,
        data: {
          cancelledOrderId: orderId || 'O009',
          ticker: rawTicker || 'GS',
          action: 'cancelOrder',
          status: 'CANCELLED',
        },
        fdc3Resource,
      });
    }
  );

  // 10. getPositions tool
  server.registerTool(
    'getPositions',
    {
      title: 'Get Positions',
      description:
        'Retrieves current portfolio positions, share quantities, weighted average entry costs, live market values, unrealized P&L, and portfolio exposure percentages across all held instruments.',
      inputSchema: {
        ticker: z.string().optional().describe('Optional ticker symbol to query a specific position (e.g. AAPL, NVDA, TSLA)'),
      },
    },
    async (rawArgs: any) => {
      const args = normalizeToolInput(rawArgs);
      const targetTicker = args.ticker ? String(args.ticker).trim().toUpperCase() : undefined;
      const targetApp: AppIdentifier = { appId: 'frontend-app-positions' };
      const context: Context = {
        type: 'fdc3.instrument',
        ...(targetTicker ? { id: { ticker: targetTicker } } : {}),
      };
      const fdc3Resource = createFdc3RaiseIntentResource('ViewPositions', context, targetApp);

      const positions = [
        { ticker: 'AAPL', name: 'Apple Inc.', qty: 1500, avgPrice: 178.20, last: 189.34, mktVal: 284010.00, pnl: '+16,710.00 (+6.25%)', exposure: '19.9%' },
        { ticker: 'NVDA', name: 'NVIDIA Corp.', qty: 450, avgPrice: 812.50, last: 875.40, mktVal: 393930.00, pnl: '+28,305.00 (+7.74%)', exposure: '27.6%' },
        { ticker: 'MSFT', name: 'Microsoft Corp.', qty: 700, avgPrice: 402.10, last: 418.92, mktVal: 293244.00, pnl: '+11,774.00 (+4.18%)', exposure: '20.5%' },
        { ticker: 'TSLA', name: 'Tesla Inc.', qty: 900, avgPrice: 254.40, last: 248.60, mktVal: 223740.00, pnl: '-5,220.00 (-2.28%)', exposure: '15.7%' },
        { ticker: 'AMZN', name: 'Amazon.com Inc.', qty: 850, avgPrice: 184.60, last: 193.20, mktVal: 164220.00, pnl: '+7,310.00 (+4.66%)', exposure: '11.5%' },
        { ticker: 'GS', name: 'Goldman Sachs', qty: 300, avgPrice: 486.00, last: 498.60, mktVal: 149580.00, pnl: '+3,780.00 (+2.59%)', exposure: '10.5%' },
      ];

      const filtered = targetTicker ? positions.filter(p => p.ticker === targetTicker) : positions;
      const summaryText = filtered.map(p => `• ${p.ticker} (${p.qty} shs): Mkt Val $${p.mktVal.toLocaleString()}, P&L ${p.pnl}, Exposure ${p.exposure}`).join('\n');
      const message = `Current Portfolio Positions (Total Market Value: $1,428,750.00, Total Unrealized P&L: +$54,230.00):\n${summaryText}`;

      return createWebMcpResult({
        status: 'success',
        message,
        data: {
          totalPortfolioValue: 1428750.00,
          totalUnrealizedPnl: 54230.00,
          totalUnrealizedPnlPercent: '+3.94%',
          holdingsCount: filtered.length,
          positions: filtered.map(p => ({
            ticker: p.ticker,
            companyName: p.name,
            shares: p.qty,
            avgPrice: p.avgPrice,
            lastPrice: p.last,
            marketValue: p.mktVal,
            unrealizedPnl: p.pnl,
            exposure: p.exposure,
            side: 'LONG',
          })),
        },
        fdc3Resource,
      });
    }
  );

  // 11. getAccountSummary tool
  server.registerTool(
    'getAccountSummary',
    {
      title: 'Get Account Summary',
      description:
        'Retrieves overall account balance and financial health metrics including net liquidity / total equity, cash balance, realized P&L, unrealized P&L, day trading buying power, and margin buffer ratio.',
      inputSchema: {},
    },
    async () => {
      const targetApp: AppIdentifier = { appId: 'frontend-app-account' };
      const context: Context = { type: 'fdc3.account', id: { accountId: 'AC-84920194' } };
      const fdc3Resource = createFdc3RaiseIntentResource('ViewAccount', context, targetApp);

      const message =
        `Account Summary (#AC-84920194 - Margin Pro USD):\n` +
        `• Net Liquidation Value / Total Equity: $2,148,620.00\n` +
        `• Cash Balance: $719,870.00\n` +
        `• Unrealized P&L: +$54,230.00 (+3.94%)\n` +
        `• Realized P&L (YTD): +$18,420.00\n` +
        `• Today's P&L: +$8,410.00 (+0.39%)\n` +
        `• Buying Power: $1,439,740.00 (2.0x Margin)\n` +
        `• Margin Utilization: 29.8% (Healthy buffer)`;

      return createWebMcpResult({
        status: 'success',
        message,
        data: {
          account: {
            accountId: 'AC-84920194',
            tier: 'Margin Pro USD',
            netLiquidation: 2148620.00,
            cashBalance: 719870.00,
            unrealizedPnl: 54230.00,
            realizedPnl: 18420.00,
            todaysPnl: 8410.00,
            buyingPower: 1439740.00,
            marginUtilization: 29.8,
          },
        },
        fdc3Resource,
      });
    }
  );

  // 12. switchView tool
  server.registerTool(
    'switchView',
    {
      title: 'Switch View / Tab',
      description:
        'Switches the active workspace tab or panel to a specific widget view. Use this tool whenever the user asks to switch to, open, show, or focus a widget/tab: "chart", "watchlist", "news", "rfq", "order-ticket", "account", "positions", "orders" (orders blotter), "trades" (trade blotter), or "chat". If the tab has already been opened in a stack, it immediately activates and switches the view to that tab.',
      inputSchema: {
        view: z.string().describe(
          'The widget or tab view to switch to: "chart", "watchlist", "news", "rfq", "order-ticket", "account", "positions", "orders", "trades", or "chat"'
        ),
      },
    },
    async (rawArgs: any) => {
      const args = normalizeToolInput(rawArgs);
      const inputStr = String(args.view || args.widget || args.tab || args.panel || args.name || '').trim().toLowerCase();

      let targetAppId = 'frontend-app-chart';
      let resolvedView = 'chart';
      let displayName = 'Chart';

      if (inputStr.includes('rfq') || inputStr.includes('quote')) {
        targetAppId = 'frontend-app-rfq';
        resolvedView = 'rfq';
        displayName = 'RFQ Panel';
      } else if (inputStr.includes('watch')) {
        targetAppId = 'frontend-app-watchlist';
        resolvedView = 'watchlist';
        displayName = 'Watchlist';
      } else if (inputStr.includes('news')) {
        targetAppId = 'frontend-app-news';
        resolvedView = 'news';
        displayName = 'News Feed';
      } else if (inputStr.includes('ticket') || inputStr.includes('order-ticket')) {
        targetAppId = 'frontend-app-order-ticket';
        resolvedView = 'order-ticket';
        displayName = 'Order Ticket';
      } else if (inputStr.includes('account')) {
        targetAppId = 'frontend-app-account';
        resolvedView = 'account';
        displayName = 'Account Summary';
      } else if (inputStr.includes('pos')) {
        targetAppId = 'frontend-app-positions';
        resolvedView = 'positions';
        displayName = 'Positions';
      } else if (inputStr.includes('trade')) {
        targetAppId = 'frontend-app-trade-blotter';
        resolvedView = 'trades';
        displayName = 'Trade Blotter';
      } else if (inputStr.includes('order') || inputStr.includes('blotter')) {
        targetAppId = 'frontend-app-blotter';
        resolvedView = 'orders';
        displayName = 'Orders Blotter';
      } else if (inputStr.includes('chat')) {
        targetAppId = 'chat';
        resolvedView = 'chat';
        displayName = 'Chat';
      } else {
        targetAppId = 'frontend-app-chart';
        resolvedView = 'chart';
        displayName = 'Chart';
      }

      const targetApp: AppIdentifier = { appId: targetAppId };
      const context: Context = {
        type: 'fdc3.view',
        view: resolvedView,
        name: displayName,
      };
      const fdc3Resource = createFdc3RaiseIntentResource('ViewApp', context, targetApp);

      return createWebMcpResult({
        status: 'success',
        message: `Switched view to ${displayName}. The tab is now active.`,
        data: {
          view: resolvedView,
          appId: targetAppId,
          title: displayName,
          status: 'SWITCHED',
        },
        fdc3Resource,
      });
    }
  );

  return server;
}

// ── In-Memory Linked WebMCP Client ─────────────────────────────────────────
let webMcpClientInstance: Client | null = null;

export async function getWebMcpClient(): Promise<Client> {
  if (webMcpClientInstance) {
    return webMcpClientInstance;
  }

  const server = createWebMcpServer();
  const client = new Client(
    {
      name: 'webmcp-fdc3-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  webMcpClientInstance = client;
  console.log('[WebMCP] In-Browser MCP Server & Client initialized successfully.');
  return client;
}

/**
 * Exposes WebMCP tools to Chrome's native WebMCP API (`document.modelContext.registerTool`).
 * This makes the tools discoverable, testable, and inspectable directly in Chrome DevTools
 * under the WebMCP / AI Tools panel and in Model Context Tool Inspector extensions.
 */
export async function registerChromeWebMcpTools(fdc3Agent: any): Promise<void> {
  const { handleMcpFdc3Resource, isMcpFdc3Resource } = await import('@mcp-fdc3/client/dist/mcp-fdc3-client.esm.js');

  const executeInternalTool = async (name: string, rawInput: any) => {
    const input = normalizeToolInput(rawInput);
    const client = await getWebMcpClient();
    const rawResult: any = await client.callTool({ name, arguments: input });

    // Robustly trigger FDC3 on desktop agent
    const triggerFdc3 = async (res: any) => {
      if (!res) return false;
      const target = (res.resource && (res.type === 'resource' || res.resource.uri)) ? res.resource : res;
      if (isMcpFdc3Resource(target)) {
        await handleMcpFdc3Resource(fdc3Agent, target);
        return true;
      }
      return false;
    };

    let handled = false;
    if (rawResult?.fdc3Resource) {
      handled = await triggerFdc3(rawResult.fdc3Resource);
    }
    if (!handled && rawResult?._meta?.fdc3) {
      handled = await triggerFdc3(rawResult._meta.fdc3);
    }
    if (!handled && Array.isArray(rawResult?.content)) {
      for (const item of rawResult.content) {
        if (await triggerFdc3(item)) {
          handled = true;
          break;
        }
      }
    }

    return rawResult;
  };

  const toolsToRegister = [
    {
      name: 'getTrades',
      title: 'Get Trades',
      description:
        'Returns historical trades for a given company and broadcasts an FDC3 fdc3.instrument context via the ViewInstrument intent, targeting the Trade Blotter. Example input: "AAPL".',
      parameters: {
        type: 'object',
        properties: {
          companyName: {
            type: 'string',
            description: 'Company name or ticker symbol (e.g. AAPL, NVIDIA)',
          },
        },
        required: ['companyName'],
      },
      inputSchema: {
        type: 'object',
        properties: {
          companyName: {
            type: 'string',
            description: 'Company name or ticker symbol (e.g. AAPL, NVIDIA)',
          },
        },
        required: ['companyName'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          company: { type: 'string' },
          ticker: { type: 'string' },
          tradesCount: { type: 'number' },
          trades: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tradeId: { type: 'string' },
                ticker: { type: 'string' },
                side: { type: 'string' },
                quantity: { type: 'number' },
                price: { type: 'number' },
                timestamp: { type: 'string' },
                status: { type: 'string' },
              },
            },
          },
        },
        required: ['status', 'success', 'message', 'trades'],
      },
      readOnlyHint: true,
      execute: async (input: any) => await executeInternalTool('getTrades', input),
    },
    {
      name: 'getNews',
      title: 'Get News',
      description:
        'Filters the news feed by broadcasting an FDC3 fdc3.instrument context via the ViewInstrument intent, targeting the News App. Can filter by company/ticker (e.g. "NVDA", "AAPL"), market sentiment ("bullish" / positive or "bearish" / negative), and topic ("earnings", "macro", "tech", "rates").',
      parameters: {
        type: 'object',
        properties: {
          companyName: {
            type: 'string',
            description: 'Optional company name or ticker symbol to filter news for (e.g. MSFT, AAPL, NVDA, COIN)',
          },
          sentiment: {
            type: 'string',
            enum: ['bullish', 'bearish', 'all'],
            description: 'Filter news by sentiment: "bullish" (positive) or "bearish" (negative)',
          },
          topic: {
            type: 'string',
            enum: ['earnings', 'macro', 'tech', 'rates', 'all'],
            description: 'Filter news by topic: earnings, macro, tech, or rates',
          },
        },
      },
      inputSchema: {
        type: 'object',
        properties: {
          companyName: {
            type: 'string',
            description: 'Optional company name or ticker symbol to filter news for (e.g. MSFT, AAPL, NVDA, COIN)',
          },
          sentiment: {
            type: 'string',
            enum: ['bullish', 'bearish', 'all'],
            description: 'Filter news by sentiment: "bullish" (positive) or "bearish" (negative)',
          },
          topic: {
            type: 'string',
            enum: ['earnings', 'macro', 'tech', 'rates', 'all'],
            description: 'Filter news by topic: earnings, macro, tech, or rates',
          },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          filter: {
            type: 'object',
            properties: {
              company: { type: 'string' },
              ticker: { type: 'string' },
              sentiment: { type: 'string' },
              topic: { type: 'string' },
            },
          },
          articlesCount: { type: 'number' },
          articles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                headline: { type: 'string' },
                sentiment: { type: 'string' },
                topic: { type: 'string' },
                time: { type: 'string' },
              },
            },
          },
        },
        required: ['status', 'success', 'message'],
      },
      readOnlyHint: true,
      execute: async (input: any) => await executeInternalTool('getNews', input),
    },
    {
      name: 'clearFilters',
      title: 'Clear Filters',
      description:
        'Resets the workspace context by broadcasting an FDC3 fdc3.clear context via the ClearFilter intent to all panels (blotter, news, watchlist).',
      parameters: {
        type: 'object',
        properties: {},
      },
      inputSchema: {
        type: 'object',
        properties: {},
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          action: { type: 'string' },
        },
        required: ['status', 'success', 'message'],
      },
      execute: async (input: any) => await executeInternalTool('clearFilters', input),
    },
    {
      name: 'submitOrder',
      title: 'Submit Order',
      description:
        'Submits and executes an order immediately (market orders filled immediately, limit orders placed as pending on the blotter) by broadcasting an FDC3 SubmitOrder intent to the Order Ticket and Orders Blotter. Use this when the user explicitly asks to buy, sell, execute, or place an order right away.',
      parameters: {
        type: 'object',
        properties: {
          side: { type: 'string', enum: ['buy', 'sell'], description: 'The side of the order (buy or sell)' },
          quantity: { type: 'number', description: 'The number of shares/contracts to trade' },
          ticker: { type: 'string', description: 'The ticker symbol, e.g., AAPL, MSFT' },
          orderType: { type: 'string', enum: ['market', 'limit'], description: 'The type of order (market or limit)' },
          price: { type: 'number', description: 'The limit price' },
        },
        required: ['side', 'quantity', 'ticker'],
      },
      inputSchema: {
        type: 'object',
        properties: {
          side: { type: 'string', enum: ['buy', 'sell'], description: 'The side of the order (buy or sell)' },
          quantity: { type: 'number', description: 'The number of shares/contracts to trade' },
          ticker: { type: 'string', description: 'The ticker symbol, e.g., AAPL, MSFT' },
          orderType: { type: 'string', enum: ['market', 'limit'], description: 'The type of order (market or limit)' },
          price: { type: 'number', description: 'The limit price' },
        },
        required: ['side', 'quantity', 'ticker'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          orderId: { type: 'string' },
          ticker: { type: 'string' },
          side: { type: 'string' },
          quantity: { type: 'number' },
          orderType: { type: 'string' },
          price: { type: 'number' },
          orderStatus: { type: 'string' },
          timestamp: { type: 'string' },
        },
        required: ['status', 'success', 'message', 'orderId', 'ticker', 'side', 'quantity'],
      },
      execute: async (input: any) => await executeInternalTool('submitOrder', input),
    },
    {
      name: 'stageOrder',
      title: 'Stage Order',
      description:
        'Stages and populates an order in the Order Ticket UI without executing it, allowing the trader to review, edit, or confirm quantities, side, and prices before manual submission. Use this when the user asks to stage, prepare, draft, or set up an order (e.g., "Stage an order to buy 100 AAPL", "Prepare a limit buy for 50 TSLA at 240 in the ticket", "Set up an order to sell 20 MSFT", "Stage 100 NVDA").',
      parameters: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'The ticker symbol or company name, e.g., AAPL, MSFT, NVDA, TSLA' },
          side: { type: 'string', enum: ['buy', 'sell'], description: 'The side of the order (buy or sell)' },
          quantity: { type: 'number', description: 'The number of shares/contracts to stage' },
          orderType: { type: 'string', enum: ['market', 'limit'], description: 'The type of order (market or limit)' },
          price: { type: 'number', description: 'The limit price' },
        },
        required: ['ticker'],
      },
      inputSchema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'The ticker symbol or company name, e.g., AAPL, MSFT, NVDA, TSLA' },
          side: { type: 'string', enum: ['buy', 'sell'], description: 'The side of the order (buy or sell)' },
          quantity: { type: 'number', description: 'The number of shares/contracts to stage' },
          orderType: { type: 'string', enum: ['market', 'limit'], description: 'The type of order (market or limit)' },
          price: { type: 'number', description: 'The limit price' },
        },
        required: ['ticker'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          orderId: { type: 'string' },
          ticker: { type: 'string' },
          side: { type: 'string' },
          quantity: { type: 'number' },
          orderType: { type: 'string' },
          price: { type: 'number' },
          orderStatus: { type: 'string' },
          timestamp: { type: 'string' },
        },
        required: ['status', 'success', 'message', 'orderId', 'ticker', 'side', 'quantity', 'orderStatus'],
      },
      execute: async (input: any) => await executeInternalTool('stageOrder', input),
    },
    {
      name: 'requestQuote',
      title: 'Request Quote',
      description:
        'Constructs an FDC3 fdc3.order context and stages an RFQ via the InitiateRFQ intent in the RFQ panel for OTC instruments like FX pairs (e.g. EUR/USD).',
      parameters: {
        type: 'object',
        properties: {
          side: { type: 'string', enum: ['buy', 'sell', 'two-way'], description: 'The side to request (buy, sell, or two-way)' },
          quantity: { type: 'number', description: 'The notional amount to trade (e.g. 1000000)' },
          instrument: { type: 'string', description: 'The instrument symbol, e.g., EUR/USD' },
        },
        required: ['side', 'quantity', 'instrument'],
      },
      inputSchema: {
        type: 'object',
        properties: {
          side: { type: 'string', enum: ['buy', 'sell', 'two-way'], description: 'The side to request (buy, sell, or two-way)' },
          quantity: { type: 'number', description: 'The notional amount to trade (e.g. 1000000)' },
          instrument: { type: 'string', description: 'The instrument symbol, e.g., EUR/USD' },
        },
        required: ['side', 'quantity', 'instrument'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          rfqId: { type: 'string' },
          instrument: { type: 'string' },
          side: { type: 'string' },
          quantity: { type: 'number' },
          indicativeBid: { type: 'number' },
          indicativeAsk: { type: 'number' },
          statusText: { type: 'string' },
        },
        required: ['status', 'success', 'message', 'instrument', 'side', 'quantity'],
      },
      execute: async (input: any) => await executeInternalTool('requestQuote', input),
    },
    {
      name: 'viewChart',
      title: 'View Chart',
      description:
        'Displays or updates interactive financial charts (candlesticks, line/area, moving averages, volume) for an equity or FX instrument by broadcasting an FDC3 fdc3.instrument context via the ViewChart intent, targeting the Chart panel. Supports timeframe (1D, 1W, 1M, 3M, 1Y) and chartType (candle, line). Example inputs: "AAPL", "NVDA", "EUR/USD".',
      parameters: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Optional ticker symbol or company name (e.g. AAPL, NVDA, TSLA, EUR/USD)' },
          timeframe: { type: 'string', enum: ['1D', '1W', '1M', '3M', '1Y'], description: 'Chart timeframe duration' },
          chartType: { type: 'string', enum: ['candle', 'line'], description: 'Chart style: candle or line' },
        },
      },
      inputSchema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Optional ticker symbol or company name (e.g. AAPL, NVDA, TSLA, EUR/USD)' },
          timeframe: { type: 'string', enum: ['1D', '1W', '1M', '3M', '1Y'], description: 'Chart timeframe duration' },
          chartType: { type: 'string', enum: ['candle', 'line'], description: 'Chart style: candle or line' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          ticker: { type: 'string' },
          timeframe: { type: 'string' },
          chartType: { type: 'string' },
          statusText: { type: 'string' },
        },
        required: ['status', 'success', 'message', 'ticker', 'timeframe', 'chartType'],
      },
      readOnlyHint: true,
      execute: async (input: any) => await executeInternalTool('viewChart', input),
    },
    {
      name: 'addToWatchlist',
      title: 'Add To Watchlist',
      description:
        "Adds a stock or financial instrument to the user's Watchlist panel by broadcasting an FDC3 AddWatchlist intent. Example: 'add COIN to my watchlist'.",
      parameters: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'The ticker symbol to add (e.g. COIN, AMD, PLTR, NVDA, AAPL)' },
          companyName: { type: 'string', description: 'Optional company name' },
        },
        required: ['ticker'],
      },
      inputSchema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'The ticker symbol to add (e.g. COIN, AMD, PLTR, NVDA, AAPL)' },
          companyName: { type: 'string', description: 'Optional company name' },
        },
        required: ['ticker'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          ticker: { type: 'string' },
          companyName: { type: 'string' },
          action: { type: 'string' },
          isNew: { type: 'boolean' },
        },
        required: ['status', 'success', 'message', 'ticker'],
      },
      execute: async (input: any) => await executeInternalTool('addToWatchlist', input),
    },
    {
      name: 'removeFromWatchlist',
      title: 'Remove From Watchlist',
      description:
        "Removes a stock or financial instrument from the user's Watchlist panel by broadcasting an FDC3 RemoveWatchlist intent. Example: 'remove TSLA from my watchlist'.",
      parameters: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'The ticker symbol to remove (e.g. TSLA, COIN, AAPL)' },
        },
        required: ['ticker'],
      },
      inputSchema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'The ticker symbol to remove (e.g. TSLA, COIN, AAPL)' },
        },
        required: ['ticker'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          ticker: { type: 'string' },
          action: { type: 'string' },
        },
        required: ['status', 'success', 'message', 'ticker'],
      },
      execute: async (input: any) => await executeInternalTool('removeFromWatchlist', input),
    },
    {
      name: 'cancelOrder',
      title: 'Cancel Order',
      description:
        'Cancels an active or pending order on the Orders Blotter by broadcasting an FDC3 CancelOrder intent. You can specify a ticker symbol (e.g. "GS", "TSLA") or an order ID (e.g. "O009"). If neither is specified, it cancels the most recent pending order.',
      parameters: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Ticker symbol of the pending order to cancel (e.g. GS, TSLA)' },
          orderId: { type: 'string', description: 'Specific order ID to cancel (e.g. O009)' },
        },
      },
      inputSchema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Ticker symbol of the pending order to cancel (e.g. GS, TSLA)' },
          orderId: { type: 'string', description: 'Specific order ID to cancel (e.g. O009)' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          cancelledOrderId: { type: 'string' },
          ticker: { type: 'string' },
          action: { type: 'string' },
        },
        required: ['status', 'success', 'message', 'cancelledOrderId'],
      },
      execute: async (input: any) => await executeInternalTool('cancelOrder', input),
    },
    {
      name: 'getPositions',
      title: 'Get Positions',
      description:
        'Retrieves current portfolio positions, share quantities, weighted average entry costs, live market values, unrealized P&L, and portfolio exposure percentages across all held instruments.',
      parameters: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Optional ticker symbol to query a specific position (e.g. AAPL, NVDA)' },
        },
      },
      inputSchema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Optional ticker symbol to query a specific position (e.g. AAPL, NVDA)' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          totalPortfolioValue: { type: 'number' },
          totalUnrealizedPnl: { type: 'number' },
          totalUnrealizedPnlPercent: { type: 'string' },
          holdingsCount: { type: 'number' },
          positions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                ticker: { type: 'string' },
                companyName: { type: 'string' },
                shares: { type: 'number' },
                avgPrice: { type: 'number' },
                lastPrice: { type: 'number' },
                marketValue: { type: 'number' },
                unrealizedPnl: { type: 'string' },
                exposure: { type: 'string' },
                side: { type: 'string' },
              },
            },
          },
        },
        required: ['status', 'success', 'message', 'positions', 'totalPortfolioValue'],
      },
      execute: async (input: any) => await executeInternalTool('getPositions', input),
    },
    {
      name: 'getAccountSummary',
      title: 'Get Account Summary',
      description:
        'Retrieves overall account balance and financial health metrics including net liquidity / total equity, cash balance, realized P&L, unrealized P&L, day trading buying power, and margin buffer ratio.',
      parameters: {
        type: 'object',
        properties: {},
      },
      inputSchema: {
        type: 'object',
        properties: {},
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          account: {
            type: 'object',
            properties: {
              accountId: { type: 'string' },
              tier: { type: 'string' },
              netLiquidation: { type: 'number' },
              cashBalance: { type: 'number' },
              unrealizedPnl: { type: 'number' },
              realizedPnl: { type: 'number' },
              todaysPnl: { type: 'number' },
              buyingPower: { type: 'number' },
              marginUtilization: { type: 'number' },
            },
          },
        },
        required: ['status', 'success', 'message', 'account'],
      },
      execute: async (input: any) => await executeInternalTool('getAccountSummary', input),
    },
    {
      name: 'switchView',
      title: 'Switch View / Tab',
      description:
        'Switches the active workspace tab or panel to a specific widget view: "chart", "watchlist", "news", "rfq", "order-ticket", "account", "positions", "orders" (orders blotter), "trades" (trade blotter), or "chat". If the tab has already been opened in a stack, it immediately activates and switches the view to that tab.',
      parameters: {
        type: 'object',
        properties: {
          view: {
            type: 'string',
            description:
              'The widget or tab view to switch to: "chart", "watchlist", "news", "rfq", "order-ticket", "account", "positions", "orders", "trades", or "chat"',
          },
        },
        required: ['view'],
      },
      inputSchema: {
        type: 'object',
        properties: {
          view: {
            type: 'string',
            description:
              'The widget or tab view to switch to: "chart", "watchlist", "news", "rfq", "order-ticket", "account", "positions", "orders", "trades", or "chat"',
          },
        },
        required: ['view'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          success: { type: 'boolean' },
          message: { type: 'string' },
          view: { type: 'string' },
          appId: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['status', 'success', 'message', 'view'],
      },
      execute: async (input: any) => await executeInternalTool('switchView', input),
    },
  ];

  // Helper returning tools collection supporting both Array iteration and .tools property
  const createToolsCollection = () => {
    const arr: any = [...toolsToRegister];
    arr.tools = toolsToRegister;
    return arr;
  };

  // 1. Native navigator.modelContext registration (Chrome 146+ preview)
  if (typeof navigator !== 'undefined' && (navigator as any).modelContext?.registerTool) {
    try {
      for (const tool of toolsToRegister) {
        await (navigator as any).modelContext.registerTool(tool);
      }
      console.log(`[WebMCP] Registered ${toolsToRegister.length} tools with native navigator.modelContext`);
    } catch (e) {
      console.warn('[WebMCP] Note: navigator.modelContext.registerTool:', e);
    }
  }

  // 2. Native document.modelContext registration (Chrome 150+ standard)
  if (typeof document !== 'undefined' && (document as any).modelContext?.registerTool) {
    try {
      for (const tool of toolsToRegister) {
        await (document as any).modelContext.registerTool(tool);
      }
      console.log(`[WebMCP] Registered ${toolsToRegister.length} tools with native document.modelContext`);
    } catch (e) {
      console.warn('[WebMCP] Note: document.modelContext.registerTool:', e);
    }
  }

  // 3. Attach standard WebMCP inspection methods
  const attachModelContextMethods = (target: any) => {
    if (!target) return;
    target.getTools = async () => createToolsCollection();
    target.listTools = async () => createToolsCollection();
    target.getRegisteredTools = () => createToolsCollection();
    target.tools = toolsToRegister;
    target.executeTool = async (name: string, rawArgs: any) => {
      const tool = toolsToRegister.find(t => t.name === name);
      if (tool && tool.execute) {
        return await tool.execute(normalizeToolInput(rawArgs));
      }
      throw new Error(`Tool '${name}' not found`);
    };
  };

  if (typeof document !== 'undefined') {
    if (!(document as any).modelContext) {
      (document as any).modelContext = {};
    }
    attachModelContextMethods((document as any).modelContext);

    // document.modelContextTesting (Used by Model Context Tool Inspector extensions)
    const testingObj = {
      listTools: async () => createToolsCollection(),
      getTools: async () => createToolsCollection(),
      executeTool: async (name: string, rawArgs: any) => {
        const tool = toolsToRegister.find(t => t.name === name);
        if (tool && tool.execute) {
          return await tool.execute(normalizeToolInput(rawArgs));
        }
        throw new Error(`Tool '${name}' not found`);
      },
    };
    (document as any).modelContextTesting = testingObj;
  }

  if (typeof navigator !== 'undefined') {
    if (!(navigator as any).modelContext) {
      (navigator as any).modelContext = (document as any)?.modelContext;
    } else {
      attachModelContextMethods((navigator as any).modelContext);
    }

    if (!(navigator as any).modelContextTesting) {
      (navigator as any).modelContextTesting = (document as any)?.modelContextTesting;
    } else {
      attachModelContextMethods((navigator as any).modelContextTesting);
    }
  }

  // 4. Global inspection helpers on window.webmcp, window.mcp, window.modelContext
  if (typeof window !== 'undefined') {
    (window as any).modelContext = (document as any)?.modelContext;
    (window as any).modelContextTesting = (document as any)?.modelContextTesting;
    (window as any).mcp = {
      tools: toolsToRegister,
      getTools: async () => createToolsCollection(),
      listTools: async () => createToolsCollection(),
      callTool: async (name: string, rawArgs: any) => {
        const tool = toolsToRegister.find(t => t.name === name);
        if (tool && tool.execute) {
          return await tool.execute(normalizeToolInput(rawArgs));
        }
        const client = await getWebMcpClient();
        return await client.callTool({ name, arguments: normalizeToolInput(rawArgs) });
      },
      executeTool: async (name: string, rawArgs: any) => {
        const tool = toolsToRegister.find(t => t.name === name);
        if (tool && tool.execute) {
          return await tool.execute(normalizeToolInput(rawArgs));
        }
        throw new Error(`Tool '${name}' not found`);
      },
    };
    (window as any).webmcp = (window as any).mcp;

    // Dispatch WebMCP discovery events for 3rd party extensions
    try {
      window.dispatchEvent(new CustomEvent('webmcp:ready', { detail: { tools: toolsToRegister } }));
      window.dispatchEvent(new CustomEvent('modelcontext:toolschanged', { detail: { tools: toolsToRegister } }));
      document.dispatchEvent(new CustomEvent('modelcontext:toolschanged', { detail: { tools: toolsToRegister } }));
    } catch {}
  }
}
