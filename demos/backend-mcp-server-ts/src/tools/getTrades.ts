import { AppIdentifier, Context } from '@finos/fdc3';
// import { createFdc3RaiseIntentResource } from '../../../../packages/server/dist/mcp-fdc3-server.esm.js';
import { createFdc3RaiseIntentResource } from '@mcp-fdc3/server/dist/mcp-fdc3-server.esm.js';
import { tickerMappingData } from '../mock-data/index.js';

export const getTrades = async ({ companyName }: { companyName: string }): Promise</* TODO - Use proper type here */any> => {
  // Create the FDC3 resource to be returned to the client (this is the only part specific to MCP-FDC3)
  const sanitizedCompanyName = companyName.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  // In the real world, at this point we would reach out to a separate service built to lookup appropriate identifiers from a company name
  // For now, let's just use a very crude mapping of company names and ticker symbols
  const company = tickerMappingData.find((c: any) => c.name.toLowerCase().includes(sanitizedCompanyName));
  console.log(`companyName: ${companyName}; sanitizedCompanyName: ${sanitizedCompanyName}; company.name: ${company?.name}; company.ticker: ${company?.ticker}`);
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
          text: `Trades retrieved for ${company.name}`,
        },
        fdc3Resource,
      ],
    };

  } else {
    return {
      content: [
        {
          type: 'text',
          text: `Error: Failed to lookup company for company name '${companyName}'`,
        },
        // isError: true,
      ],
    };
  }
};
