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
                    text: `Successfully filtered news for ${company.name} (${company.ticker}) using an FDC3 ViewInstrument intent. The user's News Panel is now displaying relevant headlines. You can ask if they would like to view historical trades or stage a trade for this instrument.`,
                },
                fdc3Resource,
            ],
        };
    } else {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error: Could not find a matching company for '${companyName}'. Please verify the company name or ticker symbol. If unsure, ask the user to clarify the exact company or instrument they mean.`,
                },
            ],
        };
    }
};
