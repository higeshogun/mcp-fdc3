import { AppIdentifier, Context } from '@finos/fdc3';
// import { createFdc3RaiseIntentResource } from '../../../../packages/server/dist/mcp-fdc3-server.esm.js';
import { createFdc3RaiseIntentResource } from '@mcp-fdc3/server/dist/mcp-fdc3-server.esm.js';
import { tickerMappingData } from '../mock-data/index.js';

export const getTrades = async ({ companyName }: { companyName: string }): Promise</* TODO - Use proper type here */any> => {
  // Create the FDC3 resource to be returned to the client (this is the only part specific to MCP-FDC3)
  const sanitized = companyName.trim().toLowerCase();
  const company = tickerMappingData.find((c: any) =>
    c.name.toLowerCase().includes(sanitized) ||
    c.ticker.toLowerCase() === sanitized
  );
  console.log(`[getTrades] input: "${companyName}" → company: ${company?.name} (${company?.ticker})`);
  if (company) {

    const targetApp: AppIdentifier = {
      appId: 'frontend-app-blotter',
    };
    const context: Context = {
      type: 'fdc3.instrument',
      name: company.name,
      id: {
        ticker: company.ticker,
      },
    };
    const fdc3Resource = createFdc3RaiseIntentResource('ViewInstrument', context, targetApp);

    return {
      content: [
        {
          type: 'text',
          text: `Successfully retrieved trades for ${company.name} and raised an FDC3 ViewInstrument intent targeting the Trade Blotter. The user's UI is now filtered to show only these trades. You may ask the user if they want to see news for this instrument or construct an order.`,
        },
        fdc3Resource,
      ],
    };

  } else {
    return {
      content: [
        {
          type: 'text',
          text: `Error: Failed to lookup company for '${companyName}'. Please verify the company name or ticker symbol. If unsure, ask the user to clarify the exact company or instrument they mean.`,
        },
        // isError: true,
      ],
    };
  }
};
