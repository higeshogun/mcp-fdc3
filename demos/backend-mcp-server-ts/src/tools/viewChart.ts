import { AppIdentifier, Context } from '@finos/fdc3';
import { createFdc3RaiseIntentResource } from '@mcp-fdc3/server/dist/mcp-fdc3-server.esm.js';
import { tickerMappingData, resolveTicker } from '../mock-data/index.js';

export const viewChart = async ({
  ticker,
  timeframe,
  chartType,
}: {
  ticker: string;
  timeframe?: '1D' | '1W' | '1M' | '3M' | '1Y';
  chartType?: 'candle' | 'line';
}): Promise<any> => {
  const sanitized = ticker.trim();
  const resolvedTicker = resolveTicker(sanitized) || sanitized.toUpperCase();

  const company = tickerMappingData.find((c: any) =>
    c.name.toLowerCase().includes(sanitized.toLowerCase()) ||
    c.ticker.toLowerCase() === sanitized.toLowerCase() ||
    c.ticker.toUpperCase() === resolvedTicker
  ) || { name: resolvedTicker, ticker: resolvedTicker };

  const targetApp: AppIdentifier = {
    appId: 'frontend-app-chart',
  };

  const context: Context = {
    type: 'fdc3.instrument',
    name: company.name,
    id: {
      ticker: resolvedTicker,
    },
    ...(timeframe ? { timeframe } : {}),
    ...(chartType ? { chartType } : {}),
  };

  const fdc3Resource = createFdc3RaiseIntentResource('ViewChart', context, targetApp);

  const tfStr = timeframe ? ` [${timeframe}]` : '';
  const typeStr = chartType ? ` (${chartType})` : '';

  return {
    content: [
      {
        type: 'text',
        text: `Successfully displayed chart for ${company.name} (${resolvedTicker})${tfStr}${typeStr} via an FDC3 ViewChart intent targeting the Chart panel.`,
      },
      fdc3Resource,
    ],
  };
};
