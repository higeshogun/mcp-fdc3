import { AppIdentifier, Context } from '@finos/fdc3';
import { createFdc3RaiseIntentResource } from '@mcp-fdc3/server/dist/mcp-fdc3-server.esm.js';
import { tickerMappingData } from '../mock-data/index.js';

export const getNews = async ({ companyName }: { companyName: string }): Promise<any> => {
    const sanitized = companyName.trim().toLowerCase();
    const company = tickerMappingData.find((c: any) =>
        c.name.toLowerCase().includes(sanitized) ||
        c.ticker.toLowerCase() === sanitized
    );
    console.log(`[getNews] input: "${companyName}" → company: ${company?.name} (${company?.ticker})`);

    if (company) {
        const targetApp: AppIdentifier = {
            appId: 'frontend-app-news',
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
                    text: `News filtered for ${company.name} (${company.ticker})`,
                },
                fdc3Resource,
            ],
        };
    } else {
        return {
            content: [
                {
                    type: 'text',
                    text: `Could not find a matching company for '${companyName}'. Try using a full company name (e.g. "Apple" or "NVIDIA").`,
                },
            ],
        };
    }
};
