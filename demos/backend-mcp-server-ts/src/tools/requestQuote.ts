import { z } from 'zod';
import { resolveTicker } from '../mock-data/index.js';
import { createFdc3RaiseIntentResource } from '@mcp-fdc3/server/dist/mcp-fdc3-server.esm.js';

export const requestQuoteDefinition = {
    name: 'requestQuote',
    description: 'Stages a Request For Quote (RFQ) in the RFQ panel for OTC instruments like FX pairs (e.g. EUR/USD). Use this when the user wants to trade FX or specifically asks to request a quote from dealers. Provide side, quantity, and instrument.',
    parameters: z.object({
        side: z.enum(['buy', 'sell', 'two-way']).describe('The side to request (buy, sell, or two-way)'),
        quantity: z.number().describe('The notional amount to trade (e.g. 1000000)'),
        instrument: z.string().describe('The instrument symbol, e.g., EUR/USD'),
    })
};

export async function requestQuote(args: z.infer<typeof requestQuoteDefinition.parameters>) {
    const resolvedTicker = resolveTicker(args.instrument);

    if (!resolvedTicker) {
        return {
            content: [{
                type: 'text',
                text: `Error: Could not resolve a valid instrument for "${args.instrument}". Please verify the symbol. If unsure, ask the user to clarify.`
            }],
            isError: true
        };
    }

    const context = {
        type: 'fdc3.order',
        details: {
            ticker: resolvedTicker,
            side: args.side,
            quantity: args.quantity
        }
    };

    const fdc3Resource = createFdc3RaiseIntentResource('InitiateRFQ', context as any, { appId: 'frontend-app-rfq' });

    return {
        content: [
            {
                type: 'text',
                text: `RFQ for ${args.side.toUpperCase()} ${args.quantity} ${resolvedTicker} successfully staged via an FDC3 InitiateRFQ intent. The RFQ panel is now populated. Instruct the user to review the details and click 'Request Quotes' in the panel to proceed.`
            },
            fdc3Resource
        ]
    };
}
