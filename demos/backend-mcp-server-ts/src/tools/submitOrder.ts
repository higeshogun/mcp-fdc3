import { z } from 'zod';
import { resolveTicker } from '../mock-data/index.js';
import { createFdc3RaiseIntentResource } from '@mcp-fdc3/server/dist/mcp-fdc3-server.esm.js';

export const submitOrderDefinition = {
    name: 'submitOrder',
    description: 'Stages a traditional order in the Order Ticket app (Equities or simple instruments). Provide the side (buy/sell), quantity, ticker symbol, and optional order type and price. The frontend will populate the Order Ticket where the user can confirm execution.',
    parameters: z.object({
        side: z.enum(['buy', 'sell']).describe('The side of the order (buy or sell)'),
        quantity: z.number().describe('The number of shares/contracts to trade'),
        ticker: z.string().describe('The ticker symbol, e.g., AAPL, MSFT'),
        orderType: z.enum(['market', 'limit']).optional().default('market').describe('The type of order (market or limit)'),
        price: z.number().optional().describe('The limit price for the order (required for limit orders)'),
    })
};

export async function submitOrder(args: z.infer<typeof submitOrderDefinition.parameters>) {
    const resolvedTicker = resolveTicker(args.ticker);

    if (!resolvedTicker) {
        return {
            content: [{
                type: 'text',
                text: `Error: Could not resolve a valid trading ticker for "${args.ticker}". Please verify the symbol or company name. If unsure, ask the user to clarify.`
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
            quantity: args.quantity,
            type: args.orderType,
            price: args.price
        }
    };

    // Create MCP resource so it reaches the frontend chat client
    const fdc3Resource = createFdc3RaiseIntentResource('SubmitOrder', context as any, { appId: 'frontend-app-order-ticket' });

    const orderDesc = args.orderType === 'limit' && args.price
        ? `LIMIT ${args.side.toUpperCase()} ${args.quantity} ${resolvedTicker} @ ${args.price}`
        : `MARKET ${args.side.toUpperCase()} ${args.quantity} ${resolvedTicker}`;

    return {
        content: [
            {
                type: 'text',
                text: `Order staged in the UI for ${orderDesc}.`
            },
            fdc3Resource
        ]
    };
}
