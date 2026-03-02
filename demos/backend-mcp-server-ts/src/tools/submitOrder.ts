import { z } from 'zod';
import { resolveTicker } from '../mock-data/index.js';
import { createFdc3RaiseIntentResource } from '@mcp-fdc3/server/dist/mcp-fdc3-server.esm.js';

export const submitOrderDefinition = {
    name: 'submitOrder',
    description: 'Stages a traditional order in the Order Ticket app (Equities or simple instruments). Provide the side (buy/sell), quantity, and ticker symbol. The frontend will populate the Order Ticket where the user can confirm execution.',
    parameters: z.object({
        side: z.enum(['buy', 'sell']).describe('The side of the order (buy or sell)'),
        quantity: z.number().describe('The number of shares/contracts to trade'),
        ticker: z.string().describe('The ticker symbol, e.g., AAPL, MSFT'),
    })
};

export async function submitOrder(args: z.infer<typeof submitOrderDefinition.parameters>) {
    const resolvedTicker = resolveTicker(args.ticker);

    if (!resolvedTicker) {
        return {
            content: [{
                type: 'text',
                text: `Error: Could not resolve a valid trading ticker for "${args.ticker}".`
            }],
            isError: true
        };
    }

    // Generate an FDC3 RaiseIntent resource directing the UI to open the Order Ticket
    const context = {
        type: 'fdc3.order',
        details: {
            ticker: resolvedTicker,
            side: args.side,
            quantity: args.quantity
        }
    };

    // Create MCP resource so it reaches the frontend chat client
    const fdc3Resource = createFdc3RaiseIntentResource('SubmitOrder', context as any, { appId: 'frontend-app-order-ticket' });

    return {
        content: [
            {
                type: 'text',
                text: `Order staged in the UI for ${args.side.toUpperCase()} ${args.quantity} ${resolvedTicker}.`
            },
            fdc3Resource
        ]
    };
}
